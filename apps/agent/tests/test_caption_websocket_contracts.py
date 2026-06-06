from __future__ import annotations

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
