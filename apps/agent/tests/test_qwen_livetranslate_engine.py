from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from echosync_agent.domain import AudioFrame, SegmentCommit, SegmentStatus, TranslationSegment
from echosync_agent.services.engine.qwen_livetranslate_engine import (
    QwenLiveTranslateConfig,
    QwenLiveTranslateEngine,
)


def test_qwen_livetranslate_engine_emits_source_translation_and_commit() -> None:
    async def scenario() -> tuple[list[object], list[object]]:
        socket = FakeQwenSocket(
            [
                {
                    "type": "response.audio_transcript.text",
                    "source_text": "hello",
                },
                {
                    "type": "response.audio_transcript.text",
                    "target_text": "你好",
                },
                {
                    "type": "response.text.done",
                    "target_text": "你好。",
                },
                {
                    "type": "conversation.item.input_audio_transcription.completed",
                    "transcript": "hello.",
                },
                {"type": "session.finished"},
            ]
        )
        engine = QwenLiveTranslateEngine(
            QwenLiveTranslateConfig(api_key="test-key", target_lang="zh-CN"),
            connect_factory=lambda _url, _headers: socket,
        )

        events = [event async for event in engine.stream(_frames())]
        return events, socket.sent

    events, sent = asyncio.run(scenario())

    translations = [event for event in events if isinstance(event, TranslationSegment)]
    commits = [event for event in events if isinstance(event, SegmentCommit)]
    assert [event.target_text for event in translations] == ["", "你好", "你好。", ""]
    assert translations[0].source_text == "hello"
    assert translations[1].status == SegmentStatus.PARTIAL
    assert translations[2].status == SegmentStatus.COMMITTED
    assert translations[3].source_text == "hello."
    assert len(commits) == 1
    assert commits[0].source_text == "hello."
    assert commits[0].target_text == "你好。"
    session_update = _control_payload(sent, "session.update")
    assert session_update is not None
    assert session_update["session"]["input_audio_transcription"] == {
        "model": "qwen3-asr-flash-realtime",
        "language": None,
    }
    assert any(_is_control_payload(payload, "input_audio_buffer.append") for payload in sent)
    assert any(_is_control_payload(payload, "session.finish") for payload in sent)


async def _frames() -> AsyncIterator[AudioFrame]:
    yield AudioFrame(
        session_id="sess_qwen_live",
        seq=1,
        pcm=b"\x01\x02",
        sample_rate=16_000,
        channels=1,
        start_ms=0,
        end_ms=80,
        source_lang="en",
    )
    yield AudioFrame(
        session_id="sess_qwen_live",
        seq=2,
        pcm=b"",
        sample_rate=16_000,
        channels=1,
        start_ms=80,
        end_ms=80,
        source_lang="en",
        is_final=True,
    )


class FakeQwenSocket:
    def __init__(self, messages: list[dict[str, Any]]) -> None:
        self._messages = [json.dumps(message) for message in messages]
        self.sent: list[object] = []

    async def __aenter__(self) -> FakeQwenSocket:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def send(self, payload: object) -> None:
        self.sent.append(payload)

    def __aiter__(self) -> FakeQwenSocket:
        return self

    async def __anext__(self) -> str:
        await asyncio.sleep(0)
        if not self._messages:
            raise StopAsyncIteration
        return self._messages.pop(0)


def _control_payload(payloads: list[object], control_type: str) -> dict[str, Any] | None:
    for payload in payloads:
        if not isinstance(payload, str):
            continue
        decoded = json.loads(payload)
        if decoded.get("type") == control_type:
            return decoded
    return None


def _is_control_payload(payload: object, control_type: str) -> bool:
    if not isinstance(payload, str):
        return False
    return json.loads(payload).get("type") == control_type
