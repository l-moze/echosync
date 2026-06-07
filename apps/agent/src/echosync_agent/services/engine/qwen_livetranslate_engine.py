from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
from collections.abc import AsyncIterator, Callable, Sequence
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode

from echosync_agent.domain import (
    AudioFrame,
    InterpretationEvent,
    ModelCapability,
    ModelMode,
    ModelProfile,
    SegmentCommit,
    SegmentStatus,
    TranslatedAudioChunk,
    TranslationSegment,
    new_segment_id,
)
from echosync_agent.interfaces import InterpretationEngine

logger = logging.getLogger(__name__)
ConnectFactory = Callable[[str, Sequence[tuple[str, str]]], Any]


@dataclass(frozen=True, slots=True)
class QwenLiveTranslateConfig:
    """阿里云百炼 Qwen LiveTranslate Realtime 配置。"""

    api_key: str
    model: str = "qwen3.5-livetranslate-flash-realtime"
    base_url: str = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
    source_lang: str = "auto"
    target_lang: str = "zh-CN"
    sample_rate: int = 16_000
    output_audio: bool = False
    output_audio_sample_rate: int = 24_000
    vad_silence_duration_ms: int = 800
    vad_threshold: float = 0.2
    hotwords: tuple[str, ...] = ()


@dataclass(slots=True)
class _FrameWindow:
    session_id: str = ""
    source_lang: str = "auto"
    start_ms: int = 0
    end_ms: int = 0
    frame_seen: bool = False


@dataclass(slots=True)
class _LiveSegmentState:
    segment_id: str = field(default_factory=new_segment_id)
    rev: int = 0
    source_text: str = ""
    target_text: str = ""
    source_done: bool = False
    target_done: bool = False

    def bump_rev(self) -> int:
        self.rev += 1
        return self.rev

    def reset(self) -> None:
        self.segment_id = new_segment_id()
        self.rev = 0
        self.source_text = ""
        self.target_text = ""
        self.source_done = False
        self.target_done = False


