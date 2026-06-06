from __future__ import annotations

import asyncio
import base64
from dataclasses import replace
from typing import Any

from fastapi.testclient import TestClient

from echosync_agent.runtime.settings import (
    Settings,
    with_session_asr_overrides,
    with_session_translation_overrides,
)
from echosync_agent.transport.caption_ws import CaptionEventHub, create_caption_app
from echosync_agent.transport.realtime_ws import (
    AUDIO_FRAME_HEADER,
    AUDIO_FRAME_MAGIC,
    _RealtimeTransportMetrics,
    _RealtimeWebSocketSession,
    _transport_latency_ms_from_low32,
)


def test_realtime_websocket_publishes_translated_captions_to_caption_clients() -> None:
    settings = replace(
        Settings.from_env(),
        asr_provider="mock",
        translator_provider="mock",
        glossary_enabled=False,
    )
    app = create_caption_app(hub=CaptionEventHub(), settings_factory=lambda: settings)
    client = TestClient(app)

    with (
        client.websocket_connect("/v1/caption/events") as captions,
        client.websocket_connect("/v1/realtime/sessions/sess_realtime") as realtime,
    ):
        realtime.send_json(
            {
                "type": "audio.start",
                "source_lang": "en",
                "sample_rate": 16_000,
                "channels": 1,
                "source_kind": "network_stream",
                "device_id": "loopback",
            }
        )
        realtime.send_json(
            {
                "type": "audio.chunk",
                "seq": 1,
                "start_ms": 0,
                "end_ms": 640,
                "pcm_base64": _b64("Hello realtime captions"),
                "is_final": True,
            }
        )
        realtime.send_json({"type": "audio.end"})

        done: dict[str, Any] = realtime.receive_json()
        received: list[dict[str, Any]] = []
        for _ in range(20):
            event = captions.receive_json()
            received.append(event)
            if event["type"] == "caption_update" and event.get("state") == "final":
                break
        else:
            raise AssertionError("expected final caption_update before websocket test timeout")

    assert done == {"type": "realtime.done", "session_id": "sess_realtime"}
    first_caption = received[0]
    assert first_caption["type"] == "transcript.partial"
    assert first_caption["session_id"] == "sess_realtime"
    assert first_caption["source_text"] == "Hello realtime captions"
    assert first_caption["target_text"] == ""
    first_update = received[1]
    assert first_update["type"] == "caption_update"
    assert first_update["segment_id"] == first_caption["segment_id"]
    assert first_update["source"]["full_text"] == "Hello realtime captions"
    final_caption = next(
        event for event in received if event.get("target_text") == "[zh] Hello realtime captions"
    )
    assert final_caption["type"] == "translation.partial"
    commit_index = next(
        index for index, event in enumerate(received) if event["type"] == "segment.commit"
    )
    assert received[commit_index]["target_text"] == "[zh] Hello realtime captions"
    final_update = received[-1]
    assert final_update["type"] == "caption_update"
    assert final_update["state"] == "final"
    assert final_update["segment_id"] == received[commit_index]["segment_id"]
    assert final_update["target"]["full_text"] == "[zh] Hello realtime captions"


def test_realtime_websocket_rejects_mock_asr_for_real_audio_sources() -> None:
    settings = replace(
        Settings.from_env(),
        asr_provider="mock",
        translator_provider="mock",
        glossary_enabled=False,
    )
    app = create_caption_app(hub=CaptionEventHub(), settings_factory=lambda: settings)
    client = TestClient(app)

    with client.websocket_connect("/v1/realtime/sessions/sess_mock_pcm") as realtime:
        realtime.send_json(
            {
                "type": "audio.start",
                "source_lang": "en",
                "sample_rate": 16_000,
                "channels": 1,
                "source_kind": "windows_system",
                "device_id": "loopback",
            }
        )
        error: dict[str, Any] = realtime.receive_json()

    assert error["type"] == "realtime.error"
    assert "mock ASR" in error["message"]
    assert "真实音频" in error["message"]


def test_caption_app_exposes_realtime_capabilities() -> None:
    settings = replace(
        Settings.from_env(),
        asr_provider="mock",
        translator_provider="mock",
        glossary_enabled=False,
    )
    app = create_caption_app(hub=CaptionEventHub(), settings_factory=lambda: settings)
    client = TestClient(app)

    response = client.get("/v1/realtime/capabilities")

    assert response.status_code == 200
    payload = response.json()
    assert payload["defaults"]["asr_provider"] == "mock"
    assert payload["defaults"]["translation_provider"] == "mock"
    assert payload["asr_latency_modes"] == ["low_latency", "balanced", "accuracy"]
    assert any(provider["id"] == "funasr" for provider in payload["asr_providers"])


