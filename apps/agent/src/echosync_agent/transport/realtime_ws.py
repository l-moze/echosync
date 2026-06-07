from __future__ import annotations

import asyncio
import base64
import json
import logging
import struct
import time
from collections.abc import AsyncIterator, Callable
from contextlib import suppress
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from echosync_agent.domain import AudioFrame, AudioSourceKind
from echosync_agent.runtime import build_demo_pipeline
from echosync_agent.runtime.settings import (
    Settings,
    with_session_asr_overrides,
    with_session_translation_overrides,
    with_session_tts_overrides,
)

logger = logging.getLogger(__name__)

SettingsFactory = Callable[[], Settings]
AUDIO_FRAME_MAGIC = 0x46415345
AUDIO_FRAME_VERSION = 1
AUDIO_FRAME_FLAG_FINAL = 1 << 0
AUDIO_FRAME_HEADER = struct.Struct("<IHHIIII")
LOOPBACK_TTS_GUARD_ERROR_CODE = "preflight.loopback_tts_guard"
LOOPBACK_TTS_GUARD_MESSAGE = (
    "安全限制：Windows 系统声音采集会包含扬声器输出，不能同时启用语音播报（TTS）。"
    "请将语音播报设为 disabled，或改用麦克风输入。"
)


def create_realtime_router(
    *,
    caption_event_bus: object,
    settings_factory: SettingsFactory | None = None,
) -> APIRouter:
    """创建完整实时链路的输入 WebSocket 路由。

    Desktop 只负责把系统音频转成 PCM16 chunk；这里把 chunk 还原成 AudioFrame，
    然后交给现有 ASR -> 翻译 -> 字幕管道。
    """

    router = APIRouter()
    resolved_settings_factory = settings_factory or Settings.from_env

    @router.websocket("/v1/realtime/sessions/{session_id}")
    async def realtime_session(websocket: WebSocket, session_id: str) -> None:
        await websocket.accept()
        session = _RealtimeWebSocketSession(
            websocket=websocket,
            session_id=session_id,
            settings=resolved_settings_factory(),
            caption_event_bus=caption_event_bus,
        )
        await session.run()

    return router


