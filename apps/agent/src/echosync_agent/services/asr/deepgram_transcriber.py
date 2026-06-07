from __future__ import annotations

import asyncio
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
class DeepgramStreamingConfig:
    """Deepgram Streaming Speech-to-Text 配置。"""

    api_key: str
    model: str = "nova-3"
    language: str = "en"
    endpointing_ms: int = 300
    sample_rate: int = 16_000
    encoding: str = "linear16"
    channels: int = 1
    punctuate: bool = True
    smart_format: bool = True
    interim_results: bool = True
    vad_events: bool = True
    keepalive_interval_s: float = 5.0


@dataclass(slots=True)
class _FrameWindow:
    session_id: str = ""
    source_lang: str = "auto"
    start_ms: int = 0
    end_ms: int = 0
    frame_seen: bool = False


@dataclass(slots=True)
class _UtteranceBuffer:
    """Deepgram utterance accumulator.

    Deepgram can return multiple finalized audio spans before an endpoint.
    Keep those spans together until ``speech_final`` marks the utterance boundary.
    """

    final_text: str = ""
    start_ms: int | None = None
    end_ms: int = 0

    def reset(self) -> None:
        self.final_text = ""
        self.start_ms = None
        self.end_ms = 0


class DeepgramStreamingTranscriber(Transcriber):
    """Deepgram Streaming STT 适配器。"""

    def __init__(
        self,
        config: DeepgramStreamingConfig,
        connect_factory: ConnectFactory | None = None,
    ) -> None:
        self.config = config
        self._connect_factory = connect_factory or _default_connect

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        queue: asyncio.Queue[TranscriptSegment | BaseException | object] = asyncio.Queue()
        done = object()
        window = _FrameWindow()
        started_at = time.perf_counter()

        async with self._connect_factory(
            self._build_url(),
            [("Authorization", f"Token {self.config.api_key}")],
        ) as websocket:
            send_lock = asyncio.Lock()
            sender_task = asyncio.create_task(
                self._send_audio(websocket, frames, window, send_lock)
            )
            receiver_task = asyncio.create_task(
                self._receive_results(websocket, queue, done, window, started_at)
            )
            keepalive_task = asyncio.create_task(self._keep_alive(websocket, send_lock))
            try:
                while True:
                    event = await queue.get()
                    if event is done:
                        break
                    if isinstance(event, BaseException):
                        raise event
                    yield event
            finally:
                for task in (sender_task, receiver_task, keepalive_task):
                    if not task.done():
                        task.cancel()
                await asyncio.gather(
                    sender_task,
                    receiver_task,
                    keepalive_task,
                    return_exceptions=True,
                )

    async def _send_audio(
        self,
        websocket: Any,
        frames: AsyncIterator[AudioFrame],
        window: _FrameWindow,
        send_lock: asyncio.Lock,
    ) -> None:
        try:
            async for frame in frames:
                _update_window(window, frame)
                if frame.pcm:
                    async with send_lock:
                        await websocket.send(frame.pcm)
                if frame.is_final:
                    async with send_lock:
                        await websocket.send(json.dumps({"type": "Finalize"}))
        finally:
            with suppress(Exception):
                async with send_lock:
                    await websocket.send(json.dumps({"type": "CloseStream"}))

    async def _keep_alive(self, websocket: Any, send_lock: asyncio.Lock) -> None:
        try:
            while True:
                await asyncio.sleep(self.config.keepalive_interval_s)
                async with send_lock:
                    await websocket.send(json.dumps({"type": "KeepAlive"}))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.debug("deepgram_keepalive_stopped", exc_info=True)

    async def _receive_results(
        self,
        websocket: Any,
        queue: asyncio.Queue[TranscriptSegment | BaseException | object],
        done: object,
        window: _FrameWindow,
        started_at: float,
    ) -> None:
        try:
            utterance = _UtteranceBuffer()
            async for message in websocket:
                payload = _parse_json_message(message)
                if payload is None:
                    continue
                message_type = str(payload.get("type", ""))
                if message_type == "Error":
                    raise RuntimeError(str(payload.get("description") or payload))
                if message_type != "Results":
                    continue
                segment = self._segment_from_result(
                    payload,
                    window=window,
                    utterance=utterance,
                    stream_elapsed_ms=int((time.perf_counter() - started_at) * 1000),
                )
                if segment is not None:
                    await queue.put(segment)
        except BaseException as exc:
            await queue.put(exc)
        finally:
            await queue.put(done)

    def _segment_from_result(
        self,
        payload: dict[str, Any],
        *,
        window: _FrameWindow,
        utterance: _UtteranceBuffer,
        stream_elapsed_ms: int,
    ) -> TranscriptSegment | None:
        alternative = _first_alternative(payload)
        if alternative is None:
            return None
        text = str(alternative.get("transcript", "")).strip()
        if not text:
            return None

        confidence = _float_or_default(alternative.get("confidence"), 0.72)
        speech_final = bool(payload.get("speech_final"))
        is_final = bool(payload.get("is_final"))
        status = SegmentStatus.PARTIAL
        if speech_final:
            status = SegmentStatus.COMMITTED
        elif is_final:
            status = SegmentStatus.STABLE

        payload_start_ms, payload_end_ms = _timing_ms(payload, window)
        if utterance.start_ms is None:
            utterance.start_ms = payload_start_ms

        if is_final:
            utterance.final_text = _merge_transcript_piece(utterance.final_text, text)
            utterance.end_ms = max(utterance.end_ms, payload_end_ms)
            text = utterance.final_text
        elif utterance.final_text:
            text = _merge_transcript_piece(utterance.final_text, text)

        start_ms = utterance.start_ms if utterance.start_ms is not None else payload_start_ms
        end_ms = max(payload_end_ms, utterance.end_ms, start_ms + 1)
        audio_ms = max(end_ms - start_ms, 1)
        audio_lag_ms = max(stream_elapsed_ms - max(window.end_ms - window.start_ms, audio_ms), 0)
        source_lang = window.source_lang if window.source_lang != "auto" else self.config.language

        logger.info(
            "deepgram_result session_id=%s start_ms=%d end_ms=%d status=%s "
            "is_final=%s speech_final=%s confidence=%.2f text_chars=%d",
            window.session_id,
            start_ms,
            end_ms,
            status,
            is_final,
            speech_final,
            confidence,
            len(text),
        )

        segment = TranscriptSegment(
            session_id=window.session_id,
            segment_id=new_segment_id(),
            rev=1,
            start_ms=start_ms,
            end_ms=end_ms,
            source_lang=source_lang,
            text=text,
            status=status,
            stability=1.0 if status == SegmentStatus.COMMITTED else confidence,
            metrics={
                "asr_stream_elapsed_ms": float(stream_elapsed_ms),
                "asr_audio_lag_ms": float(audio_lag_ms),
                "asr_audio_window_ms": float(audio_ms),
                "asr_endpoint_final": 1.0 if speech_final else 0.0,
                "asr_cumulative_utterance": 1.0,
                "deepgram_confidence": confidence,
                "deepgram_is_final": 1.0 if is_final else 0.0,
                "deepgram_speech_final": 1.0 if speech_final else 0.0,
            },
        )
        if speech_final:
            utterance.reset()
        return segment

    def _build_url(self) -> str:
        query: dict[str, str | int] = {
            "model": self.config.model,
            "encoding": self.config.encoding,
            "sample_rate": self.config.sample_rate,
            "channels": self.config.channels,
            "interim_results": _bool_query(self.config.interim_results),
            "endpointing": self.config.endpointing_ms,
            "punctuate": _bool_query(self.config.punctuate),
            "smart_format": _bool_query(self.config.smart_format),
            "vad_events": _bool_query(self.config.vad_events),
        }
        if self.config.language and self.config.language != "auto":
            query["language"] = self.config.language
        return f"wss://api.deepgram.com/v1/listen?{urlencode(query)}"


