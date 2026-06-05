from __future__ import annotations

import asyncio
import base64
from collections.abc import AsyncIterator, Callable
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from echosync_agent.domain import AudioFrame, AudioSourceKind, TranscriptSegment
from echosync_agent.interfaces import Transcriber
from echosync_agent.runtime.assembly import _build_transcriber
from echosync_agent.runtime.env import load_project_dotenv
from echosync_agent.runtime.settings import Settings

TranscriberFactory = Callable[[], Transcriber]


def _default_transcriber_factory() -> Transcriber:
    return _build_transcriber(Settings.from_env())


def create_asr_app(transcriber_factory: TranscriberFactory | None = None) -> FastAPI:
    """创建最小 ASR 会话服务。

    这个入口只负责 WebSocket 协议和 AudioFrame 转换；模型加载仍由 Transcriber
    适配器负责，翻译、修正和字幕输出不在这里耦合。
    """

    app = FastAPI(title="EchoSync ASR Service")
    resolved_factory = transcriber_factory or _default_transcriber_factory

    @app.websocket("/v1/asr/sessions/{session_id}")
    async def asr_session(websocket: WebSocket, session_id: str) -> None:
        await websocket.accept()
        session = _AsrWebSocketSession(
            websocket=websocket,
            session_id=session_id,
            transcriber=resolved_factory(),
        )
        await session.run()

    return app


app = create_asr_app()


def run() -> None:
    """启动本地 ASR WebSocket 服务。"""

    import uvicorn

    load_project_dotenv()
    settings = Settings.from_env()
    uvicorn.run(
        "echosync_agent.transport.asr_websocket:app",
        host="127.0.0.1",
        port=settings.asr_server_port,
        reload=False,
    )

class _AsrWebSocketSession:
    def __init__(self, websocket: WebSocket, session_id: str, transcriber: Transcriber) -> None:
        self.websocket = websocket
        self.session_id = session_id
        self.transcriber = transcriber
        self.queue: asyncio.Queue[AudioFrame | None] = asyncio.Queue()
        self.source_lang = "auto"
        self.sample_rate = 16_000
        self.channels = 1
        self.source_kind = AudioSourceKind.NETWORK_STREAM
        self.device_id: str | None = None

    async def run(self) -> None:
        sender = asyncio.create_task(self._send_segments())
        try:
            while True:
                try:
                    message = await self.websocket.receive_json()
                except WebSocketDisconnect:
                    await self._finish_stream()
                    break

                should_stop = await self._handle_message(message)
                if should_stop:
                    break
        finally:
            await self._finish_stream()
            await sender

    async def _send_segments(self) -> None:
        async for segment in self.transcriber.stream(self._frames()):
            await self.websocket.send_json(_serialize_segment(segment))
        await self.websocket.send_json({"type": "asr.done", "session_id": self.session_id})

    async def _frames(self) -> AsyncIterator[AudioFrame]:
        while True:
            frame = await self.queue.get()
            if frame is None:
                return
            yield frame

    async def _handle_message(self, message: dict[str, Any]) -> bool:
        message_type = message.get("type")
        if message_type == "asr.start":
            self._apply_start_message(message)
            return False
        if message_type == "audio.chunk":
            frame = await self._build_audio_frame(message)
            if frame is None:
                return False
            await self.queue.put(frame)
            return frame.is_final
        if message_type == "asr.end":
            return True

        await self._send_error(f"不支持的 ASR WebSocket 消息类型：{message_type}")
        return False

    def _apply_start_message(self, message: dict[str, Any]) -> None:
        self.source_lang = str(message.get("source_lang", self.source_lang))
        self.sample_rate = int(message.get("sample_rate", self.sample_rate))
        self.channels = int(message.get("channels", self.channels))
        self.source_kind = AudioSourceKind(str(message.get("source_kind", self.source_kind)))
        device_id = message.get("device_id", self.device_id)
        self.device_id = None if device_id is None else str(device_id)

    async def _build_audio_frame(self, message: dict[str, Any]) -> AudioFrame | None:
        try:
            pcm = base64.b64decode(str(message["pcm_base64"]), validate=True)
        except (KeyError, ValueError) as exc:
            await self._send_error(f"pcm_base64 无效：{exc}")
            return None

        return AudioFrame(
            session_id=self.session_id,
            seq=int(message.get("seq", 0)),
            pcm=pcm,
            sample_rate=int(message.get("sample_rate", self.sample_rate)),
            channels=int(message.get("channels", self.channels)),
            start_ms=int(message.get("start_ms", 0)),
            end_ms=int(message.get("end_ms", 0)),
            source_lang=str(message.get("source_lang", self.source_lang)),
            source_kind=AudioSourceKind(str(message.get("source_kind", self.source_kind))),
            device_id=self.device_id if message.get("device_id") is None else str(message["device_id"]),
            is_final=bool(message.get("is_final", False)),
        )

    async def _send_error(self, message: str) -> None:
        await self.websocket.send_json(
            {
                "type": "asr.error",
                "session_id": self.session_id,
                "message": message,
            }
        )

    async def _finish_stream(self) -> None:
        await self.queue.put(None)


def _serialize_segment(segment: TranscriptSegment) -> dict[str, Any]:
    return {
        "type": "asr.segment",
        "session_id": segment.session_id,
        "segment_id": segment.segment_id,
        "rev": segment.rev,
        "start_ms": segment.start_ms,
        "end_ms": segment.end_ms,
        "source_lang": segment.source_lang,
        "text": segment.text,
        "status": str(segment.status),
        "stability": segment.stability,
        "speaker": segment.speaker,
        "metrics": segment.metrics,
    }


if __name__ == "__main__":
    run()
