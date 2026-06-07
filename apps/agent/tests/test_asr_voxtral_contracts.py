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
    assert segments[0].metrics["asr_stream_elapsed_ms"] >= 0
    assert segments[0].metrics["asr_audio_lag_ms"] >= 0


def test_voxtral_stream_does_not_report_stream_elapsed_as_asr_latency() -> None:
    class FakeRealtimeAudio:
        async def transcribe_stream(self, **kwargs: Any) -> AsyncIterator[object]:
            async for _chunk in kwargs["audio_stream"]:
                pass
            await asyncio.sleep(0.02)
            yield FakeTextDelta("hello")
            yield FakeDone()

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

    assert "asr_latency_ms" not in segments[0].metrics
    assert segments[0].metrics["asr_stream_elapsed_ms"] >= 20
    assert segments[0].metrics["asr_audio_lag_ms"] >= 0


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


def test_voxtral_stream_does_not_attach_short_delta_to_long_cumulative_window() -> None:
    class FakeRealtimeAudio:
        async def transcribe_stream(self, **kwargs: Any) -> AsyncIterator[object]:
            async for _chunk in kwargs["audio_stream"]:
                pass
            yield FakeTextDelta("better.")
            yield FakeDone()

    transcriber = VoxtralRealtimeTranscriber(
        config=VoxtralRealtimeConfig(
            api_key="test-key",
            target_streaming_delay_ms=1_000,
        ),
        client_factory=lambda _api_key: _client(FakeRealtimeAudio()),
        event_types={
            "session_created": FakeSessionCreated,
            "text_delta": FakeTextDelta,
            "done": FakeDone,
            "error": FakeRealtimeError,
        },
    )

    segments = asyncio.run(_collect(transcriber.stream(_frames_after_long_gap())))

    assert len(segments) == 1
    assert segments[0].text == "better."
    assert segments[0].start_ms >= 298_000
    assert segments[0].end_ms == 299_000
    assert segments[0].end_ms - segments[0].start_ms <= 2_400
    assert segments[0].metrics["asr_provider_audio_window_ms"] == 300_000.0


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


def test_voxtral_stream_sends_silence_keepalive_while_frames_are_idle() -> None:
    captured_chunks: list[bytes] = []

    class FakeRealtimeAudio:
        async def transcribe_stream(self, **kwargs: Any) -> AsyncIterator[object]:
            async for chunk in kwargs["audio_stream"]:
                captured_chunks.append(chunk)
                if chunk == b"\x02\x00":
                    break
            yield FakeDone()

    transcriber = VoxtralRealtimeTranscriber(
        config=VoxtralRealtimeConfig(api_key="test-key", silence_keepalive_ms=10),
        client_factory=lambda _api_key: _client(FakeRealtimeAudio()),
        event_types={
            "session_created": FakeSessionCreated,
            "text_delta": FakeTextDelta,
            "done": FakeDone,
            "error": FakeRealtimeError,
        },
    )

    asyncio.run(_collect(transcriber.stream(_delayed_frames())))

    assert captured_chunks[0] == b"\x01\x00"
    assert b"\x00" * 320 in captured_chunks
    assert captured_chunks[-1] == b"\x02\x00"


def test_voxtral_stream_does_not_send_empty_endpoint_markers_as_audio() -> None:
    captured_chunks: list[bytes] = []

    class FakeRealtimeAudio:
        async def transcribe_stream(self, **kwargs: Any) -> AsyncIterator[object]:
            async for chunk in kwargs["audio_stream"]:
                captured_chunks.append(chunk)
            yield FakeDone()

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

    asyncio.run(_collect(transcriber.stream(_frames_with_empty_final_marker())))

    assert captured_chunks == [b"\x01\x00"]


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


async def _delayed_frames() -> AsyncIterator[AudioFrame]:
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
    await asyncio.sleep(0.025)
    yield AudioFrame(
        session_id="sess_voxtral",
        seq=2,
        pcm=b"\x02\x00",
        sample_rate=16_000,
        channels=1,
        start_ms=600,
        end_ms=1200,
        source_lang="en",
    )


async def _frames_with_empty_final_marker() -> AsyncIterator[AudioFrame]:
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
        pcm=b"",
        sample_rate=16_000,
        channels=1,
        start_ms=600,
        end_ms=600,
        source_lang="en",
        is_final=True,
    )


async def _frames_after_long_gap() -> AsyncIterator[AudioFrame]:
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
        start_ms=299_400,
        end_ms=300_000,
        source_lang="en",
        is_final=True,
    )


async def _collect(items: AsyncIterator[Any]) -> list[Any]:
    return [item async for item in items]


def _client(audio: object) -> object:
    audio_namespace = type("FakeAudioNamespace", (), {"realtime": audio})()
    return type("FakeClient", (), {"audio": audio_namespace})()