def _default_connect(url: str, headers: Sequence[tuple[str, str]]) -> Any:
    try:
        import websockets
    except ImportError as exc:
        raise RuntimeError(
            "未安装 Deepgram WebSocket 运行依赖。请先安装 websockets，"
            "例如 pip install -e .[deepgram]。"
        ) from exc

    try:
        return websockets.connect(url, additional_headers=headers, ping_interval=None)
    except TypeError:
        return websockets.connect(url, extra_headers=headers, ping_interval=None)


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
        return None
    return payload if isinstance(payload, dict) else None


def _first_alternative(payload: dict[str, Any]) -> dict[str, Any] | None:
    channel = payload.get("channel")
    if not isinstance(channel, dict):
        return None
    alternatives = channel.get("alternatives")
    if not isinstance(alternatives, list) or not alternatives:
        return None
    first = alternatives[0]
    return first if isinstance(first, dict) else None


def _timing_ms(payload: dict[str, Any], window: _FrameWindow) -> tuple[int, int]:
    payload_start_ms = int(round(_float_or_default(payload.get("start"), 0.0) * 1000))
    payload_duration_ms = int(round(_float_or_default(payload.get("duration"), 0.0) * 1000))
    start_ms = window.start_ms + payload_start_ms
    if payload_duration_ms > 0:
        return start_ms, start_ms + payload_duration_ms
    return start_ms, max(window.end_ms, start_ms + 1)


def _float_or_default(value: object, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _bool_query(value: bool) -> str:
    return "true" if value else "false"


def _merge_transcript_piece(base: str, piece: str) -> str:
    base = base.strip()
    piece = piece.strip()
    if not base:
        return piece
    if not piece:
        return base
    if piece.startswith(base):
        return piece
    if base.endswith(piece):
        return base

    base_words = base.split()
    piece_words = piece.split()
    max_overlap = min(len(base_words), len(piece_words))
    for overlap in range(max_overlap, 0, -1):
        if _casefold_words(base_words[-overlap:]) == _casefold_words(piece_words[:overlap]):
            rest = " ".join(piece_words[overlap:])
            return base if not rest else f"{base} {rest}"

    if piece[0] in ",.!?;:，。！？；：":
        return f"{base}{piece}"
    if _is_cjk(base[-1]) and _is_cjk(piece[0]):
        return f"{base}{piece}"
    return f"{base} {piece}"


def _casefold_words(words: list[str]) -> list[str]:
    return [word.casefold() for word in words]


def _is_cjk(char: str) -> bool:
    return "\u4e00" <= char <= "\u9fff"
