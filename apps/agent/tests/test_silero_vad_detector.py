from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from echosync_agent.domain import AudioFrame
from echosync_agent.services.asr.silero_vad_detector import LiveKitSileroFrameVadDetector


def test_livekit_silero_detector_updates_cached_speech_state_from_events() -> None:
    async def run() -> None:
        stream = FakeVadStream()
        detector = LiveKitSileroFrameVadDetector(
            vad=FakeVad(stream),
            activation_threshold=0.5,
        )

        assert detector.is_speech(_audio_frame(seq=1)) is False
        assert stream.frames[0].sample_rate == 16_000
        assert stream.frames[0].num_channels == 1
        assert stream.frames[0].samples_per_channel == 160

        await stream.emit(FakeVadEvent(type="start_of_speech", probability=0.9, speaking=True))
        assert detector.is_speech(_audio_frame(seq=2)) is True

        await stream.emit(FakeVadEvent(type="end_of_speech", probability=0.1, speaking=False))
        assert detector.is_speech(_audio_frame(seq=3)) is False

        await detector.aclose()
        assert stream.closed is True

    asyncio.run(run())


def test_livekit_silero_detector_uses_probability_for_inference_events() -> None:
    async def run() -> None:
        stream = FakeVadStream()
        detector = LiveKitSileroFrameVadDetector(
            vad=FakeVad(stream),
            activation_threshold=0.5,
        )

        assert detector.is_speech(_audio_frame(seq=1)) is False
        await stream.emit(FakeVadEvent(type="inference_done", probability=0.8, speaking=False))
        assert detector.is_speech(_audio_frame(seq=2)) is True
        await stream.emit(FakeVadEvent(type="inference_done", probability=0.2, speaking=True))
        assert detector.is_speech(_audio_frame(seq=3)) is False

        await detector.aclose()

    asyncio.run(run())


class FakeVad:
    def __init__(self, stream: FakeVadStream) -> None:
        self._stream = stream

    def stream(self) -> FakeVadStream:
        return self._stream


class FakeVadStream:
    def __init__(self) -> None:
        self.frames: list[Any] = []
        self.closed = False
        self._events: asyncio.Queue[FakeVadEvent | None] = asyncio.Queue()

    def push_frame(self, frame: Any) -> None:
        self.frames.append(frame)

    async def emit(self, event: FakeVadEvent) -> None:
        await self._events.put(event)
        await asyncio.sleep(0)

    def __aiter__(self) -> FakeVadStream:
        return self

    async def __anext__(self) -> FakeVadEvent:
        event = await self._events.get()
        if event is None:
            raise StopAsyncIteration
        return event

    async def aclose(self) -> None:
        self.closed = True
        await self._events.put(None)


@dataclass(frozen=True, slots=True)
class FakeVadEvent:
    type: str
    probability: float
    speaking: bool


def _audio_frame(*, seq: int) -> AudioFrame:
    return AudioFrame(
        session_id="sess_silero",
        seq=seq,
        pcm=b"\x01\x00" * 160,
        sample_rate=16_000,
        channels=1,
        start_ms=(seq - 1) * 10,
        end_ms=seq * 10,
        source_lang="zh",
    )
