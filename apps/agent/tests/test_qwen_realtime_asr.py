from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from echosync_agent.domain import AudioFrame, SegmentStatus
from echosync_agent.services.asr.qwen_realtime_transcriber import (
    QwenRealtimeAsrConfig,
    QwenRealtimeAsrTranscriber,
)


def test_qwen_realtime_asr_maps_partial_and_completed_events() -> None:
    async def scenario() -> tuple[list[object], list[object]]:
        socket = FakeQwenSocket(
            [
                {
                    "type": "conversation.item.input_audio_transcription.text",
                    "text": "你好",
                    "emotion": "neutral",
                },
                {
                    "type": "conversation.item.input_audio_transcription.completed",
                    "transcript": "你好世界。",
                    "usage": {"duration": 1.2},
                },
                {"type": "session.finished"},
            ]
        )
        transcriber = QwenRealtimeAsrTranscriber(
            QwenRealtimeAsrConfig(api_key="test-key", model="qwen3-asr-flash-realtime-2026-02-10"),
            connect_factory=lambda _url, _headers: socket,
        )

        segments = [segment async for segment in transcriber.stream(_frames())]
        return segments, socket.sent

    segments, sent = asyncio.run(scenario())

    assert [segment.text for segment in segments] == ["你好", "你好世界。"]
    assert [segment.status for segment in segments] == [
        SegmentStatus.PARTIAL,
        SegmentStatus.COMMITTED,
    ]
    assert segments[1].metrics["qwen_asr_final"] == 1.0
    assert any(_is_control_payload(payload, "session.update") for payload in sent)
    assert any(_is_control_payload(payload, "input_audio_buffer.append") for payload in sent)
    assert any(_is_control_payload(payload, "session.finish") for payload in sent)


async def _frames() -> AsyncIterator[AudioFrame]:
    yield AudioFrame(
        session_id="sess_qwen_asr",
        seq=1,
        pcm=b"\x01\x02",
        sample_rate=16_000,
        channels=1,
        start_ms=0,
        end_ms=80,
        source_lang="zh",
    )
    yield AudioFrame(
        session_id="sess_qwen_asr",
        seq=2,
        pcm=b"",
        sample_rate=16_000,
        channels=1,
        start_ms=80,
        end_ms=80,
        source_lang="zh",
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


def _is_control_payload(payload: object, control_type: str) -> bool:
    if not isinstance(payload, str):
        return False
    return json.loads(payload).get("type") == control_type
