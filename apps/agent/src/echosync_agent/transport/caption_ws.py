"""字幕事件 WebSocket 服务器。

供 Desktop 端连接并实时接收字幕事件
（transcript.partial / translation.partial / translation.patch / segment.commit）。
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import suppress
from dataclasses import replace
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from starlette.middleware.cors import CORSMiddleware

from echosync_agent.domain import AudioFrame
from echosync_agent.runtime.capabilities import build_realtime_capabilities
from echosync_agent.runtime.env import load_project_dotenv
from echosync_agent.runtime.settings import Settings
from echosync_agent.transport.realtime_ws import create_realtime_router

logger = logging.getLogger(__name__)

CaptionProducer = Callable[["CaptionEventHub"], Awaitable[None]]
SettingsFactory = Callable[[], Settings]


class CaptionEventHub:
    """字幕事件中枢。Agent 管道发布事件到此处，WebSocket 客户端实时接收。"""

    def __init__(self) -> None:
        self._clients: list[WebSocket] = []
        self._lock = asyncio.Lock()

    async def publish(self, event_type: str, payload: dict[str, Any]) -> None:
        """向所有已连接的 Desktop 客户端推送事件。"""
        published_at_ms = int(time.time() * 1000)
        metrics = payload.get("metrics")
        metrics = {} if not isinstance(metrics, dict) else dict(metrics)
        trace_id = str(payload.get("trace_id") or payload.get("session_id") or "")
        span_id = str(payload.get("span_id") or "")
        message = {
            "type": event_type,
            **payload,
            "metrics": metrics,
            "published_at_ms": published_at_ms,
            "trace_id": trace_id,
            "span_id": span_id,
        }
        async with self._lock:
            clients_before = len(self._clients)
            delivered_clients = 0
            dead_clients: list[WebSocket] = []
            send_started_at = time.perf_counter()
            for ws in self._clients:
                try:
                    await ws.send_json(message)
                    delivered_clients += 1
                except Exception:
                    dead_clients.append(ws)
            caption_send_ms = max((time.perf_counter() - send_started_at) * 1000, 0.0)
            caption_send_failures = len(dead_clients)
            for ws in dead_clients:
                self._clients.remove(ws)
            clients_after = len(self._clients)

        logger.info(
            "caption_event_published type=%s clients_before=%d clients_after=%d "
            "delivered_clients=%d dead_clients=%d session_id=%s segment_id=%s "
            "published_at_ms=%d caption_send_ms=%.1f caption_send_failures=%d "
            "asr_latency_ms=%.1f asr_stream_elapsed_ms=%.1f asr_audio_lag_ms=%.1f "
            "merge_wait_ms=%.1f translation_queue_wait_ms=%.1f "
            "translation_first_token_ms=%.1f translation_latency_ms=%.1f "
            "prompt_cache_hit_tokens=%.1f prompt_cache_miss_tokens=%.1f "
            "deepseek_stream_open_ms=%.1f deepseek_first_delta_ms=%.1f "
            "deepseek_delta_count=%.1f deepseek_prompt_chars=%.1f "
            "deepseek_prefix_chars=%.1f glossary_required_terms=%.1f "
            "glossary_missing_required_terms=%.1f "
            "glossary_repaired_required_terms=%.1f "
            "semantic_revision_latency_ms=%.1f "
            "semantic_revision_changed_chars=%.1f "
            "semantic_revision_trigger_count=%.1f "
            "tts_first_audio_ms=%.1f tts_total_ms=%.1f "
            "tts_audio_chunks=%.1f tts_audio_bytes=%.1f "
            "simul_policy_action=%.1f simul_policy_request_action=%.1f "
            "simul_policy_confidence=%.2f source=%s target=%s",
            event_type,
            clients_before,
            clients_after,
            delivered_clients,
            len(dead_clients),
            payload.get("session_id", ""),
            payload.get("segment_id", ""),
            published_at_ms,
            caption_send_ms,
            caption_send_failures,
            _metric(metrics, "asr_latency_ms"),
            _metric(metrics, "asr_stream_elapsed_ms"),
            _metric(metrics, "asr_audio_lag_ms"),
            _metric(metrics, "merge_wait_ms"),
            _metric(metrics, "translation_queue_wait_ms"),
            _metric(metrics, "translation_first_token_ms"),
            _metric(metrics, "translation_latency_ms"),
            _metric(metrics, "prompt_cache_hit_tokens"),
            _metric(metrics, "prompt_cache_miss_tokens"),
            _metric(metrics, "deepseek_stream_open_ms"),
            _metric(metrics, "deepseek_first_delta_ms"),
            _metric(metrics, "deepseek_delta_count"),
            _metric(metrics, "deepseek_prompt_chars"),
            _metric(metrics, "deepseek_prefix_chars"),
            _metric(metrics, "glossary_required_terms"),
            _metric(metrics, "glossary_missing_required_terms"),
            _metric(metrics, "glossary_repaired_required_terms"),
            _metric(metrics, "semantic_revision_latency_ms"),
            _metric(metrics, "semantic_revision_changed_chars"),
            _metric(metrics, "semantic_revision_trigger_count"),
            _metric(metrics, "tts_first_audio_ms"),
            _metric(metrics, "tts_total_ms"),
            _metric(metrics, "tts_audio_chunks"),
            _metric(metrics, "tts_audio_bytes"),
            _metric(metrics, "simul_policy_action"),
            _metric(metrics, "simul_policy_request_action"),
            _metric(metrics, "simul_policy_confidence"),
            _snippet(payload.get("source_text", "")),
            _snippet(payload.get("target_text", "")),
        )

    async def register(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.append(ws)

    async def unregister(self, ws: WebSocket) -> None:
        async with self._lock:
            if ws in self._clients:
                self._clients.remove(ws)

    @property
    def client_count(self) -> int:
        return len(self._clients)


def create_caption_app(
    hub: CaptionEventHub | None = None,
    producer: CaptionProducer | None = None,
    settings_factory: SettingsFactory | None = None,
) -> FastAPI:
    """创建字幕事件 WebSocket 服务。"""
    resolved_hub = hub or CaptionEventHub()
    app = FastAPI(title="EchoSync Caption Event Service")
    producer_task: asyncio.Task[None] | None = None

    # 允许 Desktop 端跨域连接
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(
        create_realtime_router(
            caption_event_bus=resolved_hub,
            settings_factory=settings_factory,
        )
    )

    @app.get("/healthz")
    async def healthz() -> dict[str, object]:
        return {"ok": True, "service": "echosync-agent"}

    @app.get("/v1/realtime/capabilities")
    async def realtime_capabilities() -> dict[str, Any]:
        settings = (settings_factory or Settings.from_env)()
        return build_realtime_capabilities(settings)

    @app.websocket("/v1/caption/events")
    async def caption_events(websocket: WebSocket) -> None:
        nonlocal producer_task

        await websocket.accept()
        await resolved_hub.register(websocket)

        # 每次客户端连接都运行 producer（确保每个 Desktop 连接都能收到事件）
        if producer is not None:
            # 如果旧任务已完成或尚未创建，直接启动新任务
            if producer_task is None or producer_task.done():
                producer_task = asyncio.create_task(_run_producer(producer, resolved_hub))
            # 如果旧任务还在运行，取消并重新启动
            elif not producer_task.done():
                producer_task.cancel()
                with suppress(asyncio.CancelledError):
                    await producer_task
                producer_task = asyncio.create_task(_run_producer(producer, resolved_hub))

        logger.info("Desktop 已连接，当前连接数: %d", resolved_hub.client_count)
        try:
            # 保持连接，直到客户端断开
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            logger.info("Desktop 已断开，当前连接数: %d", resolved_hub.client_count)
        finally:
            await resolved_hub.unregister(websocket)

    # 暴露 hub 以便外部发布事件
    app.state.hub = resolved_hub
    return app


def _snippet(value: object, limit: int = 48) -> str:
    text = str(value)
    if len(text) <= limit:
        return text
    return f"{text[:limit]}..."


def _metric(metrics: dict[object, object], key: str) -> float:
    value = metrics.get(key)
    if value is None:
        return -1.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return -1.0


async def _run_producer(producer: CaptionProducer, hub: CaptionEventHub) -> None:
    try:
        await producer(hub)
    except Exception:
        logger.exception("字幕事件 producer 运行失败。")


async def run_demo_caption_pipeline(hub: CaptionEventHub) -> None:
    """运行最小 mock 管道，给 Desktop 推送可见字幕事件。"""
    from echosync_agent.runtime import build_demo_pipeline
    from echosync_agent.runtime.settings import Settings

    settings = replace(
        Settings.from_env(),
        asr_provider="mock",
        translator_provider="mock",
    )
    pipeline, _event_bus = build_demo_pipeline(settings=settings, caption_event_bus=hub)
    await pipeline.run(_demo_frames())


async def _demo_frames() -> AsyncIterator[AudioFrame]:
    samples = [
        "EchoSync caption WebSocket is connected.",
        "The overlay should receive live subtitle events now.",
    ]
    for seq, text in enumerate(samples, start=1):
        yield AudioFrame(
            session_id="sess_caption_demo",
            seq=seq,
            pcm=text.encode("utf-8"),
            sample_rate=16_000,
            channels=1,
            start_ms=(seq - 1) * 1_800,
            end_ms=seq * 1_800,
            source_lang="en",
        )


def run_caption_server(port: int = 8766) -> None:
    """独立启动字幕事件 WebSocket 服务。"""
    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    load_project_dotenv()
    settings = Settings.from_env()
    hub = CaptionEventHub()
    app = create_caption_app(hub)

    logger.info(
        "实时字幕服务器启动：caption=ws://127.0.0.1:%d/v1/caption/events "
        "realtime=ws://127.0.0.1:%d/v1/realtime/sessions/{session_id} "
        "asr=%s translator=%s",
        port,
        port,
        settings.asr_provider,
        settings.translator_provider,
    )
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        reload=False,
    )


if __name__ == "__main__":
    run_caption_server()
