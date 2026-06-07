from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import suppress

from echosync_agent.domain import (
    AudioFrame,
    CorrectionContext,
    SegmentCommit,
    SegmentStatus,
    SubtitlePatch,
    TranscriptSegment,
    TranslationSegment,
)
from echosync_agent.interfaces import CorrectionEngine, Transcriber, Translator
from echosync_agent.services.correction.revision_window import RevisionWindowCorrectionEngine
from echosync_agent.services.engine.cascaded_engine import CascadedInterpretationEngine


def test_cascaded_engine_translates_assembled_segments_and_records_latency_metrics() -> None:
    asyncio.run(_assert_engine_translates_segments_and_records_latency_metrics())


def test_cascaded_engine_streams_source_hypotheses_and_translation_deltas() -> None:
    asyncio.run(_assert_cascaded_engine_streams_source_hypotheses_and_translation_deltas())


def test_cascaded_engine_records_translation_streaming_metrics() -> None:
    asyncio.run(_assert_cascaded_engine_records_translation_streaming_metrics())


def test_cascaded_engine_logs_translation_timing_checkpoints(caplog) -> None:
    caplog.set_level(
        logging.INFO,
        logger="echosync_agent.services.engine.cascaded_engine",
    )

    asyncio.run(_assert_cascaded_engine_streams_source_hypotheses_and_translation_deltas())

    messages = [
        record.getMessage()
        for record in caplog.records
        if record.name == "echosync_agent.services.engine.cascaded_engine"
    ]
    assert any("translation_checkpoint_started" in message for message in messages)
    assert any("translation_checkpoint_first_token" in message for message in messages)
    assert any("translation_checkpoint_finished" in message for message in messages)


def test_cascaded_engine_does_not_block_source_hypotheses_on_slow_translation() -> None:
    asyncio.run(_assert_cascaded_engine_does_not_block_source_hypotheses_on_slow_translation())


def test_cascaded_engine_skips_stale_checkpoints_when_newer_revision_is_queued() -> None:
    asyncio.run(_assert_cascaded_engine_skips_stale_checkpoints_when_newer_revision_is_queued())


def test_cascaded_engine_coalesces_pending_translation_checkpoints() -> None:
    asyncio.run(_assert_cascaded_engine_coalesces_pending_translation_checkpoints())


def test_cascaded_engine_drops_pending_stable_when_committed_arrives() -> None:
    asyncio.run(_assert_cascaded_engine_drops_pending_stable_when_committed_arrives())


def test_cascaded_engine_preempts_active_stable_when_committed_arrives() -> None:
    asyncio.run(_assert_cascaded_engine_preempts_active_stable_when_committed_arrives())


def test_cascaded_engine_drops_backlogged_drafts_before_committed_checkpoint() -> None:
    asyncio.run(_assert_cascaded_engine_drops_backlogged_drafts_before_committed_checkpoint())


def test_cascaded_engine_drops_stale_draft_when_newer_draft_is_queued() -> None:
    asyncio.run(_assert_cascaded_engine_drops_stale_draft_when_newer_draft_is_queued())


def test_cascaded_engine_refreshes_stable_translation_for_long_segment() -> None:
    asyncio.run(_assert_cascaded_engine_refreshes_stable_translation_for_long_segment())


def test_cascaded_engine_accepts_batch_only_translator() -> None:
    asyncio.run(_assert_cascaded_engine_accepts_batch_only_translator())


def test_cascaded_engine_translates_weak_boundary_without_committing_segment() -> None:
    asyncio.run(_assert_cascaded_engine_translates_weak_boundary_without_committing_segment())


def test_cascaded_engine_translates_long_partial_before_stable_checkpoint() -> None:
    asyncio.run(_assert_cascaded_engine_translates_long_partial_before_stable_checkpoint())


def test_cascaded_engine_skips_partial_translation_by_default(caplog) -> None:
    caplog.set_level(
        logging.INFO,
        logger="echosync_agent.services.engine.cascaded_engine",
    )

    asyncio.run(_assert_cascaded_engine_skips_partial_translation_by_default())

    messages = [
        record.getMessage()
        for record in caplog.records
        if record.name == "echosync_agent.services.engine.cascaded_engine"
    ]
    assert any("translation_checkpoint_skipped" in message for message in messages)


def test_cascaded_engine_waits_on_suspended_stable_tail(caplog) -> None:
    caplog.set_level(
        logging.INFO,
        logger="echosync_agent.services.engine.cascaded_engine",
    )

    asyncio.run(_assert_cascaded_engine_waits_on_suspended_stable_tail())

    messages = [
        record.getMessage()
        for record in caplog.records
        if record.name == "echosync_agent.services.engine.cascaded_engine"
    ]
    assert any("reason=simul_wait" in message for message in messages)
    assert any("simul_reason=suspended_tail" in message for message in messages)


