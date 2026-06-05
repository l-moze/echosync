from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

from echosync_agent.domain import AudioFrame, SegmentStatus
from echosync_agent.services.asr.voxtral_transcriber import (
    VoxtralRealtimeConfig,
    VoxtralRealtimeTranscriber,
)


class FakeSessionCreated:
    pass


class FakeTextDelta:
    def __init__(self, text: str) -> None:
        self.text = text


class FakeDone:
    pass


class FakeRealtimeError:
    def __str__(self) -> str:
        return "voxtral failed"


class FakeUnknown:
    pass


def test_voxtral_stream_sends_pcm_bytes_and_yields_text_delta_segments() -> None:
    captured_chunks: list[bytes] = []
    captured_call: dict[str, Any] = {}

    class FakeRealtimeAudio:
        async def transcribe_stream(self, **kwargs: Any) -> AsyncIterator[object]:
            captured_call.update(kwargs)
            async for chunk in kwargs["audio_stream"]:
                captured_chunks.append(chunk)
            yield FakeSessionCreated()
            yield FakeUnknown()
            yield FakeTextDelta("hello")
            yield FakeDone()

    transcriber = VoxtralRealtimeTranscriber(
        config=VoxtralRealtimeConfig(
            api_key="test-key",
            model="voxtral-test",
            target_streaming_delay_ms=480,
        ),
        client_factory=lambda _api_key: _client(FakeRealtimeAudio()),
        event_types={
            "session_created": FakeSessionCreated,
            "text_delta": FakeTextDelta,
            "done": FakeDone,
            "error": FakeRealtimeError,
        },
    )

    segments = asyncio.run(_collect(transcriber.stream(_frames())))

    assert captured_chunks == [b"\x01\x00", b"\x02\x00"]
    assert captured_call["model"] == "voxtral-test"
    assert captured_call["target_streaming_delay_ms"] == 480
    assert captured_call["audio_format"].encoding == "pcm_s16le"
    assert captured_call["audio_format"].sample_rate == 16_000
    assert len(segments) == 1
    assert segments[0].session_id == "sess_voxtral"
    assert segments[0].text == "hello"
    assert segments[0].status == SegmentStatus.PARTIAL
    assert segments[0].source_lang == "en"
    assert segments[0].start_ms == 0
    assert segments[0].end_ms == 1200
    assert segments[0].metrics["asr_latency_ms"] >= 0


def test_voxtral_stream_preserves_delta_spacing_for_transcript_assembly() -> None:
    class FakeRealtimeAudio:
        async def transcribe_stream(self, **kwargs: Any) -> AsyncIterator[object]:
            async for _chunk in kwargs["audio_stream"]:
                pass
            yield FakeTextDelta(" hello")

    transcriber = VoxtralRealtimeTranscriber(
        config=VoxtralRealtimeConfig(api_key="test-key"),
        client_factory=lambda _api_key: _client(FakeRealtimeAudio()),
        event_types={
            "session_created": FakeSessionCreated,
            "text_delta": FakeTextDelta,
            "done": FakeDone,
            "error": FakeRealtimeError,
        },
    )

    segments = asyncio.run(_collect(transcriber.stream(_frames())))

    assert segments[0].text == " hello"


def test_voxtral_stream_raises_runtime_error_for_realtime_error_event() -> None:
    class FakeRealtimeAudio:
        async def transcribe_stream(self, **kwargs: Any) -> AsyncIterator[object]:
            async for _chunk in kwargs["audio_stream"]:
                pass
            yield FakeRealtimeError()

    transcriber = VoxtralRealtimeTranscriber(
        config=VoxtralRealtimeConfig(api_key="test-key"),
        client_factory=lambda _api_key: _client(FakeRealtimeAudio()),
        event_types={
            "session_created": FakeSessionCreated,
            "text_delta": FakeTextDelta,
            "done": FakeDone,
            "error": FakeRealtimeError,
        },
    )

    try:
        asyncio.run(_collect(transcriber.stream(_frames())))
    except RuntimeError as exc:
        assert "voxtral failed" in str(exc)
    else:
        raise AssertionError("RuntimeError was not raised")


async def _frames() -> AsyncIterator[AudioFrame]:
    yield AudioFrame(
        session_id="sess_voxtral",
        seq=1,
        pcm=b"\x01\x00",
        sample_rate=16_000,
        channels=1,
        start_ms=0,
        end_ms=600,
        source_lang="en",
    )
    yield AudioFrame(
        session_id="sess_voxtral",
        seq=2,
        pcm=b"\x02\x00",
        sample_rate=16_000,
        channels=1,
        start_ms=600,
        end_ms=1200,
        source_lang="en",
        is_final=True,
    )


async def _collect(items: AsyncIterator[Any]) -> list[Any]:
    return [item async for item in items]


def _client(audio: object) -> object:
    audio_namespace = type("FakeAudioNamespace", (), {"realtime": audio})()
    return type("FakeClient", (), {"audio": audio_namespace})()
