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


def test_transcript_assembler_checkpoints_on_chinese_comma_without_locking() -> None:
    assembler = TranscriptAssembler()

    segments = asyncio.run(_collect(assembler.stream(_partial_segments(["会遵循流程，"]))))

    assert [(segment.text, segment.status) for segment in segments] == [
        ("会遵循流程，", SegmentStatus.STABLE),
        ("会遵循流程，", SegmentStatus.COMMITTED),
    ]


def test_transcript_assembler_does_not_force_commit_long_segment_without_sentence_punctuation(
) -> None:
    assembler = TranscriptAssembler(max_segment_audio_ms=1200, max_segment_chars=200)

    segments = asyncio.run(
        _collect(assembler.stream(_partial_segments(["第一段", "需要被切开", "避免字幕堆叠"])))
    )

    committed = [segment for segment in segments if segment.status == SegmentStatus.COMMITTED]
    assert len(committed) == 1
    assert committed[0] == segments[-1]
    assert committed[0].text == "第一段需要被切开避免字幕堆叠"


def test_transcript_assembler_tracks_text_incrementally_without_regressing_contract() -> None:
    assembler = TranscriptAssembler(checkpoint_audio_ms=10_000, max_segment_chars=9)

    segments = asyncio.run(
        _collect(assembler.stream(_partial_segments(["abc", "def", "ghi", "j"])))
    )

    assert [(segment.text, segment.status) for segment in segments] == [
        ("abc", SegmentStatus.PARTIAL),
        ("abcdef", SegmentStatus.PARTIAL),
        ("abcdefghi", SegmentStatus.STABLE),
        ("abcdefghij", SegmentStatus.PARTIAL),
        ("abcdefghij", SegmentStatus.COMMITTED),
    ]
    assert len({segment.segment_id for segment in segments}) == 1


def test_transcript_assembler_streams_cjk_deltas_as_cumulative_same_segment_text() -> None:
    assembler = TranscriptAssembler(
        checkpoint_audio_ms=10_000,
        max_segment_audio_ms=10_000,
        max_segment_chars=200,
    )

    segments = asyncio.run(
        _collect(assembler.stream(_partial_segments(["你", "好", "世", "界", "，"])))
    )

    assert [(segment.text, segment.status) for segment in segments] == [
        ("你", SegmentStatus.PARTIAL),
        ("你好", SegmentStatus.PARTIAL),
        ("你好世", SegmentStatus.PARTIAL),
        ("你好世界", SegmentStatus.PARTIAL),
        ("你好世界，", SegmentStatus.STABLE),
        ("你好世界，", SegmentStatus.COMMITTED),
    ]
    assert len({segment.segment_id for segment in segments}) == 1


def test_transcript_assembler_keeps_legacy_source_emission_config_without_delaying_source() -> None:
    assembler = TranscriptAssembler(
        checkpoint_audio_ms=10_000,
        max_segment_audio_ms=10_000,
        max_segment_chars=200,
        emission_policy=TextEmissionPolicy(source_cjk_min_chars=2),
    )

    segments = asyncio.run(_collect(assembler.stream(_partial_segments(["你", "好", "世"]))))

    assert [(segment.text, segment.status) for segment in segments] == [
        ("你", SegmentStatus.PARTIAL),
        ("你好", SegmentStatus.PARTIAL),
        ("你好世", SegmentStatus.PARTIAL),
        ("你好世", SegmentStatus.COMMITTED),
    ]


def test_transcript_assembler_replaces_rolling_full_hypotheses() -> None:
    assembler = TranscriptAssembler(
        checkpoint_audio_ms=10_000,
        max_segment_audio_ms=10_000,
        max_segment_chars=200,
    )

    segments = asyncio.run(
        _collect(assembler.stream(_partial_segments(["Hello wor", "Hello world", "Hello world."])))
    )

    assert [(segment.text, segment.status) for segment in segments] == [
        ("Hello wor", SegmentStatus.PARTIAL),
        ("Hello world", SegmentStatus.PARTIAL),
        ("Hello world.", SegmentStatus.COMMITTED),
    ]


def test_transcript_assembler_does_not_checkpoint_single_word_from_cumulative_provider_time(
) -> None:
    assembler = TranscriptAssembler(
        checkpoint_audio_ms=1_000,
        max_segment_audio_ms=10_000,
        max_segment_chars=200,
    )

    segments = asyncio.run(
        _collect(
            assembler.stream(
                _timed_partial_segments(
                    [
                        ("we", 0, 4_000),
                        (" are", 0, 4_080),
                    ]
                )
            )
        )
    )

    assert [(segment.text, segment.status) for segment in segments] == [
        ("we", SegmentStatus.PARTIAL),
        ("we are", SegmentStatus.PARTIAL),
        ("we are", SegmentStatus.COMMITTED),
    ]