def test_cascaded_engine_populates_caption_text_regions() -> None:
    asyncio.run(_assert_cascaded_engine_populates_caption_text_regions())


def test_cascaded_engine_passes_current_segment_revision_context() -> None:
    asyncio.run(_assert_cascaded_engine_passes_current_segment_revision_context())


def test_cascaded_engine_patches_current_segment_revision_without_waiting_for_commit() -> None:
    asyncio.run(_assert_cascaded_engine_patches_current_segment_revision_without_waiting_for_commit())


def test_cascaded_engine_does_not_block_commit_on_slow_correction() -> None:
    asyncio.run(_assert_cascaded_engine_does_not_block_commit_on_slow_correction())


async def _assert_engine_translates_segments_and_records_latency_metrics() -> None:
    translator = RecordingTranslator()
    engine = CascadedInterpretationEngine(
        transcriber=DeltaTranscriber(),
        translator=translator,
        correction_engine=NoopCorrectionEngine(),
    )

    events = [event async for event in engine.stream(_frames())]
    translations = [event for event in events if isinstance(event, TranslationSegment)]

    assert [segment.text for segment in translator.seen_segments] == ["Hello,", "Hello, world."]
    translated = [segment for segment in translations if segment.target_text]
    assert len(translated) == 2
    assert translated[0].source_text == "Hello,"
    assert translated[-1].source_text == "Hello, world."
    assert translated[0].metrics["merge_wait_ms"] >= 0
    assert translated[0].metrics["translation_latency_ms"] >= 0
    assert translated[-1].metrics["merge_wait_ms"] >= 0
    assert translated[-1].metrics["translation_latency_ms"] >= 0


async def _assert_cascaded_engine_populates_caption_text_regions() -> None:
    engine = CascadedInterpretationEngine(
        transcriber=DeltaTranscriber(),
        translator=RecordingTranslator(),
        correction_engine=NoopCorrectionEngine(),
    )

    events = [event async for event in engine.stream(_frames())]
    source_only = next(
        event
        for event in events
        if isinstance(event, TranslationSegment)
        and event.source_text == "Hello"
        and event.target_text == ""
    )
    final_translation = next(
        event
        for event in events
        if isinstance(event, TranslationSegment)
        and event.source_text == "Hello, world."
        and event.target_text
    )
    commit = next(event for event in events if isinstance(event, SegmentCommit))

    assert source_only.source_stable_text == ""
    assert source_only.source_unstable_text == "Hello"
    assert final_translation.source_stable_text == "Hello, world."
    assert final_translation.source_unstable_text == ""
    assert final_translation.target_stable_text == "[zh] Hello, world."
    assert final_translation.target_unstable_text == ""
    assert commit.source_stable_text == "Hello, world."
    assert commit.target_stable_text == "[zh] Hello, world."


async def _assert_cascaded_engine_passes_current_segment_revision_context() -> None:
    first_translated = asyncio.Event()
    second_translated = asyncio.Event()
    translator = ContextRecordingSignalingTranslator(first_translated, second_translated)
    engine = CascadedInterpretationEngine(
        transcriber=RefreshingStableTranscriber(first_translated, second_translated),
        translator=translator,
        correction_engine=NoopCorrectionEngine(),
        transcript_assembler=PassThroughAssembler(),
    )

    await _collect_events(engine.stream(_frames()))

    assert translator.contexts[0].current_segment_revisions == ()
    assert translator.contexts[1].current_segment_revisions[-1].source_text == "The model starts,"
    assert (
        translator.contexts[1].current_segment_revisions[-1].target_text
        == "[zh] The model starts,"
    )


async def _assert_cascaded_engine_patches_current_segment_revision_without_waiting_for_commit() -> None:
    first_translated = asyncio.Event()
    second_translated = asyncio.Event()
    engine = CascadedInterpretationEngine(
        transcriber=RefreshingStableTranscriber(first_translated, second_translated),
        translator=SignalingTranslator(first_translated, second_translated),
        correction_engine=RevisionWindowCorrectionEngine(),
        transcript_assembler=PassThroughAssembler(),
    )

    events = await _collect_events(engine.stream(_frames()))
    patches = [event for event in events if isinstance(event, SubtitlePatch)]

    assert patches
    assert patches[0].segment_id == "seg_refreshing_stable"
    assert patches[0].base_rev == 1
    assert patches[0].rev == 2
    assert patches[0].operations[0].text


async def _assert_cascaded_engine_does_not_block_commit_on_slow_correction() -> None:
    engine = CascadedInterpretationEngine(
        transcriber=ImmediateCommittedTranscriber(),
        translator=RecordingTranslator(),
        correction_engine=SlowCorrectionEngine(),
        transcript_assembler=PassThroughAssembler(),
        correction_timeout_ms=1,
    )

    events = await asyncio.wait_for(_collect_events(engine.stream(_frames())), timeout=0.2)

    assert any(isinstance(event, SegmentCommit) for event in events)
    assert not any(isinstance(event, SubtitlePatch) for event in events)