class _RealtimeWebSocketSession:
    def __init__(
        self,
        *,
        websocket: WebSocket,
        session_id: str,
        settings: Settings,
        caption_event_bus: object,
    ) -> None:
        self.websocket = websocket
        self.session_id = session_id
        self.trace_id = session_id
        self.settings = settings
        self.caption_event_bus = caption_event_bus
        self.queue: asyncio.Queue[AudioFrame | None] = asyncio.Queue()
        self._frame_queued_at_by_id: dict[int, float] = {}
        self.source_lang = "auto"
        self.sample_rate = 16_000
        self.channels = 1
        self.source_kind = AudioSourceKind.WINDOWS_SYSTEM
        self.device_id: str | None = None
        self._chunk_count = 0
        self._queued_audio_ms = 0
        self._stop_reason: str | None = None
        self._metrics = _RealtimeTransportMetrics()
        self._pipeline_task: asyncio.Task[None] | None = None

    async def run(self) -> None:
        logger.info(
            "realtime_session_started session_id=%s asr=%s translator=%s",
            self.session_id,
            self.settings.asr_provider,
            self.settings.translator_provider,
        )
        receive_task: asyncio.Task[dict[str, Any]] | None = None

        try:
            while True:
                if self._pipeline_task is None:
                    try:
                        message = await self.websocket.receive()
                    except WebSocketDisconnect:
                        logger.info("realtime_client_disconnected session_id=%s", self.session_id)
                        self._stop_reason = "client_disconnect"
                        break

                    should_stop = await self._handle_message(message)
                    if should_stop:
                        break
                    continue

                receive_task = asyncio.create_task(self.websocket.receive())
                done, _pending = await asyncio.wait(
                    {receive_task, self._pipeline_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if self._pipeline_task in done:
                    if receive_task in done:
                        try:
                            message = receive_task.result()
                        except WebSocketDisconnect:
                            logger.info(
                                "realtime_client_disconnected session_id=%s",
                                self.session_id,
                            )
                            self._stop_reason = "client_disconnect"
                        else:
                            await self._handle_message(message)
                        finally:
                            receive_task = None
                    else:
                        receive_task.cancel()
                        with suppress(asyncio.CancelledError):
                            await receive_task
                    break

                try:
                    message = receive_task.result()
                except WebSocketDisconnect:
                    logger.info("realtime_client_disconnected session_id=%s", self.session_id)
                    self._stop_reason = "client_disconnect"
                    break
                finally:
                    receive_task = None

                should_stop = await self._handle_message(message)
                if should_stop:
                    break
        finally:
            if receive_task is not None and not receive_task.done():
                receive_task.cancel()
                with suppress(asyncio.CancelledError):
                    await receive_task
            await self._finish_stream()
            pipeline_task = self._pipeline_task
            if pipeline_task is None:
                if self._stop_reason is None:
                    await self._send_done()
            elif self._should_cancel_pipeline():
                await self._cancel_or_report_pipeline(pipeline_task)
            else:
                try:
                    await pipeline_task
                except Exception as exc:
                    logger.exception("realtime_pipeline_failed session_id=%s", self.session_id)
                    await self._send_error(str(exc))
                else:
                    await self._send_done()
            logger.info(
                "realtime_session_finished session_id=%s chunks=%d audio_ms=%d",
                self.session_id,
                self._chunk_count,
                self._queued_audio_ms,
            )

    async def _frames(self) -> AsyncIterator[AudioFrame]:
        while True:
            frame = await self.queue.get()
            if frame is None:
                return
            queued_at = self._frame_queued_at_by_id.pop(id(frame), None)
            if queued_at is not None:
                self._metrics.record_asr_queue_wait((time.perf_counter() - queued_at) * 1000)
            yield frame

    async def _handle_message(self, message: dict[str, Any]) -> bool:
        if message.get("type") == "websocket.disconnect":
            logger.info("realtime_client_disconnected session_id=%s", self.session_id)
            self._stop_reason = "client_disconnect"
            return True

        if "bytes" in message and message["bytes"] is not None:
            return await self._handle_binary_frame(bytes(message["bytes"]))

        if "text" in message and message["text"] is not None:
            try:
                message = json.loads(str(message["text"]))
            except json.JSONDecodeError as exc:
                await self._send_error(f"realtime JSON 消息无效：{exc}")
                return False

        message_type = message.get("type")
        if message_type in {"audio.start", "asr.start"}:
            try:
                self._apply_start_message(message)
            except Exception as exc:
                logger.exception(
                    "realtime_session_start_failed session_id=%s asr=%s translator=%s",
                    self.session_id,
                    self.settings.asr_provider,
                    self.settings.translator_provider,
                )
                self._stop_reason = "start_error"
                await self._send_error(str(exc))
                return True
            if self._is_system_loopback_with_tts_feedback():
                await self._send_error(
                    LOOPBACK_TTS_GUARD_MESSAGE,
                    code=LOOPBACK_TTS_GUARD_ERROR_CODE,
                )
                self._stop_reason = "start_error"
                return True
            if self._is_mock_asr_receiving_real_audio():
                await self._send_error(
                    "当前是 mock ASR，不能处理 Windows/麦克风/文件这类真实音频 PCM。"
                    "请设置 ECHOSYNC_ASR_PROVIDER=voxtral、funasr、deepgram、qwen-asr "
                    "或 qwen-livetranslate 后重启 Agent。"
                )
                self._stop_reason = "start_error"
                return True
            self._start_pipeline()
            logger.info(
                "audio_stream_started session_id=%s trace_id=%s source_kind=%s device_id=%s "
                "sample_rate=%d channels=%d source_lang=%s asr=%s mode=%s translator=%s tts=%s",
                self.session_id,
                self.trace_id,
                self.source_kind,
                self.device_id,
                self.sample_rate,
                self.channels,
                self.source_lang,
                self.settings.asr_provider,
                self.settings.asr_latency_mode,
                self.settings.translator_provider,
                self.settings.tts_provider,
            )
            return False
        if message_type == "audio.chunk":
            frame = await self._build_audio_frame(message)
            if frame is not None:
                await self._queue_audio_frame(frame)
                self._record_audio_frame(frame)
            return False
        if message_type == "audio.final":
            frame = self._build_audio_final_frame(message)
            await self._queue_audio_frame(frame)
            logger.info(
                "audio_stream_final_marker session_id=%s seq=%d end_ms=%d",
                self.session_id,
                frame.seq,
                frame.end_ms,
            )
            return False
        if message_type in {"audio.end", "asr.end"}:
            self._stop_reason = None if message.get("reason") is None else str(message["reason"])
            logger.info(
                "audio_stream_ended session_id=%s reason=%s",
                self.session_id,
                self._stop_reason or "normal",
            )
            return True

        await self._send_error(f"不支持的 realtime WebSocket 消息类型：{message_type}")
        return False

    async def _handle_binary_frame(self, packet: bytes) -> bool:
        frame = await self._build_binary_audio_frame(packet)
        if frame is not None:
            await self._queue_audio_frame(frame)
            self._record_audio_frame(frame)
        return False

    def _is_mock_asr_receiving_real_audio(self) -> bool:
        if self.settings.asr_provider != "mock":
            return False
        return self.source_kind != AudioSourceKind.NETWORK_STREAM

    def _is_system_loopback_with_tts_feedback(self) -> bool:
        if self.source_kind != AudioSourceKind.WINDOWS_SYSTEM:
            return False
        if self._capture_excludes_echosync_audio():
            return False
        return self.settings.tts_provider != "disabled"

    def _capture_excludes_echosync_audio(self) -> bool:
        if self.device_id is None:
            return False
        return self.device_id.startswith("wasapi:exclude-process-tree:") or self.device_id.startswith(
            "wasapi:include-process-tree:"
        )

    def _apply_start_message(self, message: dict[str, Any]) -> None:
        self.settings = with_session_asr_overrides(
            self.settings,
            asr_latency_mode=message.get("asr_latency_mode"),
            asr_provider=message.get("asr_provider"),
        )
        self.settings = with_session_translation_overrides(
            self.settings,
            translation_provider=message.get("translation_provider"),
        )
        self.settings = with_session_tts_overrides(
            self.settings,
            tts_provider=message.get("tts_provider"),
        )
        trace_id = message.get("trace_id", self.trace_id)
        self.trace_id = self.session_id if trace_id is None else str(trace_id)
        self.source_lang = str(message.get("source_lang", self.source_lang))
        self.sample_rate = int(message.get("sample_rate", self.sample_rate))
        self.channels = int(message.get("channels", self.channels))
        self.source_kind = AudioSourceKind(str(message.get("source_kind", self.source_kind)))
        device_id = message.get("device_id", self.device_id)
        self.device_id = None if device_id is None else str(device_id)

    def _start_pipeline(self) -> None:
        if self._pipeline_task is not None:
            return
        pipeline, _event_bus = build_demo_pipeline(
            settings=self.settings,
            caption_event_bus=self.caption_event_bus,
        )
        self._pipeline_task = asyncio.create_task(pipeline.run(self._frames()))

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
            device_id=(
                self.device_id
                if message.get("device_id") is None
                else str(message["device_id"])
            ),
            is_final=bool(message.get("is_final", False)),
        )

    def _build_audio_final_frame(self, message: dict[str, Any]) -> AudioFrame:
        end_ms = int(message.get("end_ms", message.get("start_ms", self._queued_audio_ms)))
        start_ms = int(message.get("start_ms", end_ms))
        return AudioFrame(
            session_id=self.session_id,
            seq=int(message.get("seq", self._chunk_count)),
            pcm=b"",
            sample_rate=int(message.get("sample_rate", self.sample_rate)),
            channels=int(message.get("channels", self.channels)),
            start_ms=start_ms,
            end_ms=end_ms,
            source_lang=str(message.get("source_lang", self.source_lang)),
            source_kind=AudioSourceKind(str(message.get("source_kind", self.source_kind))),
            device_id=(
                self.device_id
                if message.get("device_id") is None
                else str(message["device_id"])
            ),
            is_final=True,
        )

    async def _build_binary_audio_frame(self, packet: bytes) -> AudioFrame | None:
        if len(packet) < AUDIO_FRAME_HEADER.size:
            await self._send_error("binary audio frame 太短。")
            return None

        magic, version, flags, seq, start_ms, end_ms, sent_at_ms = AUDIO_FRAME_HEADER.unpack_from(
            packet
        )
        if magic != AUDIO_FRAME_MAGIC:
            await self._send_error("binary audio frame magic 无效。")
            return None
        if version != AUDIO_FRAME_VERSION:
            await self._send_error(f"不支持的 binary audio frame version：{version}")
            return None

        pcm = packet[AUDIO_FRAME_HEADER.size :]
        if not pcm:
            await self._send_error("binary audio frame PCM 为空。")
            return None

        self._metrics.record_transport_latency(sent_at_ms)
        return AudioFrame(
            session_id=self.session_id,
            seq=seq,
            pcm=pcm,
            sample_rate=self.sample_rate,
            channels=self.channels,
            start_ms=start_ms,
            end_ms=end_ms,
            source_lang=self.source_lang,
            source_kind=self.source_kind,
            device_id=self.device_id,
            is_final=bool(flags & AUDIO_FRAME_FLAG_FINAL),
        )

    async def _queue_audio_frame(self, frame: AudioFrame) -> None:
        self._frame_queued_at_by_id[id(frame)] = time.perf_counter()
        await self.queue.put(frame)

    def _record_audio_frame(self, frame: AudioFrame) -> None:
        self._chunk_count += 1
        self._queued_audio_ms += max(frame.end_ms - frame.start_ms, 0)
        self._metrics.record_audio_frame(frame, queue_depth=self.queue.qsize())
        if not self._metrics.should_log():
            return

        snapshot = self._metrics.snapshot_and_reset(
            queue_depth=self.queue.qsize(),
            session_id=self.session_id,
            trace_id=self.trace_id,
        )
        logger.info(
            "audio_stream_metrics session_id=%s trace_id=%s frames=%d audio_ms=%d bytes=%d "
            "avg_transport_ms=%.1f p95_transport_ms=%.1f "
            "avg_asr_queue_wait_ms=%.1f p95_asr_queue_wait_ms=%.1f "
            "max_queue_depth=%d queue_depth=%d",
            snapshot.session_id,
            snapshot.trace_id,
            snapshot.frames,
            snapshot.audio_ms,
            snapshot.bytes_received,
            snapshot.avg_transport_latency_ms,
            snapshot.p95_transport_latency_ms,
            snapshot.avg_asr_queue_wait_ms,
            snapshot.p95_asr_queue_wait_ms,
            snapshot.max_queue_depth,
            snapshot.queue_depth,
        )

    async def _send_error(self, message: str, *, code: str | None = None) -> None:
        payload = {
            "type": "realtime.error",
            "session_id": self.session_id,
            "trace_id": self.trace_id,
            "message": message,
        }
        if code is not None:
            payload["code"] = code
        try:
            await self.websocket.send_json(payload)
        except Exception:
            logger.debug("realtime_error_not_sent session_id=%s", self.session_id)
        await self._publish_caption_event("realtime.error", payload)

    async def _send_done(self) -> None:
        payload = {
            "type": "realtime.done",
            "session_id": self.session_id,
            "trace_id": self.trace_id,
        }
        try:
            await self.websocket.send_json(payload)
        except Exception:
            logger.debug("realtime_done_not_sent session_id=%s", self.session_id)
        await self._publish_caption_event("realtime.done", payload)

    async def _finish_stream(self) -> None:
        await self.queue.put(None)

    def _should_cancel_pipeline(self) -> bool:
        return self._stop_reason in {"user_stop", "client_disconnect"}

    async def _cancel_or_report_pipeline(self, pipeline_task: asyncio.Task[None]) -> None:
        await asyncio.sleep(0)
        if self._stop_reason == "client_disconnect" and pipeline_task.done():
            try:
                await pipeline_task
            except Exception as exc:
                logger.exception("realtime_pipeline_failed session_id=%s", self.session_id)
                await self._send_error(str(exc))
            return

        if self._stop_reason == "user_stop" and pipeline_task.done():
            try:
                await pipeline_task
            except Exception as exc:
                logger.info(
                    "realtime_pipeline_exception_suppressed_after_user_stop session_id=%s error=%s",
                    self.session_id,
                    exc,
                )
            return

        pipeline_task.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await pipeline_task

    async def _publish_caption_event(self, event_type: str, payload: dict[str, Any]) -> None:
        publish = getattr(self.caption_event_bus, "publish", None)
        if publish is None:
            return
        try:
            await publish(event_type, payload)
        except Exception:
            logger.debug(
                "realtime_control_event_not_published session_id=%s type=%s",
                self.session_id,
                event_type,
            )


@dataclass(frozen=True, slots=True)
class _RealtimeTransportMetricsSnapshot:
    session_id: str
    trace_id: str
    frames: int
    audio_ms: int
    bytes_received: int
    avg_transport_latency_ms: float
    p95_transport_latency_ms: float
    avg_asr_queue_wait_ms: float
    p95_asr_queue_wait_ms: float
    max_queue_depth: int
    queue_depth: int


class _RealtimeTransportMetrics:
    def __init__(self, *, log_interval_sec: float = 1.0) -> None:
        self.log_interval_sec = log_interval_sec
        self.last_log_at = time.perf_counter()
        self.frames = 0
        self.audio_ms = 0
        self.bytes_received = 0
        self.max_queue_depth = 0
        self.transport_latencies_ms: list[float] = []
        self.asr_queue_waits_ms: list[float] = []

    def record_audio_frame(self, frame: AudioFrame, *, queue_depth: int = 0) -> None:
        self.frames += 1
        self.audio_ms += max(frame.end_ms - frame.start_ms, 0)
        self.bytes_received += len(frame.pcm)
        self.max_queue_depth = max(self.max_queue_depth, queue_depth)

    def record_asr_queue_wait(self, wait_ms: float) -> None:
        self.asr_queue_waits_ms.append(max(wait_ms, 0.0))

    def record_transport_latency(self, sent_at_ms: int) -> None:
        if sent_at_ms <= 0:
            return
        now_ms = int(time.time() * 1000)
        self.transport_latencies_ms.append(_transport_latency_ms_from_low32(sent_at_ms, now_ms))

    def should_log(self) -> bool:
        return time.perf_counter() - self.last_log_at >= self.log_interval_sec

    def snapshot_and_reset(
        self,
        *,
        queue_depth: int,
        session_id: str,
        trace_id: str | None = None,
    ) -> _RealtimeTransportMetricsSnapshot:
        snapshot = _RealtimeTransportMetricsSnapshot(
            session_id=session_id,
            trace_id=trace_id or session_id,
            frames=self.frames,
            audio_ms=self.audio_ms,
            bytes_received=self.bytes_received,
            avg_transport_latency_ms=_avg(self.transport_latencies_ms),
            p95_transport_latency_ms=_p95(self.transport_latencies_ms),
            avg_asr_queue_wait_ms=_avg(self.asr_queue_waits_ms),
            p95_asr_queue_wait_ms=_p95(self.asr_queue_waits_ms),
            max_queue_depth=max(self.max_queue_depth, queue_depth),
            queue_depth=queue_depth,
        )
        self.last_log_at = time.perf_counter()
        self.frames = 0
        self.audio_ms = 0
        self.bytes_received = 0
        self.max_queue_depth = 0
        self.transport_latencies_ms = []
        self.asr_queue_waits_ms = []
        return snapshot


def _avg(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def _p95(values: list[float]) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    index = min(len(sorted_values) - 1, int(round((len(sorted_values) - 1) * 0.95)))
    return sorted_values[index]


def _transport_latency_ms_from_low32(sent_at_ms_low: int, now_ms: int) -> float:
    now_low = now_ms & 0xFFFFFFFF
    return float((now_low - sent_at_ms_low) & 0xFFFFFFFF)
