from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from echosync_agent.domain import SegmentStatus, TranscriptSegment
from echosync_agent.services.asr.transcript_assembler import TranscriptAssembler


def test_transcript_assembler_streams_hypotheses_checkpoints_and_commit() -> None:
    assembler = TranscriptAssembler(checkpoint_audio_ms=1000)

    segments = asyncio.run(_collect(assembler.stream(_partial_segments(["Hello", ",", " world", "."]))))

    assert [(segment.text, segment.status) for segment in segments] == [
        ("Hello", SegmentStatus.PARTIAL),
        ("Hello,", SegmentStatus.STABLE),
        ("Hello, world", SegmentStatus.PARTIAL),
        ("Hello, world.", SegmentStatus.COMMITTED),
    ]
    assert {segment.segment_id for segment in segments} == {segments[0].segment_id}
    assert [segment.rev for segment in segments] == [1, 2, 3, 4]
    assert segments[-1].start_ms == 0
    assert segments[-1].end_ms == 2400
    assert segments[-1].metrics["merge_wait_ms"] >= 0
    assert segments[-1].metrics["asr_latency_ms"] == 12.0


def test_transcript_assembler_flushes_remaining_text_at_end_of_stream() -> None:
    assembler = TranscriptAssembler()

    segments = asyncio.run(_collect(assembler.stream(_partial_segments(["short", " tail"]))))

    assert segments[-1].text == "short tail"
    assert segments[-1].status == SegmentStatus.COMMITTED


async def _partial_segments(texts: list[str]) -> AsyncIterator[TranscriptSegment]:
    for index, text in enumerate(texts):
        yield TranscriptSegment(
            session_id="sess_asm",
            segment_id=f"seg_{index}",
            rev=1,
            start_ms=index * 600,
            end_ms=(index + 1) * 600,
            source_lang="en",
            text=text,
            status=SegmentStatus.PARTIAL,
            stability=0.72,
            metrics={"asr_latency_ms": 12.0},
        )


async def _collect(items: AsyncIterator[TranscriptSegment]) -> list[TranscriptSegment]:
    return [item async for item in items]