def test_caption_app_exposes_health_check() -> None:
    app = create_caption_app(hub=CaptionEventHub())
    client = TestClient(app)

    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "service": "echosync-agent"}


def test_realtime_session_does_not_fail_when_client_closes_before_done() -> None:
    asyncio.run(_run_realtime_session_stop_without_done_test())


def test_realtime_session_start_error_does_not_send_done() -> None:
    asyncio.run(_run_realtime_session_start_error_does_not_send_done_test())


def test_realtime_session_publishes_pipeline_errors_to_caption_hub() -> None:
    asyncio.run(_run_realtime_session_pipeline_error_publish_test())


def test_realtime_session_accepts_binary_pcm_audio_frames() -> None:
    asyncio.run(_run_realtime_session_binary_pcm_frame_test())


def test_realtime_session_accepts_audio_final_control_message(monkeypatch: Any) -> None:
    captured_frames: list[Any] = []

    def fake_build_demo_pipeline(**_kwargs: Any) -> tuple[object, object]:
        return _CaptureFramesPipeline(captured_frames), object()

    monkeypatch.setattr(
        "echosync_agent.transport.realtime_ws.build_demo_pipeline",
        fake_build_demo_pipeline,
    )

    asyncio.run(_run_realtime_session_audio_final_control_test())

    assert len(captured_frames) == 2
    assert captured_frames[0].pcm == b"speech"
    assert captured_frames[0].is_final is False
    assert captured_frames[1].pcm == b""
    assert captured_frames[1].is_final is True
    assert captured_frames[1].seq == 7
    assert captured_frames[1].start_ms == 160
    assert captured_frames[1].end_ms == 160


def test_realtime_transport_metrics_aggregates_and_resets_audio_frames() -> None:
    metrics = _RealtimeTransportMetrics(log_interval_sec=999)
    metrics.record_audio_frame(
        _audio_frame(seq=1, pcm=b"abcd", start_ms=0, end_ms=80)
    )
    metrics.record_audio_frame(
        _audio_frame(seq=2, pcm=b"abcdef", start_ms=80, end_ms=160)
    )
    metrics.transport_latencies_ms = [1.0, 2.0, 30.0]

    snapshot = metrics.snapshot_and_reset(queue_depth=3, session_id="sess_metrics")

    assert snapshot.frames == 2
    assert snapshot.audio_ms == 160
    assert snapshot.bytes_received == 10
    assert snapshot.avg_transport_latency_ms == 11.0
    assert snapshot.p95_transport_latency_ms == 30.0
    assert snapshot.queue_depth == 3
    assert metrics.frames == 0
    assert metrics.audio_ms == 0


def test_transport_latency_uses_low_32_bit_timestamp() -> None:
    now_ms = 1_778_116_460_666
    sent_at_ms_low = now_ms & 0xFFFFFFFF

    assert _transport_latency_ms_from_low32(sent_at_ms_low, now_ms=now_ms + 37) == 37.0


def test_realtime_session_cancels_pipeline_on_user_stop() -> None:
    asyncio.run(_run_realtime_session_user_stop_cancels_pipeline_test())


def test_realtime_session_user_stop_reports_prefailed_pipeline(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "echosync_agent.transport.realtime_ws.build_demo_pipeline",
        lambda **_kwargs: (_FailingPipeline(), object()),
    )

    asyncio.run(_run_realtime_session_user_stop_reports_prefailed_pipeline_test())


def test_realtime_session_publishes_active_pipeline_failure(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "echosync_agent.transport.realtime_ws.build_demo_pipeline",
        lambda **_kwargs: (_FailingPipeline(), object()),
    )

    asyncio.run(_run_realtime_session_active_pipeline_failure_test())


def test_realtime_session_applies_asr_provider_from_audio_start(monkeypatch: Any) -> None:
    captured: list[Settings] = []

    def fake_build_demo_pipeline(**kwargs: Any) -> tuple[object, object]:
        captured.append(kwargs["settings"])
        return _NoopPipeline(), object()

    monkeypatch.setattr(
        "echosync_agent.transport.realtime_ws.build_demo_pipeline",
        fake_build_demo_pipeline,
    )

    asyncio.run(_run_realtime_session_asr_provider_override_test())

    assert captured[0].asr_provider == "funasr"
    assert captured[0].asr_latency_mode == "balanced"


