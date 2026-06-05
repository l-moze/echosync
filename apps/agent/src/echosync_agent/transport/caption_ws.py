"""字幕事件 WebSocket 服务器。

供 Desktop 端连接并实时接收字幕事件
（transcript.partial / translation.partial / translation.patch / segment.commit）。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import suppress
from dataclasses import replace
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from starlette.middleware.cors import CORSMiddleware

from echosync_agent.domain import AudioFrame
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
        message = {"type": event_type, **payload}
        logger.info(
            "caption_event_published type=%s clients=%d session_id=%s "
            "segment_id=%s source=%s target=%s",
            event_type,
            self.client_count,
            payload.get("session_id", ""),
            payload.get("segment_id", ""),
            _snippet(payload.get("source_text", "")),
            _snippet(payload.get("target_text", "")),
        )
        async with self._lock:
            dead_clients: list[WebSocket] = []
            for ws in self._clients:
                try:
                    await ws.send_json(message)
                except Exception:
                    dead_clients.append(ws)
            # 清理断开的连接
            for ws in dead_clients:
                self._clients.remove(ws)

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