def test_transcript_assembler_does_not_lock_each_short_upstream_final_without_punctuation() -> None:
    assembler = TranscriptAssembler(
        checkpoint_audio_ms=10_000,
        max_segment_audio_ms=10_000,
        max_segment_chars=200,
    )

    segments = asyncio.run(
        _collect(
            assembler.stream(
                _timed_segments(
                    [
                        ("we", 0, 600, SegmentStatus.COMMITTED),
                        (" are", 600, 1_200, SegmentStatus.COMMITTED),
                        (" training", 1_200, 1_800, SegmentStatus.COMMITTED),
                        (" our", 1_800, 2_400, SegmentStatus.COMMITTED),
                        (" model.", 2_400, 3_000, SegmentStatus.COMMITTED),
                    ]
                )
            )
        )
    )

    committed = [segment for segment in segments if segment.status == SegmentStatus.COMMITTED]
    assert [segment.text for segment in committed] == ["we are training our model."]
    assert len({segment.segment_id for segment in segments}) == 1


def test_transcript_assembler_does_not_force_commit_each_short_delta_from_cumulative_provider_time(
) -> None:
    assembler = TranscriptAssembler(
        checkpoint_audio_ms=10_000,
        max_segment_audio_ms=3_800,
        max_segment_chars=200,
    )

    segments = asyncio.run(
        _collect(
            assembler.stream(
                _timed_partial_segments(
                    [
                        ("we", 0, 4_000),
                        (" are", 0, 4_080),
                        (" training", 0, 4_160),
                        (" our", 0, 4_240),
                    ]
                )
            )
        )
    )

    assert [(segment.text, segment.status) for segment in segments] == [
        ("we", SegmentStatus.PARTIAL),
        ("we are", SegmentStatus.PARTIAL),
        ("we are training", SegmentStatus.PARTIAL),
        ("we are training our", SegmentStatus.PARTIAL),
        ("we are training our", SegmentStatus.COMMITTED),
    ]
    assert len({segment.segment_id for segment in segments}) == 1


def test_transcript_assembler_does_not_force_commit_single_cjk_token_from_cumulative_provider_time(
) -> None:
    assembler = TranscriptAssembler(
        checkpoint_audio_ms=10_000,
        max_segment_audio_ms=3_800,
        max_segment_chars=200,
    )

    segments = asyncio.run(
        _collect(
            assembler.stream(
                _timed_partial_segments(
                    [
                        ("你", 0, 4_000),
                        ("好", 0, 4_080),
                    ]
                )
            )
        )
    )

    assert [(segment.text, segment.status) for segment in segments] == [
        ("你", SegmentStatus.PARTIAL),
        ("你好", SegmentStatus.PARTIAL),
        ("你好", SegmentStatus.COMMITTED),
    ]
    assert len({segment.segment_id for segment in segments}) == 1


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


async def _timed_partial_segments(
    items: list[tuple[str, int, int]]
) -> AsyncIterator[TranscriptSegment]:
    for index, (text, start_ms, end_ms) in enumerate(items):
        yield TranscriptSegment(
            session_id="sess_asm",
            segment_id=f"seg_timed_{index}",
            rev=1,
            start_ms=start_ms,
            end_ms=end_ms,
            source_lang="en",
            text=text,
            status=SegmentStatus.PARTIAL,
            stability=0.72,
            metrics={"asr_latency_ms": 12.0},
        )


async def _timed_segments(
    items: list[tuple[str, int, int, SegmentStatus]]
) -> AsyncIterator[TranscriptSegment]:
    for index, (text, start_ms, end_ms, status) in enumerate(items):
        yield TranscriptSegment(
            session_id="sess_asm",
            segment_id=f"seg_status_{index}",
            rev=1,
            start_ms=start_ms,
            end_ms=end_ms,
            source_lang="en",
            text=text,
            status=status,
            stability=1.0 if status == SegmentStatus.COMMITTED else 0.72,
            metrics={"asr_latency_ms": 12.0},
        )


async def _collect(items: AsyncIterator[TranscriptSegment]) -> list[TranscriptSegment]:
    return [item async for item in items]