async def _assert_cascaded_engine_streams_source_hypotheses_and_translation_deltas() -> None:
    translator = StreamingTranslator()
    engine = CascadedInterpretationEngine(
        transcriber=DeltaTranscriber(),
        translator=translator,
        correction_engine=NoopCorrectionEngine(),
    )

    events = [event async for event in engine.stream(_frames())]
    translations = [event for event in events if isinstance(event, TranslationSegment)]
    commits = [event for event in events if isinstance(event, SegmentCommit)]

    observed = [(item.source_text, item.target_text, item.status) for item in translations]
    expected = [
        ("Hello", "", SegmentStatus.PARTIAL),
        ("Hello,", "", SegmentStatus.STABLE),
        ("Hello, world", "", SegmentStatus.PARTIAL),
        ("Hello, world.", "", SegmentStatus.COMMITTED),
        ("Hello,", "[zh]", SegmentStatus.STABLE),
        ("Hello,", "[zh] Hello,", SegmentStatus.STABLE),
        ("Hello, world.", "[zh]", SegmentStatus.COMMITTED),
        ("Hello, world.", "[zh] Hello, world.", SegmentStatus.COMMITTED),
    ]
    assert all(item in observed for item in expected)
    assert len({item.segment_id for item in translations}) == 1
    assert [item.text for item in translator.seen_segments] == ["Hello,", "Hello, world."]
    assert len(commits) == 1
    assert commits[0].source_text == "Hello, world."
    assert commits[0].target_text == "[zh] Hello, world."


async def _assert_cascaded_engine_records_translation_streaming_metrics() -> None:
    engine = CascadedInterpretationEngine(
        transcriber=DeltaTranscriber(),
        translator=StreamingTranslator(),
        correction_engine=NoopCorrectionEngine(),
    )

    events = [event async for event in engine.stream(_frames())]
    translated = [
        event
        for event in events
        if isinstance(event, TranslationSegment) and event.target_text
    ]

    assert translated[0].metrics["translation_first_token_ms"] >= 0
    assert translated[0].metrics["translation_delta_count"] == 1
    assert translated[1].metrics["translation_delta_count"] == 2
    assert translated[-1].metrics["translation_first_token_ms"] >= 0
    commits = [event for event in events if isinstance(event, SegmentCommit)]
    assert commits[0].metrics["translation_first_token_ms"] >= 0
    assert commits[0].metrics["translation_queue_wait_ms"] >= 0
    assert commits[0].metrics["simul_policy_request_action"] == 2.0


async def _assert_cascaded_engine_does_not_block_source_hypotheses_on_slow_translation() -> None:
    engine = CascadedInterpretationEngine(
        transcriber=TwoSentenceTranscriber(),
        translator=SlowStreamingTranslator(),
        correction_engine=NoopCorrectionEngine(),
    )

    events = [event async for event in engine.stream(_frames())]
    translations = [event for event in events if isinstance(event, TranslationSegment)]

    assert [(event.source_text, event.target_text) for event in translations[:2]] == [
        ("First.", ""),
        ("Second.", ""),
    ]
    assert any(event.target_text == "[zh] First." for event in translations)
    assert any(event.target_text == "[zh] Second." for event in translations)


async def _assert_cascaded_engine_skips_stale_checkpoints_when_newer_revision_is_queued() -> None:
    translator = SlowStreamingTranslator()
    engine = CascadedInterpretationEngine(
        transcriber=FastRevisionTranscriber(),
        translator=translator,
        correction_engine=NoopCorrectionEngine(),
    )

    events = [event async for event in engine.stream(_frames())]
    translations = [event for event in events if isinstance(event, TranslationSegment)]

    assert [segment.text for segment in translator.seen_segments] == [
        "First revision final",
        "First revision final.",
    ]
    assert any(event.target_text == "[zh] First revision final." for event in translations)


async def _assert_cascaded_engine_coalesces_pending_translation_checkpoints() -> None:
    translator = BlockingTranslator()
    engine = CascadedInterpretationEngine(
        transcriber=BurstStableTranscriber(),
        translator=translator,
        correction_engine=NoopCorrectionEngine(),
        transcript_assembler=PassThroughAssembler(),
    )

    stream = engine.stream(_frames())
    first = await anext(stream)
    assert isinstance(first, TranslationSegment)
    assert first.source_text == "first stable"

    await asyncio.wait_for(translator.started.wait(), timeout=1)
    await asyncio.sleep(0)
    translator.release.set()
    remaining = [event async for event in stream]
    translations = [event for event in remaining if isinstance(event, TranslationSegment)]

    assert [segment.text for segment in translator.seen_segments] == [
        "first stable",
        "third committed",
    ]
    assert any(event.target_text == "[zh] third committed" for event in translations)


