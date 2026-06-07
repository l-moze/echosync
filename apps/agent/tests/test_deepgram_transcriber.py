from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from echosync_agent.domain import AudioFrame, SegmentStatus
from echosync_agent.services.asr.deepgram_transcriber import (
    DeepgramStreamingConfig,
    DeepgramStreamingTranscriber,
)


def test_deepgram_transcriber_maps_streaming_results_to_transcript_segments() -> None:
    async def scenario() -> tuple[list[object], list[object]]:
        socket = FakeDeepgramSocket(
            [
                {
                    "type": "Results",
                    "channel": {"alternatives": [{"transcript": "hello", "confidence": 0.72}]},
                    "is_final": False,
                    "speech_final": False,
                    "start": 0.0,
                    "duration": 0.32,
                },
                {
                    "type": "Results",
                    "channel": {
                        "alternatives": [{"transcript": "hello world.", "confidence": 0.96}]
                    },
                    "is_final": True,
                    "speech_final": True,
                    "start": 0.0,
                    "duration": 0.96,
                },
            ]
        )
        transcriber = DeepgramStreamingTranscriber(
            DeepgramStreamingConfig(api_key="test-key", model="nova-3", endpointing_ms=300),
            connect_factory=lambda _url, _headers: socket,
        )

        segments = [segment async for segment in transcriber.stream(_frames())]
        return segments, socket.sent

    segments, sent = asyncio.run(scenario())

    assert [segment.text for segment in segments] == ["hello", "hello world."]
    assert [segment.status for segment in segments] == [
        SegmentStatus.PARTIAL,
        SegmentStatus.COMMITTED,
    ]
    assert segments[1].stability == 1.0
    assert segments[1].metrics["asr_endpoint_final"] == 1.0
    assert any(payload == b"\x01\x02" for payload in sent)
    assert any(_is_control_payload(payload, "Finalize") for payload in sent)


def test_deepgram_transcriber_accumulates_final_spans_until_speech_final() -> None:
    async def scenario() -> list[str]:
        socket = FakeDeepgramSocket(
            [
                {
                    "type": "Results",
                    "channel": {
                        "alternatives": [{"transcript": "yeah so my card", "confidence": 0.72}]
                    },
                    "is_final": False,
                    "speech_final": False,
                    "start": 0.0,
                    "duration": 1.1,
                },
                {
                    "type": "Results",
                    "channel": {
                        "alternatives": [
                            {
                                "transcript": "yeah so my card number is two two",
                                "confidence": 0.90,
                            }
                        ]
                    },
                    "is_final": True,
                    "speech_final": False,
                    "start": 0.0,
                    "duration": 3.26,
                },
                {
                    "type": "Results",
                    "channel": {
                        "alternatives": [
                            {"transcript": "two two three three", "confidence": 0.78}
                        ]
                    },
                    "is_final": False,
                    "speech_final": False,
                    "start": 3.26,
                    "duration": 1.42,
                },
                {
                    "type": "Results",
                    "channel": {
                        "alternatives": [
                            {"transcript": "two two three three", "confidence": 0.96}
                        ]
                    },
                    "is_final": True,
                    "speech_final": True,
                    "start": 3.26,
                    "duration": 1.50,
                },
            ]
        )
        transcriber = DeepgramStreamingTranscriber(
            DeepgramStreamingConfig(api_key="test-key", model="nova-3", endpointing_ms=300),
            connect_factory=lambda _url, _headers: socket,
        )

        return [segment.text async for segment in transcriber.stream(_frames())]

    texts = asyncio.run(scenario())

    assert texts == [
        "yeah so my card",
        "yeah so my card number is two two",
        "yeah so my card number is two two three three",
        "yeah so my card number is two two three three",
    ]


async def _frames() -> AsyncIterator[AudioFrame]:
    yield AudioFrame(
        session_id="sess_deepgram",
        seq=1,
        pcm=b"\x01\x02",
        sample_rate=16_000,
        channels=1,
        start_ms=0,
        end_ms=80,
        source_lang="en",
    )
    yield AudioFrame(
        session_id="sess_deepgram",
        seq=2,
        pcm=b"",
        sample_rate=16_000,
        channels=1,
        start_ms=80,
        end_ms=80,
        source_lang="en",
        is_final=True,
    )


def _is_control_payload(payload: object, control_type: str) -> bool:
    if not isinstance(payload, str):
        return False
    return json.loads(payload).get("type") == control_type


class FakeDeepgramSocket:
    def __init__(self, messages: list[dict[str, Any]]) -> None:
        self._messages = [json.dumps(message) for message in messages]
        self.sent: list[object] = []

    async def __aenter__(self) -> FakeDeepgramSocket:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def send(self, payload: object) -> None:
        self.sent.append(payload)

    def __aiter__(self) -> FakeDeepgramSocket:
        return self

    async def __anext__(self) -> str:
        await asyncio.sleep(0)
        if not self._messages:
            raise StopAsyncIteration
        return self._messages.pop(0)
