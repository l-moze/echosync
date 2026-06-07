from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
from collections.abc import AsyncIterator, Callable, Sequence
from contextlib import suppress
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

from echosync_agent.domain import AudioFrame, SegmentStatus, TranscriptSegment, new_segment_id
from echosync_agent.interfaces import Transcriber

logger = logging.getLogger(__name__)
ConnectFactory = Callable[[str, Sequence[tuple[str, str]]], Any]


@dataclass(frozen=True, slots=True)
class QwenRealtimeAsrConfig:
    """阿里云百炼 Qwen 实时语音识别配置。"""

    api_key: str
    model: str = "qwen3-asr-flash-realtime-2026-02-10"
    base_url: str = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
    language: str = "auto"
    sample_rate: int = 16_000
    vad_enabled: bool = False
    vad_silence_duration_ms: int = 800
    vad_threshold: float = 0.2


@dataclass(slots=True)
class _FrameWindow:
    session_id: str = ""
    source_lang: str = "auto"
    start_ms: int = 0
    end_ms: int = 0
    frame_seen: bool = False


class QwenRealtimeAsrTranscriber(Transcriber):
    """Qwen-ASR-Realtime WebSocket 适配器。"""

    def __init__(
        self,
        config: QwenRealtimeAsrConfig,
        connect_factory: ConnectFactory | None = None,
    ) -> None:
        self.config = config
        self._connect_factory = connect_factory or _default_connect

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        queue: asyncio.Queue[TranscriptSegment | BaseException | object] = asyncio.Queue()
        done = object()
        window = _FrameWindow()
        started_at = time.perf_counter()

        async with self._connect_factory(self._build_url(), self._headers()) as websocket:
            sender_task = asyncio.create_task(self._send_audio(websocket, frames, window))
            receiver_task = asyncio.create_task(
                self._receive_events(websocket, queue, done, window, started_at)
            )
            try:
                while True:
                    event = await queue.get()
                    if event is done:
                        break
                    if isinstance(event, BaseException):
                        raise event
                    yield event
            finally:
                for task in (sender_task, receiver_task):
                    if not task.done():
                        task.cancel()
                await asyncio.gather(sender_task, receiver_task, return_exceptions=True)

    async def _send_audio(
        self,
        websocket: Any,
        frames: AsyncIterator[AudioFrame],
        window: _FrameWindow,
    ) -> None:
        try:
            await websocket.send(json.dumps(self._session_update()))
            async for frame in frames:
                _update_window(window, frame)
                if frame.pcm:
                    await websocket.send(
                        json.dumps(
                            {
                                "event_id": _event_id(),
                                "type": "input_audio_buffer.append",
                                "audio": base64.b64encode(frame.pcm).decode("ascii"),
                            }
                        )
                    )
                if frame.is_final and not self.config.vad_enabled:
                    await websocket.send(
                        json.dumps({"event_id": _event_id(), "type": "input_audio_buffer.commit"})
                    )
        finally:
            with suppress(Exception):
                if not self.config.vad_enabled:
                    await websocket.send(
                        json.dumps({"event_id": _event_id(), "type": "input_audio_buffer.commit"})
                    )
                await websocket.send(
                    json.dumps({"event_id": _event_id(), "type": "session.finish"})
                )

    async def _receive_events(
        self,
        websocket: Any,
        queue: asyncio.Queue[TranscriptSegment | BaseException | object],
        done: object,
        window: _FrameWindow,
        started_at: float,
    ) -> None:
        try:
            async for message in websocket:
                payload = _parse_json_message(message)
                if payload is None:
                    continue
                message_type = str(payload.get("type", ""))
                if message_type.endswith(".error") or message_type == "error":
                    raise RuntimeError(str(payload.get("error") or payload))
                if message_type == "conversation.item.input_audio_transcription.text":
                    segment = self._partial_segment(
                        payload,
                        window=window,
                        stream_elapsed_ms=int((time.perf_counter() - started_at) * 1000),
                    )
                    if segment is not None:
                        await queue.put(segment)
                    continue
                if message_type == "conversation.item.input_audio_transcription.completed":
                    segment = self._completed_segment(
                        payload,
                        window=window,
                        stream_elapsed_ms=int((time.perf_counter() - started_at) * 1000),
                    )
                    if segment is not None:
                        await queue.put(segment)
                    continue
                if message_type == "session.finished":
                    break
        except BaseException as exc:
            await queue.put(exc)
        finally:
            await queue.put(done)

    def _partial_segment(
        self,
        payload: dict[str, Any],
        *,
        window: _FrameWindow,
        stream_elapsed_ms: int,
    ) -> TranscriptSegment | None:
        text = str(payload.get("text") or payload.get("stash") or "").strip()
        if not text:
            return None
        return self._build_segment(
            text=text,
            status=SegmentStatus.PARTIAL,
            stability=0.72,
            payload=payload,
            window=window,
            stream_elapsed_ms=stream_elapsed_ms,
        )

    def _completed_segment(
        self,
        payload: dict[str, Any],
        *,
        window: _FrameWindow,
        stream_elapsed_ms: int,
    ) -> TranscriptSegment | None:
        text = str(payload.get("transcript") or payload.get("text") or "").strip()
        if not text:
            return None
        return self._build_segment(
            text=text,
            status=SegmentStatus.COMMITTED,
            stability=1.0,
            payload=payload,
            window=window,
            stream_elapsed_ms=stream_elapsed_ms,
        )

    def _build_segment(
        self,
        *,
        text: str,
        status: SegmentStatus,
        stability: float,
        payload: dict[str, Any],
        window: _FrameWindow,
        stream_elapsed_ms: int,
    ) -> TranscriptSegment:
        start_ms = window.start_ms
        end_ms = max(window.end_ms, start_ms + 1)
        audio_ms = max(end_ms - start_ms, 1)
        audio_lag_ms = max(stream_elapsed_ms - max(window.end_ms - window.start_ms, audio_ms), 0)
        usage = payload.get("usage")
        usage = usage if isinstance(usage, dict) else {}
        source_lang = window.source_lang if window.source_lang != "auto" else self.config.language
        if source_lang == "auto":
            source_lang = "zh"

        logger.info(
            "qwen_asr_result session_id=%s start_ms=%d end_ms=%d status=%s "
            "text_chars=%d emotion=%s",
            window.session_id,
            start_ms,
            end_ms,
            status,
            len(text),
            payload.get("emotion", ""),
        )
        return TranscriptSegment(
            session_id=window.session_id,
            segment_id=new_segment_id(),
            rev=1,
            start_ms=start_ms,
            end_ms=end_ms,
            source_lang=source_lang,
            text=text,
            status=status,
            stability=stability,
            metrics={
                "asr_stream_elapsed_ms": float(stream_elapsed_ms),
                "asr_audio_lag_ms": float(audio_lag_ms),
                "asr_audio_window_ms": float(audio_ms),
                "qwen_asr_final": 1.0 if status == SegmentStatus.COMMITTED else 0.0,
                "qwen_asr_usage_duration_s": _float_or_default(usage.get("duration"), 0.0),
            },
        )

    def _build_url(self) -> str:
        return f"{self.config.base_url}?{urlencode({'model': self.config.model})}"

    def _headers(self) -> list[tuple[str, str]]:
        return [
            ("Authorization", f"Bearer {self.config.api_key}"),
            ("OpenAI-Beta", "realtime=v1"),
        ]

    def _session_update(self) -> dict[str, Any]:
        session: dict[str, Any] = {
            "modalities": ["text"],
            "input_audio_format": "pcm",
            "sample_rate": self.config.sample_rate,
            "input_audio_transcription": {
                "language": None if self.config.language == "auto" else self.config.language,
            },
            "turn_detection": None,
        }
        if self.config.vad_enabled:
            session["turn_detection"] = {
                "type": "server_vad",
                "threshold": self.config.vad_threshold,
                "silence_duration_ms": self.config.vad_silence_duration_ms,
            }
        return {"event_id": _event_id(), "type": "session.update", "session": session}


def _event_id() -> str:
    return f"event_{time.time_ns()}"


def _default_connect(url: str, headers: Sequence[tuple[str, str]]) -> Any:
    try:
        import websockets
    except ImportError as exc:  # pragma: no cover - exercised by capability checks
        raise RuntimeError("缺少 websockets 依赖，请安装 pip install -e .[qwen]。") from exc
    try:
        return websockets.connect(url, additional_headers=list(headers))
    except TypeError:
        return websockets.connect(url, extra_headers=list(headers))


def _update_window(window: _FrameWindow, frame: AudioFrame) -> None:
    if not window.frame_seen:
        window.session_id = frame.session_id
        window.start_ms = frame.start_ms
        window.frame_seen = True
    window.source_lang = frame.source_lang
    window.end_ms = frame.end_ms


def _parse_json_message(message: object) -> dict[str, Any] | None:
    if isinstance(message, bytes):
        message = message.decode("utf-8", errors="replace")
    if not isinstance(message, str):
        return None
    try:
        payload = json.loads(message)
    except json.JSONDecodeError:
        logger.debug("qwen_asr_non_json_message message=%r", message[:80])
        return None
    return payload if isinstance(payload, dict) else None


def _float_or_default(value: object, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default
