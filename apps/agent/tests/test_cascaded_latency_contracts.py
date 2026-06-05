from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from echosync_agent.domain import (
    AudioFrame,
    CorrectionContext,
    SegmentCommit,
    SegmentStatus,
    TranscriptSegment,
    TranslationSegment,
)
from echosync_agent.interfaces import CorrectionEngine, Transcriber, Translator
from echosync_agent.services.engine.cascaded_engine import CascadedInterpretationEngine


def test_cascaded_engine_translates_assembled_segments_and_records_latency_metrics() -> None:
    asyncio.run(_assert_engine_translates_segments_and_records_latency_metrics())


def test_cascaded_engine_streams_source_hypotheses_and_translation_deltas() -> None:
    asyncio.run(_assert_cascaded_engine_streams_source_hypotheses_and_translation_deltas())


def test_cascaded_engine_does_not_block_source_hypotheses_on_slow_translation() -> None:
    asyncio.run(_assert_cascaded_engine_does_not_block_source_hypotheses_on_slow_translation())


def test_cascaded_engine_skips_stale_checkpoints_when_newer_revision_is_queued() -> None:
    asyncio.run(_assert_cascaded_engine_skips_stale_checkpoints_when_newer_revision_is_queued())


def test_cascaded_engine_coalesces_pending_translation_checkpoints() -> None:
    asyncio.run(_assert_cascaded_engine_coalesces_pending_translation_checkpoints())


def test_cascaded_engine_accepts_batch_only_translator() -> None:
    asyncio.run(_assert_cascaded_engine_accepts_batch_only_translator())


async def _assert_engine_translates_segments_and_records_latency_metrics() -> None:
    translator = RecordingTranslator()
    engine = CascadedInterpretationEngine(
        transcriber=DeltaTranscriber(),
        translator=translator,
        correction_engine=NoopCorrectionEngine(),
    )

    events = [event async for event in engine.stream(_frames())]
    translations = [event for event in events if isinstance(event, TranslationSegment)]

    assert [segment.text for segment in translator.seen_segments] == ["Hello, world."]
    translated = [segment for segment in translations if segment.target_text]
    assert len(translated) == 1
    assert translated[-1].source_text == "Hello, world."
    assert translated[-1].metrics["merge_wait_ms"] >= 0
    assert translated[-1].metrics["translation_latency_ms"] >= 0


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

    assert [(item.source_text, item.target_text, item.status) for item in translations] == [
        ("Hello", "", SegmentStatus.PARTIAL),
        ("Hello,", "", SegmentStatus.STABLE),
        ("Hello, world", "", SegmentStatus.PARTIAL),
        ("Hello, world.", "", SegmentStatus.COMMITTED),
        ("Hello, world.", "[zh]", SegmentStatus.COMMITTED),
        ("Hello, world.", "[zh] Hello, world.", SegmentStatus.COMMITTED),
    ]
    assert len({item.segment_id for item in translations}) == 1
    assert [item.text for item in translator.seen_segments] == ["Hello, world."]
    assert len(commits) == 1
    assert commits[0].source_text == "Hello, world."
    assert commits[0].target_text == "[zh] Hello, world."


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

    assert [segment.text for segment in translator.seen_segments] == ["First revision final."]
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

    assert [segment.text for segment in translator.seen_segments] == ["third committed"]
    assert any(event.target_text == "[zh] third committed" for event in translations)


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