class QwenLiveTranslateEngine(InterpretationEngine):
    """Qwen LiveTranslate 端到端语音翻译引擎。"""

    def __init__(
        self,
        config: QwenLiveTranslateConfig,
        connect_factory: ConnectFactory | None = None,
    ) -> None:
        self.config = config
        self._connect_factory = connect_factory or _default_connect

    @property
    def profile(self) -> ModelProfile:
        return ModelProfile(
            provider="qwen-livetranslate",
            model=self.config.model,
            mode=ModelMode.END_TO_END,
            capabilities=(
                ModelCapability.ASR,
                ModelCapability.TRANSLATION,
                ModelCapability.SPEECH_TRANSLATION,
                *(() if not self.config.output_audio else (ModelCapability.TTS,)),
            ),
            source_lang=self.config.source_lang,
            target_lang=self.config.target_lang,
        )

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[InterpretationEvent]:
        queue: asyncio.Queue[InterpretationEvent | BaseException | object] = asyncio.Queue()
        done = object()
        window = _FrameWindow(source_lang=self.config.source_lang)
        state = _LiveSegmentState()
        started_at = time.perf_counter()

        async with self._connect_factory(self._build_url(), self._headers()) as websocket:
            sender_task = asyncio.create_task(self._send_audio(websocket, frames, window))
            receiver_task = asyncio.create_task(
                self._receive_events(websocket, queue, done, window, state, started_at)
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
        finally:
            with suppress(Exception):
                await websocket.send(
                    json.dumps({"event_id": _event_id(), "type": "session.finish"})
                )

    async def _receive_events(
        self,
        websocket: Any,
        queue: asyncio.Queue[InterpretationEvent | BaseException | object],
        done: object,
        window: _FrameWindow,
        state: _LiveSegmentState,
        started_at: float,
    ) -> None:
        try:
            async for message in websocket:
                payload = _parse_json_message(message)
                if payload is None:
                    continue
                message_type = str(payload.get("type", ""))
                logger.debug(
                    "qwen_livetranslate_raw_event type=%s payload=%s",
                    message_type,
                    payload,
                )
                if message_type.endswith(".error") or message_type == "error":
                    raise RuntimeError(str(payload.get("error") or payload))
                stream_elapsed_ms = int((time.perf_counter() - started_at) * 1000)

                source_text = _source_text_from_payload(payload)
                if source_text:
                    state.source_text = source_text
                    source_done_event = (
                        message_type == "conversation.item.input_audio_transcription.completed"
                    )
                    if source_done_event:
                        state.source_done = True
                    await queue.put(
                        self._translation_event(
                            state=state,
                            window=window,
                            target_text="",
                            status=(
                                SegmentStatus.COMMITTED
                                if source_done_event
                                else SegmentStatus.PARTIAL
                            ),
                            stability=1.0 if source_done_event else 0.72,
                            stream_elapsed_ms=stream_elapsed_ms,
                            metrics={"qwen_livetranslate_source_update": 1.0},
                        )
                    )
                    if state.source_done and state.target_done and state.target_text:
                        await queue.put(self._commit_event(state=state, window=window))
                        state.reset()
                        continue

                target_text = _target_text_from_payload(payload, current=state.target_text)
                if target_text:
                    state.target_text = target_text
                    done_event = message_type in {
                        "response.audio_transcript.done",
                        "response.text.done",
                    }
                    if done_event:
                        state.target_done = True
                    await queue.put(
                        self._translation_event(
                            state=state,
                            window=window,
                            target_text=target_text,
                            status=SegmentStatus.COMMITTED if done_event else SegmentStatus.PARTIAL,
                            stability=1.0 if done_event else 0.78,
                            stream_elapsed_ms=stream_elapsed_ms,
                            metrics={"qwen_livetranslate_done": 1.0 if done_event else 0.0},
                        )
                    )
                    if state.source_done and state.target_done:
                        await queue.put(self._commit_event(state=state, window=window))
                        state.reset()
                        continue

                audio_chunk = _audio_from_payload(payload)
                if audio_chunk is not None:
                    await queue.put(
                        self._audio_chunk(
                            state=state,
                            window=window,
                            audio=audio_chunk,
                            final=message_type == "response.audio.done",
                        )
                    )

                if message_type == "session.finished":
                    if state.source_text or state.target_text:
                        await queue.put(self._commit_event(state=state, window=window))
                    break
        except BaseException as exc:
            await queue.put(exc)
        finally:
            await queue.put(done)

    def _translation_event(
        self,
        *,
        state: _LiveSegmentState,
        window: _FrameWindow,
        target_text: str,
        status: SegmentStatus,
        stability: float,
        stream_elapsed_ms: int,
        metrics: dict[str, float],
    ) -> TranslationSegment:
        rev = state.bump_rev()
        start_ms, end_ms = _timing(window)
        audio_ms = max(end_ms - start_ms, 1)
        audio_lag_ms = max(stream_elapsed_ms - max(window.end_ms - window.start_ms, audio_ms), 0)
        merged_metrics = {
            "asr_stream_elapsed_ms": float(stream_elapsed_ms),
            "asr_audio_lag_ms": float(audio_lag_ms),
            "asr_audio_window_ms": float(audio_ms),
            **metrics,
        }
        return TranslationSegment(
            session_id=window.session_id,
            segment_id=state.segment_id,
            rev=rev,
            source_rev=rev,
            start_ms=start_ms,
            end_ms=end_ms,
            source_lang=_source_lang(window, self.config.source_lang),
            target_lang=self.config.target_lang,
            source_text=state.source_text,
            target_text=target_text,
            status=status,
            stability=stability,
            metrics=merged_metrics,
        )

    def _commit_event(self, *, state: _LiveSegmentState, window: _FrameWindow) -> SegmentCommit:
        start_ms, end_ms = _timing(window)
        return SegmentCommit(
            session_id=window.session_id,
            segment_id=state.segment_id,
            rev=max(state.rev, 1),
            start_ms=start_ms,
            end_ms=end_ms,
            source_lang=_source_lang(window, self.config.source_lang),
            target_lang=self.config.target_lang,
            source_text=state.source_text,
            target_text=state.target_text,
            metrics={"qwen_livetranslate_commit": 1.0},
        )

    def _audio_chunk(
        self,
        *,
        state: _LiveSegmentState,
        window: _FrameWindow,
        audio: bytes,
        final: bool,
    ) -> TranslatedAudioChunk:
        start_ms, end_ms = _timing(window)
        return TranslatedAudioChunk(
            session_id=window.session_id,
            segment_id=state.segment_id,
            rev=max(state.rev, 1),
            start_ms=start_ms,
            end_ms=end_ms,
            target_lang=self.config.target_lang,
            audio=audio,
            mime_type="audio/pcm",
            sample_rate=self.config.output_audio_sample_rate,
            final=final,
            metrics={"qwen_livetranslate_audio": 1.0},
        )

    def _build_url(self) -> str:
        return f"{self.config.base_url}?{urlencode({'model': self.config.model})}"

    def _headers(self) -> list[tuple[str, str]]:
        return [
            ("Authorization", f"Bearer {self.config.api_key}"),
            ("OpenAI-Beta", "realtime=v1"),
        ]

    def _session_update(self) -> dict[str, Any]:
        modalities = ["text", "audio"] if self.config.output_audio else ["text"]
        session: dict[str, Any] = {
            "modalities": modalities,
            "input_audio_format": "pcm",
            "output_audio_format": "pcm",
            "turn_detection": {
                "type": "server_vad",
                "threshold": self.config.vad_threshold,
                "silence_duration_ms": self.config.vad_silence_duration_ms,
            },
            "translation": {
                "language": _qwen_language_code(self.config.target_lang),
            },
        }
        if self.config.hotwords:
            session["translation"]["corpus"] = {
                "phrases": {phrase: phrase for phrase in self.config.hotwords}
            }
        session["input_audio_transcription"] = {
            "model": "qwen3-asr-flash-realtime",
            "language": None if self.config.source_lang == "auto" else self.config.source_lang,
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


def _timing(window: _FrameWindow) -> tuple[int, int]:
    start_ms = window.start_ms
    return start_ms, max(window.end_ms, start_ms + 1)


def _source_lang(window: _FrameWindow, fallback: str) -> str:
    if window.source_lang != "auto":
        return window.source_lang
    if fallback != "auto":
        return fallback
    return "auto"


def _parse_json_message(message: object) -> dict[str, Any] | None:
    if isinstance(message, bytes):
        message = message.decode("utf-8", errors="replace")
    if not isinstance(message, str):
        return None
    try:
        payload = json.loads(message)
    except json.JSONDecodeError:
        logger.debug("qwen_livetranslate_non_json_message message=%r", message[:80])
        return None
    return payload if isinstance(payload, dict) else None


def _source_text_from_payload(payload: dict[str, Any]) -> str:
    message_type = str(payload.get("type", ""))
    if "input_audio_transcription" in message_type:
        stash = payload.get("stash")
        if isinstance(stash, str) and stash.strip():
            return stash.strip()
    for key in ("source_text", "source_transcript", "transcript"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    delta = payload.get("delta")
    if isinstance(delta, dict):
        for key in ("source_text", "source_transcript", "transcript"):
            value = delta.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def _target_text_from_payload(payload: dict[str, Any], *, current: str) -> str:
    message_type = str(payload.get("type", ""))
    if "input_audio_transcription" in message_type:
        return ""
    if message_type == "response.audio_transcript.text" or message_type == "response.text.text":
        text = payload.get("text")
        stash = payload.get("stash")
        if isinstance(text, str) or isinstance(stash, str):
            stable = text if isinstance(text, str) else ""
            unstable = stash if isinstance(stash, str) else ""
            return f"{stable}{unstable}".strip()
    keys = ("target_text", "translation", "text", "transcript")
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            if key in {"text", "transcript"} and "input_audio_transcription" in message_type:
                continue
            return value.strip()
    delta = payload.get("delta")
    if isinstance(delta, str) and delta.strip():
        return f"{current}{delta}"
    if isinstance(delta, dict):
        for key in keys:
            value = delta.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def _audio_from_payload(payload: dict[str, Any]) -> bytes | None:
    audio = payload.get("audio")
    if not isinstance(audio, str) or not audio:
        delta = payload.get("delta")
        audio = delta if isinstance(delta, str) else ""
    if not audio:
        return None
    try:
        return base64.b64decode(audio, validate=True)
    except ValueError:
        return None


def _qwen_language_code(value: str) -> str:
    lowered = value.strip().lower().replace("_", "-")
    return {
        "zh": "zh",
        "zh-cn": "zh",
        "zh-hans": "zh",
        "en-us": "en",
        "en-gb": "en",
        "ja-jp": "ja",
        "ko-kr": "ko",
    }.get(lowered, lowered.split("-", maxsplit=1)[0] or "cn")