def test_realtime_session_applies_translation_provider_from_audio_start(monkeypatch: Any) -> None:
    captured: list[Settings] = []

    def fake_build_demo_pipeline(**kwargs: Any) -> tuple[object, object]:
        captured.append(kwargs["settings"])
        return _NoopPipeline(), object()

    monkeypatch.setattr(
        "echosync_agent.transport.realtime_ws.build_demo_pipeline",
        fake_build_demo_pipeline,
    )

    asyncio.run(_run_realtime_session_translation_provider_override_test())

    assert captured[0].translator_provider == "deepseek"


def test_session_asr_override_rejects_candidate_provider_until_adapter_exists() -> None:
    settings = replace(Settings.from_env(), asr_provider="mock")

    try:
        with_session_asr_overrides(settings, asr_provider="deepgram")
    except ValueError as exc:
        assert "Deepgram" in str(exc)
        assert "尚未接入" in str(exc)
    else:
        raise AssertionError("deepgram must stay unavailable until its adapter is implemented")


def test_session_translation_override_rejects_unknown_provider() -> None:
    settings = replace(Settings.from_env(), translator_provider="mock")

    try:
        with_session_translation_overrides(settings, translation_provider="qwen")
    except ValueError as exc:
        assert "不支持的翻译 provider" in str(exc)
    else:
        raise AssertionError("unknown translation provider must be rejected")


async def _run_realtime_session_stop_without_done_test() -> None:
    settings = replace(
        Settings.from_env(),
        asr_provider="mock",
        translator_provider="mock",
        glossary_enabled=False,
    )
    websocket = _ClosingBeforeDoneWebSocket(
        [
            {
                "type": "audio.start",
                "source_lang": "en",
                "sample_rate": 16_000,
                "channels": 1,
                "source_kind": "network_stream",
            },
            {"type": "audio.end"},
        ]
    )
    session = _RealtimeWebSocketSession(
        websocket=websocket,  # type: ignore[arg-type]
        session_id="sess_stop",
        settings=settings,
        caption_event_bus=CaptionEventHub(),
    )

    await session.run()

    assert websocket.sent_messages == [{"type": "realtime.done", "session_id": "sess_stop"}]


async def _run_realtime_session_pipeline_error_publish_test() -> None:
    settings = replace(
        Settings.from_env(),
        asr_provider="mock",
        translator_provider="mock",
        glossary_enabled=False,
    )
    websocket = _MemoryWebSocket(
        [
            {
                "type": "audio.start",
                "source_lang": "en",
                "sample_rate": 16_000,
                "channels": 1,
                "source_kind": "network_stream",
            },
            {
                "type": "audio.chunk",
                "seq": 1,
                "start_ms": 0,
                "end_ms": 640,
                "pcm_base64": "not valid base64",
            },
            {"type": "audio.end"},
        ]
    )
    hub = _MemoryCaptionHub()
    session = _RealtimeWebSocketSession(
        websocket=websocket,  # type: ignore[arg-type]
        session_id="sess_error",
        settings=settings,
        caption_event_bus=hub,
    )

    await session.run()

    assert websocket.sent_messages[0]["type"] == "realtime.error"
    assert websocket.sent_messages[0]["session_id"] == "sess_error"
    assert hub.events[0][0] == "realtime.error"
    assert hub.events[0][1]["type"] == "realtime.error"
    assert hub.events[0][1]["session_id"] == "sess_error"


async def _run_realtime_session_binary_pcm_frame_test() -> None:
    settings = replace(
        Settings.from_env(),
        asr_provider="mock",
        translator_provider="mock",
        glossary_enabled=False,
    )
    pcm = b"Hello binary realtime"
    websocket = _MemoryWebSocket(
        [
            {
                "type": "audio.start",
                "source_lang": "en",
                "sample_rate": 16_000,
                "channels": 1,
                "source_kind": "network_stream",
            },
            _binary_audio_frame(
                pcm=pcm,
                seq=7,
                start_ms=80,
                end_ms=160,
                sent_at_ms=12345,
            ),
            {"type": "audio.end"},
        ]
    )
    hub = _MemoryCaptionHub()
    session = _RealtimeWebSocketSession(
        websocket=websocket,  # type: ignore[arg-type]
        session_id="sess_binary",
        settings=settings,
        caption_event_bus=hub,
    )

    await session.run()

    translation_events = [
        payload for event_type, payload in hub.events if event_type == "translation.partial"
    ]
    assert translation_events[0]["source_text"] == "Hello binary realtime"