async def _assert_cascaded_engine_drops_pending_stable_when_committed_arrives() -> None:
    translator = BlockingTranslator()
    engine = CascadedInterpretationEngine(
        transcriber=BackloggedStableCommittedTranscriber(),
        translator=translator,
        correction_engine=NoopCorrectionEngine(),
        transcript_assembler=PassThroughAssembler(),
    )

    stream = engine.stream(_frames())
    first = await anext(stream)
    assert isinstance(first, TranslationSegment)
    assert first.source_text == "blocking segment."

    await asyncio.wait_for(translator.started.wait(), timeout=1)
    await asyncio.sleep(0)
    translator.release.set()
    remaining = [event async for event in stream]
    translations = [event for event in remaining if isinstance(event, TranslationSegment)]

    assert [segment.text for segment in translator.seen_segments] == [
        "blocking segment.",
        "latest committed.",
    ]
    latest = next(event for event in translations if event.target_text == "[zh] latest committed.")
    assert latest.metrics["translation_queue_wait_ms"] >= 0


async def _assert_cascaded_engine_preempts_active_stable_when_committed_arrives() -> None:
    translator = BlockingTranslator()
    engine = CascadedInterpretationEngine(
        transcriber=ActiveStableThenCommittedTranscriber(translator.started),
        translator=translator,
        correction_engine=NoopCorrectionEngine(),
        transcript_assembler=PassThroughAssembler(),
    )

    events = await asyncio.wait_for(_collect_events(engine.stream(_frames())), timeout=1)
    translated = [
        event
        for event in events
        if isinstance(event, TranslationSegment) and event.target_text
    ]

    assert [segment.text for segment in translator.seen_segments] == [
        "draft that will be superseded",
        "final text.",
    ]
    assert [event.target_text for event in translated] == ["[zh] final text."]


async def _assert_cascaded_engine_drops_backlogged_drafts_before_committed_checkpoint() -> None:
    translator = BlockingTranslator()
    engine = CascadedInterpretationEngine(
        transcriber=BackloggedDraftsThenCommittedTranscriber(),
        translator=translator,
        correction_engine=NoopCorrectionEngine(),
        transcript_assembler=PassThroughAssembler(),
    )

    stream = engine.stream(_frames())
    first = await anext(stream)
    assert isinstance(first, TranslationSegment)
    assert first.source_text == "blocking segment."

    await asyncio.wait_for(translator.started.wait(), timeout=1)
    await asyncio.sleep(0)
    translator.release.set()
    remaining = [event async for event in stream]
    translations = [event for event in remaining if isinstance(event, TranslationSegment)]

    assert [segment.text for segment in translator.seen_segments] == [
        "blocking segment.",
        "current committed.",
    ]
    assert any(event.target_text == "[zh] current committed." for event in translations)
    assert all(
        event.target_text not in {"[zh] stale stable draft", "[zh] another stable draft"}
        for event in translations
    )


async def _assert_cascaded_engine_drops_stale_draft_when_newer_draft_is_queued() -> None:
    translator = BlockingTranslator()
    engine = CascadedInterpretationEngine(
        transcriber=BackloggedStableRefreshOnlyTranscriber(),
        translator=translator,
        correction_engine=NoopCorrectionEngine(),
        transcript_assembler=PassThroughAssembler(),
    )

    stream = engine.stream(_frames())
    first = await anext(stream)
    assert isinstance(first, TranslationSegment)
    assert first.source_text == "blocking segment."

    await asyncio.wait_for(translator.started.wait(), timeout=1)
    await asyncio.sleep(0)
    translator.release.set()
    remaining = [event async for event in stream]
    translations = [event for event in remaining if isinstance(event, TranslationSegment)]

    assert [segment.text for segment in translator.seen_segments] == [
        "blocking segment.",
        "newer stable draft with enough content.",
    ]
    assert any(
        event.target_text == "[zh] newer stable draft with enough content."
        for event in translations
    )
    assert all(event.target_text != "[zh] stale stable draft" for event in translations)


async def _assert_cascaded_engine_refreshes_stable_translation_for_long_segment() -> None:
    first_translated = asyncio.Event()
    second_translated = asyncio.Event()
    translator = SignalingTranslator(first_translated, second_translated)
    engine = CascadedInterpretationEngine(
        transcriber=RefreshingStableTranscriber(first_translated, second_translated),
        translator=translator,
        correction_engine=NoopCorrectionEngine(),
        transcript_assembler=PassThroughAssembler(),
    )

    events = [event async for event in engine.stream(_frames())]
    translations = [event for event in events if isinstance(event, TranslationSegment)]

    assert [segment.text for segment in translator.seen_segments] == [
        "The model starts,",
        "The model starts, then explains the pipeline",
        "The model starts, then explains the pipeline.",
    ]
    assert any(
        event.target_text == "[zh] The model starts, then explains the pipeline"
        and event.status == SegmentStatus.STABLE
        for event in translations
    )


