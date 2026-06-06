from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

import numpy as np

from echosync_agent.domain import AudioFrame, SegmentStatus, TranscriptSegment, new_segment_id
from echosync_agent.interfaces import Transcriber
from echosync_agent.services.asr.semantic_chunker import (
    FrameVadDetector,
    SemanticBoundary,
    SemanticChunkingConfig,
    SemanticEndpointTracker,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class FunAsrStreamingConfig:
    """FunASR 流式识别配置。

    chunk_size 使用 FunASR 官方流式模型的语义，chunk_ms 是本地音频切片粒度。
    """

    model: str = "paraformer-zh-streaming"
    device: str = "auto"
    chunk_size: tuple[int, int, int] = (0, 10, 5)
    encoder_chunk_look_back: int = 4
    decoder_chunk_look_back: int = 1
    chunk_ms: int = 600
    source_lang: str = "zh"
    semantic_min_chunk_ms: int | None = None
    semantic_max_chunk_ms: int = 3_500
    semantic_overlap_ms: int = 800
    vad_silence_ms: int = 300


ModelFactory = Callable[[], Any]


class FunAsrTranscriber(Transcriber):
    """FunASR 流式识别适配器。

    原则：依赖倒置。管道只依赖 Transcriber；FunASR 的 AutoModel、cache 和 chunk
    维护被封装在适配器内部，不泄漏给翻译或字幕输出。
    """

    def __init__(
        self,
        model_factory: ModelFactory | None = None,
        config: FunAsrStreamingConfig | None = None,
        vad_detector: FrameVadDetector | None = None,
    ) -> None:
        self.config = config or FunAsrStreamingConfig()
        self._model_factory = model_factory or self._default_model_factory
        self._model: Any | None = None
        self._vad_detector = vad_detector

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        cache: dict[str, Any] = {}
        pending: _PendingAudioBuffer | None = None
        endpoint_tracker = SemanticEndpointTracker(
            SemanticChunkingConfig(
                min_chunk_ms=self.config.semantic_min_chunk_ms or self.config.chunk_ms,
                max_chunk_ms=self.config.semantic_max_chunk_ms,
                overlap_ms=self.config.semantic_overlap_ms,
                vad_silence_ms=self.config.vad_silence_ms,
            ),
            vad_detector=self._vad_detector,
        )

        async for raw_frame in frames:
            semantic_frame = endpoint_tracker.mark(raw_frame)
            frame = semantic_frame.frame
            if pending is None:
                pending = _PendingAudioBuffer(
                    sample_rate=frame.sample_rate,
                    chunk_ms=self.config.chunk_ms,
                )
            pending.push(frame)
            while not frame.is_final and pending.ready():
                segment = self._recognize_frame(
                    pending.take_chunk(is_final=False),
                    cache=cache,
                    is_final=False,
                )
                if segment is not None:
                    yield segment
            if frame.is_final and pending.has_audio():
                while pending.has_more_than_one_chunk():
                    segment = self._recognize_frame(
                        pending.take_chunk(is_final=False),
                        cache=cache,
                        is_final=False,
                    )
                    if segment is not None:
                        yield segment
                segment = self._recognize_frame(
                    pending.take_all(is_final=True),
                    cache=cache,
                    is_final=True,
                    semantic_boundary=semantic_frame.boundary,
                    semantic_active_audio_ms=semantic_frame.active_audio_ms,
                    semantic_overlap_ms=semantic_frame.overlap_ms,
                )
                if segment is not None:
                    yield segment
                cache = {}

        if pending is not None and pending.has_audio():
            segment = self._recognize_frame(
                pending.take_all(is_final=True),
                cache=cache,
                is_final=True,
                semantic_boundary="stream_end",
                semantic_active_audio_ms=0,
                semantic_overlap_ms=0,
            )
            if segment is not None:
                yield segment

    def _recognize_frame(
        self,
        chunk: _BufferedAudioChunk,
        cache: dict[str, Any],
        is_final: bool,
        semantic_boundary: SemanticBoundary = "none",
        semantic_active_audio_ms: int = 0,
        semantic_overlap_ms: int = 0,
    ) -> TranscriptSegment | None:
        frame = chunk.frame
        model = self._get_model()
        started_at = time.perf_counter()
        result = model.generate(
            input=_pcm16le_to_float32(frame.pcm),
            cache=cache,
            is_final=is_final,
            chunk_size=list(self.config.chunk_size),
            encoder_chunk_look_back=self.config.encoder_chunk_look_back,
            decoder_chunk_look_back=self.config.decoder_chunk_look_back,
            disable_pbar=True,
        )
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        text = _extract_text(result)
        audio_ms = max(frame.end_ms - frame.start_ms, 1)
        asr_rtf = elapsed_ms / audio_ms
        logger.info(
            "funasr_inference_chunk session_id=%s start_ms=%d end_ms=%d "
            "input_audio_ms=%d transport_frames=%d final=%s semantic_boundary=%s "
            "latency_ms=%d rtf=%.3f text_chars=%d",
            frame.session_id,
            frame.start_ms,
            frame.end_ms,
            audio_ms,
            chunk.transport_frames,
            is_final,
            semantic_boundary,
            elapsed_ms,
            asr_rtf,
            len(text),
        )
        if semantic_boundary != "none":
            logger.info(
                "funasr_semantic_boundary session_id=%s boundary=%s "
                "active_audio_ms=%d overlap_ms=%d chunk_start_ms=%d chunk_end_ms=%d",
                frame.session_id,
                semantic_boundary,
                semantic_active_audio_ms,
                semantic_overlap_ms,
                frame.start_ms,
                frame.end_ms,
            )
        if not text:
            return None

        source_lang = frame.source_lang if frame.source_lang != "auto" else self.config.source_lang

        return TranscriptSegment(
            session_id=frame.session_id,
            segment_id=new_segment_id(),
            rev=1,
            start_ms=frame.start_ms,
            end_ms=frame.end_ms,
            source_lang=source_lang,
            text=text,
            status=SegmentStatus.COMMITTED if is_final else SegmentStatus.PARTIAL,
            stability=1.0 if is_final else 0.72,
            metrics={
                "asr_latency_ms": float(elapsed_ms),
                "asr_rtf": asr_rtf,
                "asr_input_audio_ms": float(audio_ms),
                "asr_transport_frames": float(chunk.transport_frames),
                "asr_endpoint_final": 1.0 if is_final else 0.0,
                "asr_semantic_boundary": _semantic_boundary_metric(semantic_boundary),
                "asr_semantic_active_audio_ms": float(semantic_active_audio_ms),
                "asr_semantic_overlap_ms": float(semantic_overlap_ms),
            },
        )

    def _get_model(self) -> Any:
        if self._model is None:
            self._model = self._model_factory()
        return self._model

    def _default_model_factory(self) -> Any:
        try:
            from funasr import AutoModel
        except ImportError as exc:
            raise RuntimeError(
                "未安装 FunASR。请先在 apps/agent 环境中安装 funasr 和 modelscope。"
            ) from exc

        resolved_device = resolve_funasr_device(self.config.device)
        return AutoModel(model=self.config.model, device=resolved_device, disable_update=True)


def resolve_funasr_device(
    requested_device: str,
    cuda_is_available: Callable[[], bool] | None = None,
) -> str:
    """解析 FunASR 运行设备。

    `auto` 和 `cuda` 都会优先使用 CUDA；检测不到可用 GPU 时回退 CPU。
    显式传入 `cpu` 时强制使用 CPU，方便排查 CUDA 环境问题。
    """

    normalized = requested_device.strip().lower()
    if normalized == "cpu":
        return "cpu"
    if normalized not in {"auto", "cuda"}:
        return requested_device

    checker = cuda_is_available or _torch_cuda_is_available
    return "cuda" if checker() else "cpu"


def _torch_cuda_is_available() -> bool:
    try:
        import torch
    except ImportError:
        return False
    return bool(torch.cuda.is_available())


def _extract_text(result: object) -> str:
    if isinstance(result, str):
        return result.strip()
    if isinstance(result, dict):
        return str(result.get("text", "")).strip()
    if isinstance(result, list):
        return " ".join(_extract_text(item) for item in result).strip()
    return ""


def _pcm16le_to_float32(pcm: bytes) -> np.ndarray:
    if not pcm:
        return np.array([], dtype=np.float32)
    samples = np.frombuffer(pcm, dtype="<i2")
    return (samples.astype(np.float32) / 32768.0).copy()


class _PendingAudioBuffer:
    def __init__(self, *, sample_rate: int, chunk_ms: int) -> None:
        self._sample_rate = sample_rate
        self._target_bytes = max(1, int(sample_rate * chunk_ms / 1000) * 2)
        self._first_frame: AudioFrame | None = None
        self._last_frame: AudioFrame | None = None
        self._next_start_ms: int | None = None
        self._pcm = bytearray()
        self._frame_byte_counts: list[int] = []

    def push(self, frame: AudioFrame) -> None:
        if not frame.pcm:
            return
        if self._first_frame is None:
            self._first_frame = frame
            self._next_start_ms = frame.start_ms
        self._last_frame = frame
        self._pcm.extend(frame.pcm)
        self._frame_byte_counts.append(len(frame.pcm))

    def ready(self) -> bool:
        return len(self._pcm) >= self._target_bytes

    def has_more_than_one_chunk(self) -> bool:
        return len(self._pcm) > self._target_bytes

    def has_audio(self) -> bool:
        return bool(self._pcm and self._first_frame is not None and self._last_frame is not None)

    def take_chunk(self, *, is_final: bool) -> _BufferedAudioChunk:
        return self._take(self._target_bytes, is_final=is_final)

    def take_all(self, *, is_final: bool) -> _BufferedAudioChunk:
        return self._take(len(self._pcm), is_final=is_final)

    def _take(self, byte_count: int, *, is_final: bool) -> _BufferedAudioChunk:
        if self._first_frame is None or self._last_frame is None or self._next_start_ms is None:
            raise RuntimeError("FunASR audio buffer is empty.")

        pcm = bytes(self._pcm[:byte_count])
        del self._pcm[:byte_count]
        transport_frames = self._take_frame_count(byte_count)

        first = self._first_frame
        last = self._last_frame
        start_ms = self._next_start_ms
        end_ms = last.end_ms if is_final and not self._pcm else start_ms + _pcm_duration_ms(
            pcm,
            self._sample_rate,
        )
        self._next_start_ms = end_ms
        if not self._pcm:
            self._first_frame = None
            self._last_frame = None
            self._next_start_ms = None
        return _BufferedAudioChunk(
            frame=AudioFrame(
                session_id=first.session_id,
                seq=last.seq,
                pcm=pcm,
                sample_rate=first.sample_rate,
                channels=first.channels,
                start_ms=start_ms,
                end_ms=end_ms,
                source_lang=first.source_lang,
                source_kind=first.source_kind,
                device_id=first.device_id,
                is_final=is_final,
            ),
            transport_frames=max(transport_frames, 1),
        )

    def _take_frame_count(self, byte_count: int) -> int:
        remaining = byte_count
        frames = 0
        while remaining > 0 and self._frame_byte_counts:
            frame_bytes = self._frame_byte_counts[0]
            frames += 1
            if frame_bytes <= remaining:
                remaining -= frame_bytes
                self._frame_byte_counts.pop(0)
                continue
            self._frame_byte_counts[0] = frame_bytes - remaining
            remaining = 0
        return frames


def _pcm_duration_ms(pcm: bytes, sample_rate: int) -> int:
    sample_count = len(pcm) // 2
    return int(round((sample_count / sample_rate) * 1000))


def _semantic_boundary_metric(boundary: SemanticBoundary) -> float:
    return {
        "none": 0.0,
        "soft": 1.0,
        "hard": 2.0,
        "stream_end": 3.0,
    }[boundary]


@dataclass(frozen=True, slots=True)
class _BufferedAudioChunk:
    frame: AudioFrame
    transport_frames: int
