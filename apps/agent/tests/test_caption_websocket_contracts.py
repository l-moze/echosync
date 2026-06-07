from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi.testclient import TestClient

from echosync_agent.transport import caption_ws
from echosync_agent.transport.caption_ws import CaptionEventHub, create_caption_app


def test_caption_websocket_starts_producer_for_connected_client() -> None:
    async def publish_demo_caption(hub: CaptionEventHub) -> None:
        await hub.publish(
            "translation.partial",
            {
                "session_id": "sess_caption_demo",
                "segment_id": "seg_caption_demo",
                "rev": 1,
                "source_lang": "en",
                "target_lang": "zh-CN",
                "source_text": "Hello from the caption pipeline.",
                "target_text": "[zh] Hello from the caption pipeline.",
                "status": "committed",
                "stability": 1.0,
                "start_ms": 0,
                "end_ms": 1600,
                "metrics": {
                    "asr_latency_ms": 80.0,
                    "translation_first_token_ms": 120.0,
                    "translation_latency_ms": 180.0,
                },
            },
        )

    app = create_caption_app(producer=publish_demo_caption)
    client = TestClient(app)

    with client.websocket_connect("/v1/caption/events") as websocket:
        message: dict[str, Any] = websocket.receive_json()

    assert message["type"] == "translation.partial"
    assert message["target_text"] == "[zh] Hello from the caption pipeline."
    assert isinstance(message["published_at_ms"], int)
    assert message["span_id"] == ""
    assert "caption_send_ms" not in message["metrics"]
    assert "caption_send_failures" not in message["metrics"]


def test_caption_websocket_handles_missing_span_id_without_crashing() -> None:
    async def publish_demo_caption(hub: CaptionEventHub) -> None:
        await hub.publish(
            "translation.partial",
            {
                "session_id": "sess_caption_demo",
                "segment_id": "seg_caption_demo",
                "rev": 1,
                "source_lang": "en",
                "target_lang": "zh-CN",
                "source_text": "Hello from the caption pipeline.",
                "target_text": "[zh] Hello from the caption pipeline.",
                "status": "committed",
                "stability": 1.0,
                "start_ms": 0,
                "end_ms": 1600,
                "metrics": {
                    "asr_latency_ms": 80.0,
                    "translation_first_token_ms": 120.0,
                    "translation_latency_ms": 180.0,
                },
            },
        )

    app = create_caption_app(producer=publish_demo_caption)
    client = TestClient(app)

    with client.websocket_connect("/v1/caption/events") as websocket:
        message: dict[str, Any] = websocket.receive_json()

    assert message["type"] == "translation.partial"
    assert message["target_text"] == "[zh] Hello from the caption pipeline."
    assert isinstance(message["published_at_ms"], int)


def test_caption_event_hub_logs_deepseek_and_glossary_metrics(caplog) -> None:
    hub = CaptionEventHub()

    with caplog.at_level(logging.INFO):
        asyncio.run(
            hub.publish(
                "caption_update",
                {
                    "session_id": "sess_caption_metrics",
                    "segment_id": "seg_caption_metrics",
                    "source_text": "LiveKit can reduce latency.",
                    "target_text": "实时媒体引擎可以降低延迟。",
                    "metrics": {
                        "prompt_cache_hit_tokens": 80.0,
                        "prompt_cache_miss_tokens": 20.0,
                        "deepseek_stream_open_ms": 35.0,
                        "deepseek_first_delta_ms": 105.0,
                        "deepseek_delta_count": 4.0,
                        "deepseek_prompt_chars": 720.0,
                        "deepseek_prefix_chars": 18.0,
                        "glossary_required_terms": 2.0,
                        "glossary_missing_required_terms": 1.0,
                        "glossary_repaired_required_terms": 1.0,
                    },
                },
            )
        )

    message = next(
        record.getMessage()
        for record in caplog.records
        if "caption_event_published" in record.getMessage()
    )
    assert "prompt_cache_hit_tokens=80.0" in message
    assert "prompt_cache_miss_tokens=20.0" in message
    assert "deepseek_stream_open_ms=35.0" in message
    assert "deepseek_first_delta_ms=105.0" in message
    assert "deepseek_delta_count=4.0" in message
    assert "deepseek_prompt_chars=720.0" in message
    assert "deepseek_prefix_chars=18.0" in message
    assert "glossary_required_terms=2.0" in message
    assert "glossary_missing_required_terms=1.0" in message
    assert "glossary_repaired_required_terms=1.0" in message


def test_caption_server_does_not_start_demo_producer_by_default(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    def fake_create_caption_app(
        hub: CaptionEventHub | None = None,
        producer: Any = None,
        settings_factory: Any = None,
    ) -> object:
        captured["producer"] = producer
        captured["settings_factory"] = settings_factory
        return object()

    class FakeUvicorn:
        @staticmethod
        def run(*args: Any, **kwargs: Any) -> None:
            captured["uvicorn_args"] = args
            captured["uvicorn_kwargs"] = kwargs

    monkeypatch.setattr(caption_ws, "create_caption_app", fake_create_caption_app)
    monkeypatch.setitem(__import__("sys").modules, "uvicorn", FakeUvicorn)

    caption_ws.run_caption_server(port=9876)

    assert captured["producer"] is None
    assert captured["uvicorn_kwargs"]["port"] == 9876