async def _run_realtime_session_audio_final_control_test() -> None:
    settings = replace(
        Settings.from_env(),
        asr_provider="mock",
        translator_provider="mock",
        glossary_enabled=False,
    )
    websocket = _MemoryWebSocket(
        [
            {
                "type": "audio.start",
                "source_lang": "en",
                "sample_rate": 16_000,
                "channels": 1,
                "source_kind": "network_stream",
            },
            _binary_audio_frame(
                pcm=b"speech",
                seq=7,
                start_ms=80,
                end_ms=160,
                sent_at_ms=12345,
            ),
            {
                "type": "audio.final",
                "seq": 7,
                "start_ms": 160,
                "end_ms": 160,
            },
            {"type": "audio.end"},
        ]
    )
    session = _RealtimeWebSocketSession(
        websocket=websocket,  # type: ignore[arg-type]
        session_id="sess_audio_final",
        settings=settings,
        caption_event_bus=CaptionEventHub(),
    )

    await session.run()


async def _run_realtime_session_user_stop_cancels_pipeline_test() -> None:
    settings = replace(
        Settings.from_env(),
        asr_provider="mock",
        translator_provider="mock",
        glossary_enabled=False,
    )
    websocket = _MemoryWebSocket(
        [
            {
                "type": "audio.start",
                "source_lang": "en",
                "sample_rate": 16_000,
                "channels": 1,
                "source_kind": "network_stream",
            },
            {
                "type": "audio.chunk",
                "seq": 1,
                "start_ms": 0,
                "end_ms": 640,
                "pcm_base64": _b64("This queued audio must not finish translating"),
            },
            {"type": "audio.end", "reason": "user_stop"},
        ]
    )
    hub = _MemoryCaptionHub()
    session = _RealtimeWebSocketSession(
        websocket=websocket,  # type: ignore[arg-type]
        session_id="sess_user_stop",
        settings=settings,
        caption_event_bus=hub,
    )

    await session.run()

    assert websocket.sent_messages == []
    assert not [event for event in hub.events if event[0] == "realtime.done"]


async def _run_realtime_session_start_error_does_not_send_done_test() -> None:
    settings = replace(
        Settings.from_env(),
        asr_provider="mock",
        translator_provider="mock",
        glossary_enabled=False,
    )
    websocket = _MemoryWebSocket(
        [
            {
                "type": "audio.start",
                "source_lang": "en",
                "sample_rate": 16_000,
                "channels": 1,
                "source_kind": "windows_system",
            },
        ]
    )
    hub = _MemoryCaptionHub()
    session = _RealtimeWebSocketSession(
        websocket=websocket,  # type: ignore[arg-type]
        session_id="sess_start_error",
        settings=settings,
        caption_event_bus=hub,
    )

    await session.run()

    assert [message["type"] for message in websocket.sent_messages] == ["realtime.error"]
    assert websocket.sent_messages[0]["type"] == "realtime.error"
    assert "mock ASR" in websocket.sent_messages[0]["message"]
    assert not [event for event in hub.events if event[0] == "realtime.done"]


async def _run_realtime_session_user_stop_reports_prefailed_pipeline_test() -> None:
    settings = replace(
        Settings.from_env(),
        asr_provider="mock",
        translator_provider="mock",
        glossary_enabled=False,
    )
    websocket = _MemoryWebSocket(
        [
            {
                "type": "audio.start",
                "source_lang": "en",
                "sample_rate": 16_000,
                "channels": 1,
                "source_kind": "network_stream",
            },
            {"type": "audio.end", "reason": "user_stop"},
        ]
    )
    hub = _MemoryCaptionHub()
    session = _RealtimeWebSocketSession(
        websocket=websocket,  # type: ignore[arg-type]
        session_id="sess_prefailed_stop",
        settings=settings,
        caption_event_bus=hub,
    )

    await session.run()

    assert websocket.sent_messages[0]["type"] == "realtime.error"
    assert "provider connect failed" in websocket.sent_messages[0]["message"]
    assert hub.events[0][0] == "realtime.error"
    done_messages = [
        message for message in websocket.sent_messages if message["type"] == "realtime.done"
    ]
    assert not done_messages


async def _run_realtime_session_active_pipeline_failure_test() -> None:
    settings = replace(
        Settings.from_env(),
        asr_provider="mock",
        translator_provider="mock",
        glossary_enabled=False,
    )
    websocket = _MemoryWebSocket(
        [
            {
                "type": "audio.start",
                "source_lang": "en",
                "sample_rate": 16_000,
                "channels": 1,
                "source_kind": "network_stream",
            },
        ]
    )
    hub = _MemoryCaptionHub()
    session = _RealtimeWebSocketSession(
        websocket=websocket,  # type: ignore[arg-type]
        session_id="sess_active_failure",
        settings=settings,
        caption_event_bus=hub,
    )

    await session.run()

    assert websocket.sent_messages[0]["type"] == "realtime.error"
    assert "provider connect failed" in websocket.sent_messages[0]["message"]
    assert hub.events[0][0] == "realtime.error"