async def _assert_cascaded_engine_accepts_batch_only_translator() -> None:
    translator = BatchOnlyTranslator()
    engine = CascadedInterpretationEngine(
        transcriber=TwoSentenceTranscriber(),
        translator=translator,
        correction_engine=NoopCorrectionEngine(),
    )

    events = [event async for event in engine.stream(_frames())]
    translated = [
        event for event in events
        if isinstance(event, TranslationSegment) and event.target_text
    ]

    assert [segment.text for segment in translator.seen_segments] == ["First.", "Second."]
    assert [event.target_text for event in translated] == ["[batch] First.", "[batch] Second."]


async def _assert_cascaded_engine_translates_weak_boundary_without_committing_segment() -> None:
    translator = RecordingTranslator()
    engine = CascadedInterpretationEngine(
        transcriber=WeakBoundaryTranscriber(),
        translator=translator,
        correction_engine=NoopCorrectionEngine(),
    )

    events = [event async for event in engine.stream(_frames())]
    translations = [event for event in events if isinstance(event, TranslationSegment)]
    commits = [event for event in events if isinstance(event, SegmentCommit)]

    assert any(
        event.source_text == "The model starts,"
        and event.target_text == "[zh] The model starts,"
        and event.status == SegmentStatus.STABLE
        for event in translations
    )
    assert [commit.source_text for commit in commits] == ["The model starts, then finishes."]


async def _assert_cascaded_engine_translates_long_partial_before_stable_checkpoint() -> None:
    first_translated = asyncio.Event()
    translator = SignalingTranslator(first_translated, asyncio.Event())
    engine = CascadedInterpretationEngine(
        transcriber=LongPartialBeforeStableTranscriber(first_translated),
        translator=translator,
        correction_engine=NoopCorrectionEngine(),
        translate_partial_checkpoints=True,
    )

    events = [event async for event in engine.stream(_frames())]
    translated = [
        event
        for event in events
        if isinstance(event, TranslationSegment) and event.target_text
    ]

    assert translator.seen_segments[0].status == SegmentStatus.PARTIAL
    assert translator.seen_segments[0].text == "今天我们来讲实时翻译"
    assert any(
        event.status == SegmentStatus.PARTIAL
        and event.target_text == "[zh] 今天我们来讲实时翻译"
        for event in translated
    )


async def _assert_cascaded_engine_skips_partial_translation_by_default() -> None:
    first_translated = asyncio.Event()
    translator = SignalingTranslator(first_translated, asyncio.Event())
    engine = CascadedInterpretationEngine(
        transcriber=LongPartialBeforeStableTranscriber(first_translated),
        translator=translator,
        correction_engine=NoopCorrectionEngine(),
    )

    events = [event async for event in engine.stream(_frames())]
    translated = [
        event
        for event in events
        if isinstance(event, TranslationSegment) and event.target_text
    ]

    assert [segment.status for segment in translator.seen_segments] == [
        SegmentStatus.COMMITTED
    ]
    assert translator.seen_segments[0].text == "今天我们来讲实时翻译。"
    assert all(event.status != SegmentStatus.PARTIAL for event in translated)


async def _assert_cascaded_engine_waits_on_suspended_stable_tail() -> None:
    translator = RecordingTranslator()
    engine = CascadedInterpretationEngine(
        transcriber=SuspendedStableTailTranscriber(),
        translator=translator,
        correction_engine=NoopCorrectionEngine(),
        transcript_assembler=PassThroughAssembler(),
    )

    events = [event async for event in engine.stream(_frames())]
    translated = [
        event
        for event in events
        if isinstance(event, TranslationSegment) and event.target_text
    ]
    commits = [event for event in events if isinstance(event, SegmentCommit)]

    assert [segment.text for segment in translator.seen_segments] == [
        "We need to talk about the model."
    ]
    assert any(
        event.source_text == "We need to talk about the"
        and event.target_text == ""
        and event.status == SegmentStatus.STABLE
        for event in events
        if isinstance(event, TranslationSegment)
    )
    assert [event.target_text for event in translated] == [
        "[zh] We need to talk about the model."
    ]
    assert commits[0].target_text == "[zh] We need to talk about the model."
    assert commits[0].metrics["simul_policy_request_action"] == 2.0


class DeltaTranscriber(Transcriber):
    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        async for frame in frames:
            deltas = ["Hello", ",", " world", "."]
            for index, text in enumerate(deltas):
                yield TranscriptSegment(
                    session_id=frame.session_id,
                    segment_id=f"seg_delta_{index}",
                    rev=1,
                    start_ms=index * 600,
                    end_ms=(index + 1) * 600,
                    source_lang="en",
                    text=text,
                    status=SegmentStatus.PARTIAL,
                    stability=0.72,
                    metrics={"asr_latency_ms": 10.0},
                )


