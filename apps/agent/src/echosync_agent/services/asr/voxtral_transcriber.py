from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Callable
from contextlib import suppress
from dataclasses import dataclass
from typing import Any

from echosync_agent.domain import AudioFrame, SegmentStatus, TranscriptSegment, new_segment_id
from echosync_agent.interfaces import Transcriber


@dataclass(frozen=True, slots=True)
class VoxtralRealtimeConfig:
    """Voxtral 实时 ASR 配置。"""

    api_key: str
    model: str = "voxtral-mini-transcribe-realtime-2602"
    target_streaming_delay_ms: int = 1000
    sample_rate: int = 16_000
    encoding: str = "pcm_s16le"
    source_lang: str = "auto"
    silence_keepalive_ms: int = 480


@dataclass(frozen=True, slots=True)
class _AudioFormat:
    encoding: str
    sample_rate: int


@dataclass(slots=True)
class _FrameWindow:
    session_id: str = ""
    source_lang: str = "auto"
    start_ms: int = 0
    end_ms: int = 0
    frame_seen: bool = False


class VoxtralRealtimeTranscriber(Transcriber):
    """Mistral Voxtral Realtime ASR 适配器。

    适配器只做供应商事件归一：输入仍是 AudioFrame，输出仍是 TranscriptSegment。
    """

    def __init__(
        self,
        config: VoxtralRealtimeConfig,
        client_factory: Callable[[str], Any] | None = None,
        event_types: dict[str, type[object]] | None = None,
        audio_format_factory: Callable[[VoxtralRealtimeConfig], Any] | None = None,
    ) -> None:
        self.config = config
        self._client_factory = client_factory
        self._event_types = event_types
        self._audio_format_factory = audio_format_factory

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        runtime = self._resolve_runtime()
        client = runtime.client_factory(self.config.api_key)
        window = _FrameWindow()
        started_at = time.perf_counter()

        async for event in client.audio.realtime.transcribe_stream(
            audio_stream=self._audio_stream(frames, window),
            model=self.config.model,
            audio_format=runtime.audio_format_factory(self.config),
            target_streaming_delay_ms=self.config.target_streaming_delay_ms,
        ):
            if runtime.is_event(event, "error"):
                raise RuntimeError(str(event))
            if runtime.is_event(event, "text_delta"):
                text = str(getattr(event, "text", ""))
                if text.strip():
                    yield self._build_segment(
                        text=text,
                        window=window,
                        stream_elapsed_ms=int((time.perf_counter() - started_at) * 1000),
                    )
                continue
            if runtime.is_event(event, "done"):
                return

    async def _audio_stream(
        self,
        frames: AsyncIterator[AudioFrame],
        window: _FrameWindow,
    ) -> AsyncIterator[bytes]:
        frame_iterator = aiter(frames)
        frame_task = asyncio.create_task(anext(frame_iterator))
        keepalive_seconds = max(self.config.silence_keepalive_ms, 1) / 1000
        silence_chunk = _silence_pcm16le(
            sample_rate=self.config.sample_rate,
            duration_ms=self.config.silence_keepalive_ms,
        )

        try:
            while True:
                done, _pending = await asyncio.wait({frame_task}, timeout=keepalive_seconds)
                if frame_task in done:
                    try:
                        frame = frame_task.result()
                    except StopAsyncIteration:
                        return

                    _update_window(window, frame)
                    frame_task = asyncio.create_task(anext(frame_iterator))
                    if frame.pcm:
                        yield frame.pcm
                    continue

                if window.frame_seen:
                    window.end_ms += self.config.silence_keepalive_ms
                yield silence_chunk
        finally:
            if not frame_task.done():
                frame_task.cancel()
                with suppress(asyncio.CancelledError):
                    await frame_task

    def _build_segment(
        self,
        text: str,
        window: _FrameWindow,
        stream_elapsed_ms: int,
    ) -> TranscriptSegment:
        audio_ms = max(window.end_ms - window.start_ms, 1)
        audio_lag_ms = max(stream_elapsed_ms - audio_ms, 0)
        source_lang = window.source_lang
        if source_lang == "auto":
            source_lang = self.config.source_lang

        return TranscriptSegment(
            session_id=window.session_id,
            segment_id=new_segment_id(),
            rev=1,
            start_ms=window.start_ms,
            end_ms=window.end_ms,
            source_lang=source_lang,
            text=text,
            status=SegmentStatus.PARTIAL,
            stability=0.72,
            metrics={
                "asr_stream_elapsed_ms": float(stream_elapsed_ms),
                "asr_audio_lag_ms": float(audio_lag_ms),
                "asr_audio_window_ms": float(audio_ms),
                "asr_stream_rtf": stream_elapsed_ms / audio_ms,
            },
        )

    def _resolve_runtime(self) -> _VoxtralRuntime:
        if self._client_factory is not None:
            return _VoxtralRuntime(
                client_factory=self._client_factory,
                audio_format_factory=self._audio_format_factory or _default_audio_format,
                event_types=self._event_types or {},
            )
        return _load_mistral_runtime()


@dataclass(frozen=True, slots=True)
class _VoxtralRuntime:
    client_factory: Callable[[str], Any]
    audio_format_factory: Callable[[VoxtralRealtimeConfig], Any]
    event_types: dict[str, type[object]]

    def is_event(self, event: object, event_name: str) -> bool:
        event_type = self.event_types.get(event_name)
        if event_type is not None:
            return isinstance(event, event_type)

        class_name = event.__class__.__name__
        if event_name == "text_delta":
            return class_name == "TranscriptionStreamTextDelta" or hasattr(event, "text")
        if event_name == "done":
            return class_name == "TranscriptionStreamDone"
        if event_name == "error":
            return class_name == "RealtimeTranscriptionError"
        if event_name == "session_created":
            return class_name == "RealtimeTranscriptionSessionCreated"
        return False


def _default_audio_format(config: VoxtralRealtimeConfig) -> _AudioFormat:
    return _AudioFormat(encoding=config.encoding, sample_rate=config.sample_rate)


def _update_window(window: _FrameWindow, frame: AudioFrame) -> None:
    if not window.frame_seen:
        window.session_id = frame.session_id
        window.start_ms = frame.start_ms
        window.frame_seen = True
    window.source_lang = frame.source_lang
    window.end_ms = frame.end_ms


def _silence_pcm16le(*, sample_rate: int, duration_ms: int) -> bytes:
    samples = max(1, round(sample_rate * max(duration_ms, 1) / 1000))
    return b"\x00\x00" * samples


def _load_mistral_runtime() -> _VoxtralRuntime:
    try:
        from mistralai.client import Mistral
        from mistralai.client.models import (
            AudioFormat,
            RealtimeTranscriptionError,
            RealtimeTranscriptionSessionCreated,
            TranscriptionStreamDone,
            TranscriptionStreamTextDelta,
        )
    except ImportError as exc:
        raise RuntimeError(
            '未安装 Mistral realtime SDK。请先安装 pip install "mistralai[realtime]"。'
        ) from exc

    def audio_format_factory(config: VoxtralRealtimeConfig) -> Any:
        return AudioFormat(encoding=config.encoding, sample_rate=config.sample_rate)

    return _VoxtralRuntime(
        client_factory=lambda api_key: Mistral(api_key=api_key),
        audio_format_factory=audio_format_factory,
        event_types={
            "session_created": RealtimeTranscriptionSessionCreated,
            "text_delta": TranscriptionStreamTextDelta,
            "done": TranscriptionStreamDone,
            "error": RealtimeTranscriptionError,
        },
    )
