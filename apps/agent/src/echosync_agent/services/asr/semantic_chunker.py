from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, replace
from typing import Literal, Protocol

from echosync_agent.domain import AudioFrame

SemanticBoundary = Literal["none", "soft", "hard", "stream_end"]


@dataclass(frozen=True, slots=True)
class SemanticChunkingConfig:
    min_chunk_ms: int = 1_000
    max_chunk_ms: int = 3_500
    overlap_ms: int = 800
    vad_silence_ms: int = 300


class FrameVadDetector(Protocol):
    def is_speech(self, frame: AudioFrame) -> bool:
        """返回当前音频帧是否包含人声。"""


@dataclass(frozen=True, slots=True)
class SemanticAudioChunk:
    frame: AudioFrame
    boundary: SemanticBoundary
    source_frames: int
    overlap_ms: int = 0


class SemanticAudioChunker:
    """按 soft endpoint、hard cut 和 overlap 生成语义音频块。

    这个 chunker 适合 batch ASR 或后续非流式模型。FunASR 这类流式模型使用
    `SemanticEndpointTracker`，避免为了等语义块牺牲已有的低延迟推理窗口。
    """

    def __init__(self, config: SemanticChunkingConfig | None = None) -> None:
        self.config = config or SemanticChunkingConfig()

    async def stream(
        self,
        frames: AsyncIterator[AudioFrame],
    ) -> AsyncIterator[SemanticAudioChunk]:
        pending: list[AudioFrame] = []

        async for frame in frames:
            pending.append(frame)
            duration_ms = _pending_duration_ms(pending)
            if frame.is_final:
                yield _build_chunk(pending, boundary="soft", is_final=True)
                pending = []
                continue

            if duration_ms >= self.config.max_chunk_ms:
                chunk = _build_chunk(
                    pending,
                    boundary="hard",
                    is_final=False,
                    overlap_ms=min(self.config.overlap_ms, duration_ms),
                )
                yield chunk
                pending = _overlap_tail(chunk.frame, self.config.overlap_ms)

        if pending:
            yield _build_chunk(pending, boundary="stream_end", is_final=True)


@dataclass(frozen=True, slots=True)
class SemanticFrame:
    frame: AudioFrame
    boundary: SemanticBoundary
    active_audio_ms: int
    overlap_ms: int = 0


class SemanticEndpointTracker:
    """流式 ASR 的轻量 endpoint tracker。

    它不缓存音频，不阻塞模型推理；只在上游 endpoint 或 hard timeout 到达时
    标记当前 frame 为 final，让 provider flush 并重置流式 cache。
    """

    def __init__(
        self,
        config: SemanticChunkingConfig | None = None,
        vad_detector: FrameVadDetector | None = None,
    ) -> None:
        self.config = config or SemanticChunkingConfig()
        self.vad_detector = vad_detector
        self._active_start_ms: int | None = None
        self._silence_start_ms: int | None = None

    def mark(self, frame: AudioFrame) -> SemanticFrame:
        is_speech = self._is_speech(frame)
        if self._active_start_ms is None and is_speech is False and not frame.is_final:
            return SemanticFrame(frame=frame, boundary="none", active_audio_ms=0)

        if self._active_start_ms is None:
            self._active_start_ms = frame.start_ms

        active_audio_ms = max(frame.end_ms - self._active_start_ms, 0)
        if frame.is_final:
            self._reset()
            return SemanticFrame(frame=frame, boundary="soft", active_audio_ms=active_audio_ms)

        if is_speech is False:
            if self._silence_start_ms is None:
                self._silence_start_ms = frame.start_ms
            silence_ms = max(frame.end_ms - self._silence_start_ms, 0)
            if (
                active_audio_ms >= self.config.min_chunk_ms
                and silence_ms >= self.config.vad_silence_ms
            ):
                self._reset()
                return SemanticFrame(
                    frame=replace(frame, is_final=True),
                    boundary="soft",
                    active_audio_ms=active_audio_ms,
                )
        elif is_speech is True:
            self._silence_start_ms = None

        if active_audio_ms >= self.config.max_chunk_ms:
            self._reset()
            return SemanticFrame(
                frame=replace(frame, is_final=True),
                boundary="hard",
                active_audio_ms=active_audio_ms,
                overlap_ms=self.config.overlap_ms,
            )

        return SemanticFrame(frame=frame, boundary="none", active_audio_ms=active_audio_ms)

    def _is_speech(self, frame: AudioFrame) -> bool | None:
        if self.vad_detector is None:
            return None
        return self.vad_detector.is_speech(frame)

    def _reset(self) -> None:
        self._active_start_ms = None
        self._silence_start_ms = None


def _build_chunk(
    frames: list[AudioFrame],
    *,
    boundary: SemanticBoundary,
    is_final: bool,
    overlap_ms: int = 0,
) -> SemanticAudioChunk:
    if not frames:
        raise RuntimeError("semantic audio chunk cannot be empty.")

    first = frames[0]
    last = frames[-1]
    return SemanticAudioChunk(
        frame=AudioFrame(
            session_id=first.session_id,
            seq=last.seq,
            pcm=b"".join(frame.pcm for frame in frames),
            sample_rate=first.sample_rate,
            channels=first.channels,
            start_ms=first.start_ms,
            end_ms=last.end_ms,
            source_lang=first.source_lang,
            source_kind=first.source_kind,
            device_id=first.device_id,
            is_final=is_final,
        ),
        boundary=boundary,
        source_frames=len(frames),
        overlap_ms=overlap_ms,
    )


def _overlap_tail(frame: AudioFrame, overlap_ms: int) -> list[AudioFrame]:
    if overlap_ms <= 0 or not frame.pcm:
        return []

    bytes_per_ms = max(int(frame.sample_rate * frame.channels * 2 / 1_000), 1)
    tail_bytes = min(len(frame.pcm), overlap_ms * bytes_per_ms)
    if tail_bytes <= 0:
        return []

    actual_overlap_ms = max(round(tail_bytes / bytes_per_ms), 1)
    return [
        replace(
            frame,
            pcm=frame.pcm[-tail_bytes:],
            start_ms=max(frame.end_ms - actual_overlap_ms, frame.start_ms),
            is_final=False,
        )
    ]


def _pending_duration_ms(frames: list[AudioFrame]) -> int:
    if not frames:
        return 0
    return max(frames[-1].end_ms - frames[0].start_ms, 0)