class TwoSentenceTranscriber(Transcriber):
    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        async for frame in frames:
            for index, text in enumerate(("First.", "Second.")):
                yield TranscriptSegment(
                    session_id=frame.session_id,
                    segment_id=f"seg_sentence_{index}",
                    rev=1,
                    start_ms=index * 1200,
                    end_ms=(index + 1) * 1200,
                    source_lang="en",
                    text=text,
                    status=SegmentStatus.COMMITTED,
                    stability=1.0,
                )


class FastRevisionTranscriber(Transcriber):
    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        async for frame in frames:
            deltas = ["First", " revision", " final", "."]
            for index, text in enumerate(deltas):
                yield TranscriptSegment(
                    session_id=frame.session_id,
                    segment_id=f"seg_revision_{index}",
                    rev=1,
                    start_ms=index * 600,
                    end_ms=(index + 1) * 600,
                    source_lang="en",
                    text=text,
                    status=SegmentStatus.PARTIAL,
                    stability=0.72,
                )


class WeakBoundaryTranscriber(Transcriber):
    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        async for frame in frames:
            for index, text in enumerate(("The model", " starts,", " then finishes.")):
                yield TranscriptSegment(
                    session_id=frame.session_id,
                    segment_id=f"seg_weak_{index}",
                    rev=1,
                    start_ms=index * 600,
                    end_ms=(index + 1) * 600,
                    source_lang="en",
                    text=text,
                    status=SegmentStatus.PARTIAL,
                    stability=0.72,
                    metrics={"asr_latency_ms": 10.0},
                )


class LongPartialBeforeStableTranscriber(Transcriber):
    def __init__(self, first_translated: asyncio.Event) -> None:
        self.first_translated = first_translated

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        async for frame in frames:
            yield TranscriptSegment(
                session_id=frame.session_id,
                segment_id="seg_early_partial_raw",
                rev=1,
                start_ms=0,
                end_ms=640,
                source_lang="zh",
                text="今天我们来讲实时翻译",
                status=SegmentStatus.PARTIAL,
                stability=0.72,
            )
            with suppress(TimeoutError):
                await asyncio.wait_for(self.first_translated.wait(), timeout=0.05)
            yield TranscriptSegment(
                session_id=frame.session_id,
                segment_id="seg_early_partial_raw",
                rev=2,
                start_ms=640,
                end_ms=960,
                source_lang="zh",
                text="。",
                status=SegmentStatus.PARTIAL,
                stability=1.0,
            )


class SuspendedStableTailTranscriber(Transcriber):
    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        async for frame in frames:
            yield TranscriptSegment(
                session_id=frame.session_id,
                segment_id="seg_suspended_tail",
                rev=1,
                start_ms=0,
                end_ms=1_200,
                source_lang="en",
                text="We need to talk about the",
                status=SegmentStatus.STABLE,
                stability=0.9,
            )
            yield TranscriptSegment(
                session_id=frame.session_id,
                segment_id="seg_suspended_tail",
                rev=2,
                start_ms=0,
                end_ms=1_800,
                source_lang="en",
                text="We need to talk about the model.",
                status=SegmentStatus.COMMITTED,
                stability=1.0,
            )


class BurstStableTranscriber(Transcriber):
    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        async for frame in frames:
            for index, (text, status) in enumerate(
                (
                    ("first stable", SegmentStatus.STABLE),
                    ("second stable", SegmentStatus.STABLE),
                    ("third committed", SegmentStatus.COMMITTED),
                )
            ):
                yield TranscriptSegment(
                    session_id=frame.session_id,
                    segment_id="seg_burst",
                    rev=index + 1,
                    start_ms=0,
                    end_ms=(index + 1) * 600,
                    source_lang="en",
                    text=text,
                    status=status,
                    stability=0.9 if status == SegmentStatus.STABLE else 1.0,
                )


class BackloggedStableCommittedTranscriber(Transcriber):
    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        async for frame in frames:
            for index, (segment_id, text, status) in enumerate(
                (
                    ("seg_blocking", "blocking segment.", SegmentStatus.COMMITTED),
                    ("seg_backlog", "latest stable", SegmentStatus.STABLE),
                    ("seg_backlog", "latest committed.", SegmentStatus.COMMITTED),
                )
            ):
                yield TranscriptSegment(
                    session_id=frame.session_id,
                    segment_id=segment_id,
                    rev=index + 1,
                    start_ms=index * 600,
                    end_ms=(index + 1) * 600,
                    source_lang="en",
                    text=text,
                    status=status,
                    stability=0.9 if status == SegmentStatus.STABLE else 1.0,
                )