async def _run_realtime_session_asr_provider_override_test() -> None:
    settings = replace(
        Settings.from_env(),
        asr_provider="mock",
        translator_provider="mock",
        glossary_enabled=False,
    )
    websocket = _MemoryWebSocket(
        [
            {
                "type": "audio.start",
                "source_lang": "en",
                "sample_rate": 16_000,
                "channels": 1,
                "source_kind": "network_stream",
                "asr_provider": "funasr",
                "asr_latency_mode": "balanced",
            },
            {"type": "audio.end"},
        ]
    )
    session = _RealtimeWebSocketSession(
        websocket=websocket,  # type: ignore[arg-type]
        session_id="sess_asr_override",
        settings=settings,
        caption_event_bus=CaptionEventHub(),
    )

    await session.run()


async def _run_realtime_session_translation_provider_override_test() -> None:
    settings = replace(
        Settings.from_env(),
        asr_provider="mock",
        translator_provider="mock",
        glossary_enabled=False,
    )
    websocket = _MemoryWebSocket(
        [
            {
                "type": "audio.start",
                "source_lang": "en",
                "sample_rate": 16_000,
                "channels": 1,
                "source_kind": "network_stream",
                "translation_provider": "deepseek",
            },
            {"type": "audio.end"},
        ]
    )
    session = _RealtimeWebSocketSession(
        websocket=websocket,  # type: ignore[arg-type]
        session_id="sess_translation_override",
        settings=settings,
        caption_event_bus=CaptionEventHub(),
    )

    await session.run()


class _ClosingBeforeDoneWebSocket:
    def __init__(self, received_messages: list[dict[str, Any]]) -> None:
        self._received_messages = received_messages
        self.sent_messages: list[dict[str, Any]] = []

    async def receive_json(self) -> dict[str, Any]:
        return self._received_messages.pop(0)

    async def receive(self) -> dict[str, Any]:
        return {"type": "websocket.receive", "text": _json_dumps(self._received_messages.pop(0))}

    async def send_json(self, message: dict[str, Any]) -> None:
        self.sent_messages.append(message)
        raise RuntimeError("client already closed")


class _MemoryWebSocket:
    def __init__(self, received_messages: list[dict[str, Any]]) -> None:
        self._received_messages = received_messages
        self.sent_messages: list[dict[str, Any]] = []

    async def receive(self) -> dict[str, Any]:
        if not self._received_messages:
            await asyncio.sleep(0)
            return {"type": "websocket.disconnect"}
        message = self._received_messages.pop(0)
        if isinstance(message, bytes):
            return {"type": "websocket.receive", "bytes": message}
        return {"type": "websocket.receive", "text": _json_dumps(message)}

    async def receive_json(self) -> dict[str, Any]:
        message = self._received_messages.pop(0)
        if isinstance(message, bytes):
            raise TypeError("binary message cannot be received as json")
        return message

    async def send_json(self, message: dict[str, Any]) -> None:
        self.sent_messages.append(message)


class _MemoryCaptionHub:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []

    async def publish(self, event_type: str, payload: dict[str, Any]) -> None:
        self.events.append((event_type, payload))


class _FailingPipeline:
    async def run(self, _frames: Any) -> None:
        raise RuntimeError("provider connect failed")


class _NoopPipeline:
    async def run(self, frames: Any) -> None:
        async for _frame in frames:
            pass


class _CaptureFramesPipeline:
    def __init__(self, captured_frames: list[Any]) -> None:
        self.captured_frames = captured_frames

    async def run(self, frames: Any) -> None:
        async for frame in frames:
            self.captured_frames.append(frame)


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def _binary_audio_frame(
    *,
    pcm: bytes,
    seq: int,
    start_ms: int,
    end_ms: int,
    sent_at_ms: int,
) -> bytes:
    return AUDIO_FRAME_HEADER.pack(AUDIO_FRAME_MAGIC, 1, 0, seq, start_ms, end_ms, sent_at_ms) + pcm


def _json_dumps(message: dict[str, Any]) -> str:
    import json

    return json.dumps(message)


def _audio_frame(*, seq: int, pcm: bytes, start_ms: int, end_ms: int):
    from echosync_agent.domain import AudioFrame, AudioSourceKind

    return AudioFrame(
        session_id="sess_metrics",
        seq=seq,
        pcm=pcm,
        sample_rate=16_000,
        channels=1,
        start_ms=start_ms,
        end_ms=end_ms,
        source_lang="en",
        source_kind=AudioSourceKind.NETWORK_STREAM,
    )
