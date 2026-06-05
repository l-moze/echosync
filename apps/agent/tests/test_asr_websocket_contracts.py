from __future__ import annotations

import base64
from collections.abc import AsyncIterator

from fastapi.testclient import TestClient

from echosync_agent.domain import AudioFrame, SegmentStatus, TranscriptSegment, new_segment_id
from echosync_agent.interfaces import Transcriber
from echosync_agent.transport.asr_websocket import create_asr_app


def test_asr_websocket_streams_pcm_chunks_into_transcriber() -> None:
    seen_frames: list[AudioFrame] = []

    class EchoTranscriber(Transcriber):
        async def stream(
            self,
            frames: AsyncIterator[AudioFrame],
        ) -> AsyncIterator[TranscriptSegment]:
            async for frame in frames:
                seen_frames.append(frame)
                yield TranscriptSegment(
                    session_id=frame.session_id,
                    segment_id=new_segment_id(),
                    rev=1,
                    start_ms=frame.start_ms,
                    end_ms=frame.end_ms,
                    source_lang=frame.source_lang,
                    text=frame.pcm.decode("utf-8"),
                    status=SegmentStatus.COMMITTED if frame.is_final else SegmentStatus.PARTIAL,
                    stability=1.0 if frame.is_final else 0.7,
                    metrics={"asr_latency_ms": 12.0, "asr_rtf": 0.02},
                )

    app = create_asr_app(transcriber_factory=lambda: EchoTranscriber())
    client = TestClient(app)

    with client.websocket_connect("/v1/asr/sessions/sess_ws") as websocket:
        websocket.send_json(
            {
                "type": "asr.start",
                "source_lang": "zh",
                "sample_rate": 16_000,
                "channels": 1,
                "source_kind": "file",
                "device_id": "lecture.mp4",
            }
        )
        websocket.send_json(
            {
                "type": "audio.chunk",
                "seq": 1,
                "start_ms": 0,
                "end_ms": 600,
                "pcm_base64": _b64("第一段"),
            }
        )
        partial = websocket.receive_json()

        websocket.send_json(
            {
                "type": "audio.chunk",
                "seq": 2,
                "start_ms": 600,
                "end_ms": 1200,
                "pcm_base64": _b64("第二段"),
                "is_final": True,
            }
        )
        committed = websocket.receive_json()
        done = websocket.receive_json()

    assert [frame.seq for frame in seen_frames] == [1, 2]
    assert seen_frames[0].sample_rate == 16_000
    assert seen_frames[0].channels == 1
    assert seen_frames[0].source_lang == "zh"
    assert seen_frames[0].source_kind == "file"
    assert seen_frames[0].device_id == "lecture.mp4"
    assert seen_frames[0].is_final is False
    assert seen_frames[1].is_final is True
    assert partial["type"] == "asr.segment"
    assert partial["text"] == "第一段"
    assert partial["status"] == "partial"
    assert committed["type"] == "asr.segment"
    assert committed["text"] == "第二段"
    assert committed["status"] == "committed"
    assert committed["metrics"]["asr_latency_ms"] == 12.0
    assert done == {"type": "asr.done", "session_id": "sess_ws"}


def test_asr_websocket_reports_invalid_chunk_without_crashing() -> None:
    class SilentTranscriber(Transcriber):
        async def stream(
            self,
            frames: AsyncIterator[AudioFrame],
        ) -> AsyncIterator[TranscriptSegment]:
            async for _frame in frames:
                return
            if False:
                yield

    app = create_asr_app(transcriber_factory=lambda: SilentTranscriber())
    client = TestClient(app)

    with client.websocket_connect("/v1/asr/sessions/sess_bad") as websocket:
        websocket.send_json({"type": "audio.chunk", "pcm_base64": "not-base64"})
        error = websocket.receive_json()
        websocket.send_json({"type": "asr.end"})
        done = websocket.receive_json()

    assert error["type"] == "asr.error"
    assert "pcm_base64" in error["message"]
    assert done == {"type": "asr.done", "session_id": "sess_bad"}


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")
