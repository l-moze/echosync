from __future__ import annotations

import asyncio
import contextlib
import inspect
from dataclasses import dataclass
from typing import Any, Literal

from echosync_agent.domain import AudioFrame
from echosync_agent.services.asr.semantic_chunker import FrameVadDetector


@dataclass(frozen=True, slots=True)
class LiveKitSileroVadConfig:
    sample_rate: Literal[8000, 16000] = 16_000
    min_speech_ms: int = 50
    min_silence_ms: int = 50
    activation_threshold: float = 0.5
    force_cpu: bool = True


class LiveKitSileroFrameVadDetector(FrameVadDetector):
    """把 LiveKit Silero VAD 流式事件适配成同步 frame detector。

    FunASR 的 hot path 需要同步 `is_speech(frame)`，而 LiveKit Silero 使用异步事件流。
    这里把音频帧推入 Silero stream，并由后台 task 消费事件，`is_speech()` 返回最近
    一次 VAD 状态。endpoint 的 300ms 连续静音策略仍由 `SemanticEndpointTracker` 负责。
    """

    def __init__(
        self,
        *,
        vad: Any,
        activation_threshold: float,
    ) -> None:
        self._vad = vad
        self._activation_threshold = activation_threshold
        self._stream: Any | None = None
        self._drain_task: asyncio.Task[None] | None = None
        self._is_speech = False

    def is_speech(self, frame: AudioFrame) -> bool:
        stream = self._ensure_stream()
        stream.push_frame(_to_livekit_audio_frame(frame))
        return self._is_speech

    async def aclose(self) -> None:
        stream = self._stream
        task = self._drain_task
        self._stream = None
        self._drain_task = None

        if stream is not None and hasattr(stream, "aclose"):
            result = stream.aclose()
            if inspect.isawaitable(result):
                await result

        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    def _ensure_stream(self) -> Any:
        if self._stream is None:
            loop = asyncio.get_running_loop()
            self._stream = self._vad.stream()
            self._drain_task = loop.create_task(self._drain_events())
        return self._stream

    async def _drain_events(self) -> None:
        if self._stream is None:
            return

        async for event in self._stream:
            event_type = _event_type(event)
            if event_type == "start_of_speech":
                self._is_speech = True
            elif event_type == "end_of_speech":
                self._is_speech = False
            elif event_type == "inference_done":
                probability = getattr(event, "probability", None)
                if probability is not None:
                    self._is_speech = bool(getattr(event, "speaking", False)) or (
                        float(probability) >= self._activation_threshold
                    )
                else:
                    self._is_speech = bool(getattr(event, "speaking", self._is_speech))


def build_livekit_silero_vad_detector(
    config: LiveKitSileroVadConfig | None = None,
) -> LiveKitSileroFrameVadDetector:
    resolved = config or LiveKitSileroVadConfig()
    try:
        from livekit.plugins import silero
    except ImportError as exc:
        raise RuntimeError("未安装 LiveKit Silero VAD，请安装 livekit-agents[silero]。") from exc

    vad = silero.VAD.load(
        min_speech_duration=resolved.min_speech_ms / 1000,
        min_silence_duration=resolved.min_silence_ms / 1000,
        activation_threshold=resolved.activation_threshold,
        sample_rate=resolved.sample_rate,
        force_cpu=resolved.force_cpu,
    )
    return LiveKitSileroFrameVadDetector(
        vad=vad,
        activation_threshold=resolved.activation_threshold,
    )


def _to_livekit_audio_frame(frame: AudioFrame) -> Any:
    from livekit import rtc

    channels = max(frame.channels, 1)
    samples_per_channel = max((len(frame.pcm) // 2) // channels, 0)
    return rtc.AudioFrame(
        data=frame.pcm,
        sample_rate=frame.sample_rate,
        num_channels=channels,
        samples_per_channel=samples_per_channel,
    )


def _event_type(event: object) -> str:
    value = getattr(getattr(event, "type", ""), "value", getattr(event, "type", ""))
    return str(value)
