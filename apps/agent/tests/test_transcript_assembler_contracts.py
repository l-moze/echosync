from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from echosync_agent.domain import SegmentStatus, TranscriptSegment
from echosync_agent.services.asr.transcript_assembler import TranscriptAssembler
from echosync_agent.services.realtime.text_emission_policy import TextEmissionPolicy


def test_transcript_assembler_streams_hypotheses_checkpoints_and_commit() -> None:
    assembler = TranscriptAssembler(checkpoint_audio_ms=1000)

    segments = asyncio.run(
        _collect(assembler.stream(_partial_segments(["Hello", ",", " world", "."])))
    )

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


def test_transcript_assembler_commits_on_chinese_comma() -> None:
    assembler = TranscriptAssembler()

    segments = asyncio.run(_collect(assembler.stream(_partial_segments(["会遵循流程，"]))))

    assert segments[-1].text == "会遵循流程，"
    assert segments[-1].status == SegmentStatus.COMMITTED


def test_transcript_assembler_force_commits_long_segment_without_punctuation() -> None:
    assembler = TranscriptAssembler(max_segment_audio_ms=1200, max_segment_chars=200)

    segments = asyncio.run(
        _collect(assembler.stream(_partial_segments(["第一段", "需要被切开", "避免字幕堆叠"])))
    )

    assert any(segment.status == SegmentStatus.COMMITTED for segment in segments)
    committed = [segment for segment in segments if segment.status == SegmentStatus.COMMITTED]
    assert committed[0].text == "第一段需要被切开"


def test_transcript_assembler_tracks_text_incrementally_without_regressing_contract() -> None:
    assembler = TranscriptAssembler(checkpoint_audio_ms=10_000, max_segment_chars=9)

    segments = asyncio.run(
        _collect(assembler.stream(_partial_segments(["abc", "def", "ghi", "j"])))
    )

    assert [(segment.text, segment.status) for segment in segments] == [
        ("abc", SegmentStatus.PARTIAL),
        ("abcdef", SegmentStatus.PARTIAL),
        ("abcdefghi", SegmentStatus.COMMITTED),
        ("j", SegmentStatus.PARTIAL),
        ("j", SegmentStatus.COMMITTED),
    ]
    assert segments[2].segment_id != segments[3].segment_id


def test_transcript_assembler_coalesces_single_character_deltas_before_display() -> None:
    assembler = TranscriptAssembler(
        checkpoint_audio_ms=10_000,
        max_segment_audio_ms=10_000,
        max_segment_chars=200,
    )

    segments = asyncio.run(
        _collect(assembler.stream(_partial_segments(["你", "好", "世", "界", "，"])))
    )

    assert [(segment.text, segment.status) for segment in segments] == [
        ("你好世界", SegmentStatus.PARTIAL),
        ("你好世界，", SegmentStatus.COMMITTED),
    ]


def test_transcript_assembler_accepts_custom_emission_policy() -> None:
    assembler = TranscriptAssembler(
        checkpoint_audio_ms=10_000,
        max_segment_audio_ms=10_000,
        max_segment_chars=200,
        emission_policy=TextEmissionPolicy(source_cjk_min_chars=2),
    )

    segments = asyncio.run(_collect(assembler.stream(_partial_segments(["你", "好", "世"]))))

    assert [(segment.text, segment.status) for segment in segments] == [
        ("你好", SegmentStatus.PARTIAL),
        ("你好世", SegmentStatus.COMMITTED),
    ]


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