class ActiveStableThenCommittedTranscriber(Transcriber):
    def __init__(self, stable_translation_started: asyncio.Event) -> None:
        self.stable_translation_started = stable_translation_started

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        async for frame in frames:
            yield TranscriptSegment(
                session_id=frame.session_id,
                segment_id="seg_preempt",
                rev=1,
                start_ms=0,
                end_ms=1_200,
                source_lang="en",
                text="draft that will be superseded",
                status=SegmentStatus.STABLE,
                stability=0.9,
            )
            await self.stable_translation_started.wait()
            yield TranscriptSegment(
                session_id=frame.session_id,
                segment_id="seg_preempt",
                rev=2,
                start_ms=0,
                end_ms=1_600,
                source_lang="en",
                text="final text.",
                status=SegmentStatus.COMMITTED,
                stability=1.0,
            )


class BackloggedDraftsThenCommittedTranscriber(Transcriber):
    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        async for frame in frames:
            for index, (segment_id, text, status) in enumerate(
                (
                    ("seg_blocking", "blocking segment.", SegmentStatus.COMMITTED),
                    ("seg_stale_draft", "stale stable draft", SegmentStatus.STABLE),
                    ("seg_other_draft", "another stable draft", SegmentStatus.STABLE),
                    ("seg_current", "current committed.", SegmentStatus.COMMITTED),
                )
            ):
                yield TranscriptSegment(
                    session_id=frame.session_id,
                    segment_id=segment_id,
                    rev=index + 1,
                    start_ms=index * 600,
                    end_ms=(index + 1) * 600,
                    source_lang="en",
                    text=text,
                    status=status,
                    stability=0.9 if status == SegmentStatus.STABLE else 1.0,
                )


class BackloggedStableRefreshOnlyTranscriber(Transcriber):
    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        async for frame in frames:
            for index, (segment_id, text) in enumerate(
                (
                    ("seg_blocking", "blocking segment."),
                    ("seg_refresh", "stale stable draft"),
                    ("seg_refresh", "newer stable draft with enough content."),
                )
            ):
                status = (
                    SegmentStatus.COMMITTED
                    if segment_id == "seg_blocking"
                    else SegmentStatus.STABLE
                )
                yield TranscriptSegment(
                    session_id=frame.session_id,
                    segment_id=segment_id,
                    rev=index + 1,
                    start_ms=index * 1_200,
                    end_ms=(index + 1) * 1_200,
                    source_lang="en",
                    text=text,
                    status=status,
                    stability=1.0 if segment_id == "seg_blocking" else 0.9,
                )
                if segment_id == "seg_refresh" and text == "stale stable draft":
                    await asyncio.sleep(0)


class ImmediateCommittedTranscriber(Transcriber):
    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        async for frame in frames:
            yield TranscriptSegment(
                session_id=frame.session_id,
                segment_id="seg_immediate_commit",
                rev=1,
                start_ms=0,
                end_ms=1_000,
                source_lang="en",
                text="Immediate commit.",
                status=SegmentStatus.COMMITTED,
                stability=1.0,
            )


class RefreshingStableTranscriber(Transcriber):
    def __init__(self, first_translated: asyncio.Event, second_translated: asyncio.Event) -> None:
        self.first_translated = first_translated
        self.second_translated = second_translated

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        async for _frame in frames:
            yield TranscriptSegment(
                session_id="sess_refreshing_stable",
                segment_id="seg_refreshing_stable",
                rev=1,
                start_ms=0,
                end_ms=1_000,
                source_lang="en",
                text="The model starts,",
                status=SegmentStatus.STABLE,
                stability=0.9,
            )
            await self.first_translated.wait()
            yield TranscriptSegment(
                session_id="sess_refreshing_stable",
                segment_id="seg_refreshing_stable",
                rev=2,
                start_ms=0,
                end_ms=2_400,
                source_lang="en",
                text="The model starts, then explains the pipeline",
                status=SegmentStatus.STABLE,
                stability=0.9,
            )
            with suppress(TimeoutError):
                await asyncio.wait_for(self.second_translated.wait(), timeout=0.05)
            yield TranscriptSegment(
                session_id="sess_refreshing_stable",
                segment_id="seg_refreshing_stable",
                rev=3,
                start_ms=0,
                end_ms=3_200,
                source_lang="en",
                text="The model starts, then explains the pipeline.",
                status=SegmentStatus.COMMITTED,
                stability=1.0,
            )
            return


class PassThroughAssembler:
    async def stream(
        self,
        segments: AsyncIterator[TranscriptSegment],
    ) -> AsyncIterator[TranscriptSegment]:
        async for segment in segments:
            yield segment


class RecordingTranslator(Translator):
    def __init__(self) -> None:
        self.seen_segments: list[TranscriptSegment] = []

    async def translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> TranslationSegment:
        self.seen_segments.append(segment)
        return TranslationSegment(
            session_id=segment.session_id,
            segment_id=segment.segment_id,
            rev=segment.rev,
            source_rev=segment.rev,
            start_ms=segment.start_ms,
            end_ms=segment.end_ms,
            source_lang=segment.source_lang,
            target_lang="zh-CN",
            source_text=segment.text,
            target_text=f"[zh] {segment.text}",
            status=segment.status,
            stability=segment.stability,
            metrics=dict(segment.metrics),
        )


class BatchOnlyTranslator:
    def __init__(self) -> None:
        self.seen_segments: list[TranscriptSegment] = []

    async def translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> TranslationSegment:
        self.seen_segments.append(segment)
        return TranslationSegment(
            session_id=segment.session_id,
            segment_id=segment.segment_id,
            rev=segment.rev,
            source_rev=segment.rev,
            start_ms=segment.start_ms,
            end_ms=segment.end_ms,
            source_lang=segment.source_lang,
            target_lang="zh-CN",
            source_text=segment.text,
            target_text=f"[batch] {segment.text}",
            status=segment.status,
            stability=segment.stability,
            metrics=dict(segment.metrics),
        )


class StreamingTranslator(RecordingTranslator):
    async def stream_translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> AsyncIterator[TranslationSegment]:
        self.seen_segments.append(segment)
        for target_text in ("[zh]", f"[zh] {segment.text}"):
            yield TranslationSegment(
                session_id=segment.session_id,
                segment_id=segment.segment_id,
                rev=segment.rev,
                source_rev=segment.rev,
                start_ms=segment.start_ms,
                end_ms=segment.end_ms,
                source_lang=segment.source_lang,
                target_lang="zh-CN",
                source_text=segment.text,
                target_text=target_text,
                status=segment.status,
                stability=segment.stability,
                metrics=dict(segment.metrics),
            )


class SignalingTranslator(RecordingTranslator):
    def __init__(self, first_translated: asyncio.Event, second_translated: asyncio.Event) -> None:
        super().__init__()
        self.first_translated = first_translated
        self.second_translated = second_translated

    async def translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> TranslationSegment:
        result = await super().translate(segment, context)
        if len(self.seen_segments) == 1:
            self.first_translated.set()
        elif len(self.seen_segments) == 2:
            self.second_translated.set()
        return result


class ContextRecordingSignalingTranslator(SignalingTranslator):
    def __init__(self, first_translated: asyncio.Event, second_translated: asyncio.Event) -> None:
        super().__init__(first_translated, second_translated)
        self.contexts: list[CorrectionContext] = []

    async def translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> TranslationSegment:
        self.contexts.append(context)
        return await super().translate(segment, context)


class SlowStreamingTranslator(RecordingTranslator):
    async def stream_translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> AsyncIterator[TranslationSegment]:
        self.seen_segments.append(segment)
        await asyncio.sleep(0.01)
        yield TranslationSegment(
            session_id=segment.session_id,
            segment_id=segment.segment_id,
            rev=segment.rev,
            source_rev=segment.rev,
            start_ms=segment.start_ms,
            end_ms=segment.end_ms,
            source_lang=segment.source_lang,
            target_lang="zh-CN",
            source_text=segment.text,
            target_text=f"[zh] {segment.text}",
            status=segment.status,
            stability=segment.stability,
            metrics=dict(segment.metrics),
        )


class BlockingTranslator(RecordingTranslator):
    def __init__(self) -> None:
        super().__init__()
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> TranslationSegment:
        self.seen_segments.append(segment)
        if len(self.seen_segments) == 1:
            self.started.set()
            await self.release.wait()
        return TranslationSegment(
            session_id=segment.session_id,
            segment_id=segment.segment_id,
            rev=segment.rev,
            source_rev=segment.rev,
            start_ms=segment.start_ms,
            end_ms=segment.end_ms,
            source_lang=segment.source_lang,
            target_lang="zh-CN",
            source_text=segment.text,
            target_text=f"[zh] {segment.text}",
            status=segment.status,
            stability=segment.stability,
            metrics=dict(segment.metrics),
        )


class NoopCorrectionEngine(CorrectionEngine):
    async def revise(
        self,
        segment: TranslationSegment,
        context: CorrectionContext,
    ):
        return None


class SlowCorrectionEngine(CorrectionEngine):
    async def revise(
        self,
        segment: TranslationSegment,
        context: CorrectionContext,
    ):
        await asyncio.sleep(0.05)
        return SubtitlePatch(
            session_id=segment.session_id,
            segment_id=segment.segment_id,
            rev=segment.rev + 1,
            base_rev=segment.rev,
            target_lang=segment.target_lang,
            operations=(),
            reason="revision_window",
            stability=segment.stability,
        )


async def _frames() -> AsyncIterator[AudioFrame]:
    yield AudioFrame(
        session_id="sess_latency",
        seq=1,
        pcm=b"ignored",
        sample_rate=16_000,
        channels=1,
        start_ms=0,
        end_ms=2400,
        source_lang="en",
    )


async def _collect_events(items: AsyncIterator[object]) -> list[object]:
    return [item async for item in items]
