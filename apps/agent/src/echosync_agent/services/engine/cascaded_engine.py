from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from collections.abc import AsyncIterator
from contextlib import suppress
from dataclasses import dataclass, replace

from echosync_agent.domain import (
    AudioFrame,
    CorrectionContext,
    InterpretationEvent,
    ModelCapability,
    ModelMode,
    ModelProfile,
    SegmentCommit,
    SegmentStatus,
    SubtitlePatch,
    TranscriptSegment,
    TranslationSegment,
)
from echosync_agent.interfaces import (
    CorrectionEngine,
    InterpretationEngine,
    Transcriber,
    Translator,
)
from echosync_agent.services.asr.transcript_assembler import TranscriptAssembler
from echosync_agent.services.realtime.text_regions import split_realtime_text
from echosync_agent.services.translation.simul_policy import (
    SimulPolicyAction,
    SimulPolicyDecision,
    SimulTranslationPolicy,
    simul_action_code,
)
from echosync_agent.services.translation.terminology import Glossary, MatchedTerm

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class _QueuedCheckpoint:
    transcript: TranscriptSegment
    queued_at: float
    simul_decision: SimulPolicyDecision


class CascadedInterpretationEngine(InterpretationEngine):
    """把 ASR、翻译和修正组件组合成统一听译引擎。"""

    def __init__(
        self,
        transcriber: Transcriber,
        translator: Translator,
        correction_engine: CorrectionEngine,
        transcript_assembler: TranscriptAssembler | None = None,
        target_lang: str = "zh-CN",
        revision_window_segments: int = 2,
        glossary: Glossary | dict[str, str] | None = None,
        stable_refresh_min_audio_ms: int = 1_000,
        stable_refresh_min_chars: int = 12,
        partial_translation_min_audio_ms: int = 600,
        partial_translation_min_chars: int = 8,
        translate_partial_checkpoints: bool = False,
        simul_policy: SimulTranslationPolicy | None = None,
        correction_timeout_ms: int = 120,
    ) -> None:
        self.transcriber = transcriber
        self.translator = translator
        self.correction_engine = correction_engine
        self.transcript_assembler = transcript_assembler or TranscriptAssembler()
        self.target_lang = target_lang
        self.revision_window_segments = revision_window_segments
        self.stable_refresh_min_audio_ms = stable_refresh_min_audio_ms
        self.stable_refresh_min_chars = stable_refresh_min_chars
        self.partial_translation_min_audio_ms = partial_translation_min_audio_ms
        self.partial_translation_min_chars = partial_translation_min_chars
        self.translate_partial_checkpoints = translate_partial_checkpoints
        self.simul_policy = simul_policy or SimulTranslationPolicy()
        self.correction_timeout_ms = correction_timeout_ms
        # 统一转为 Glossary 对象
        if isinstance(glossary, dict):
            self._glossary = Glossary.from_dict(glossary)
        elif glossary is None:
            self._glossary = Glossary()
        else:
            self._glossary = glossary
        self._history: deque[TranslationSegment] = deque(maxlen=revision_window_segments + 4)
        self._segment_revisions: dict[str, deque[TranslationSegment]] = {}

    @property
    def profile(self) -> ModelProfile:
        return ModelProfile(
            provider="echosync",
            model="cascaded-asr-translation-correction",
            mode=ModelMode.CASCADED,
            capabilities=(
                ModelCapability.ASR,
                ModelCapability.TRANSLATION,
                ModelCapability.CORRECTION,
            ),
            target_lang=self.target_lang,
        )

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[InterpretationEvent]:
        event_queue: asyncio.Queue[InterpretationEvent | BaseException | object] = asyncio.Queue()
        done = object()
        pending_checkpoints: dict[tuple[str, SegmentStatus], _QueuedCheckpoint] = {}
        pending_order: deque[tuple[str, SegmentStatus]] = deque()
        stable_checkpoint_history: dict[str, TranscriptSegment] = {}
        partial_checkpoint_history: dict[str, TranscriptSegment] = {}
        checkpoint_available = asyncio.Event()
        producer_done = False
        assembled_transcripts = self.transcript_assembler.stream(self.transcriber.stream(frames))

        async def produce_transcripts() -> None:
            nonlocal producer_done
            try:
                async for transcript in assembled_transcripts:
                    await event_queue.put(self._source_only_translation(transcript))
                    if transcript.status == SegmentStatus.PARTIAL:
                        if not self.translate_partial_checkpoints:
                            if self._is_partial_checkpoint_candidate(transcript):
                                logger.info(
                                    "translation_checkpoint_skipped session_id=%s "
                                    "segment_id=%s rev=%d status=%s reason=partial_disabled "
                                    "audio_start_ms=%d audio_end_ms=%d source_chars=%d",
                                    transcript.session_id,
                                    transcript.segment_id,
                                    transcript.rev,
                                    transcript.status,
                                    transcript.start_ms,
                                    transcript.end_ms,
                                    len(transcript.text),
                                )
                            continue
                        if not self._should_queue_partial_checkpoint(
                            transcript,
                            partial_checkpoint_history,
                            stable_checkpoint_history,
                        ):
                            continue
                        simul_decision = self._translation_policy_decision(transcript)
                        if self._should_wait_translation(transcript, simul_decision):
                            continue
                        partial_checkpoint_history[transcript.segment_id] = transcript
                        checkpoint_key = self._checkpoint_key(transcript)
                        self._queue_translation_checkpoint(
                            pending_checkpoints,
                            pending_order,
                            checkpoint_key,
                            transcript,
                            simul_decision,
                        )
                        checkpoint_available.set()
                        await asyncio.sleep(0)
                        continue

                    checkpoint_key = self._checkpoint_key(transcript)
                    partial_checkpoint_history.pop(transcript.segment_id, None)
                    self._drop_pending_checkpoint(
                        pending_checkpoints,
                        pending_order,
                        (transcript.segment_id, SegmentStatus.PARTIAL),
                    )

                    if transcript.status == SegmentStatus.STABLE:
                        if not self._should_queue_stable_checkpoint(
                            transcript,
                            stable_checkpoint_history,
                        ):
                            continue
                        simul_decision = self._translation_policy_decision(transcript)
                        if self._should_wait_translation(transcript, simul_decision):
                            continue
                        stable_checkpoint_history[transcript.segment_id] = transcript
                    else:
                        stable_checkpoint_history.pop(transcript.segment_id, None)
                        simul_decision = self._translation_policy_decision(transcript)

                    self._queue_translation_checkpoint(
                        pending_checkpoints,
                        pending_order,
                        checkpoint_key,
                        transcript,
                        simul_decision,
                    )
                    checkpoint_available.set()
                    await asyncio.sleep(0)
            except BaseException as exc:
                await event_queue.put(exc)
            finally:
                producer_done = True
                checkpoint_available.set()

        async def translate_checkpoints() -> None:
            active_task: asyncio.Task[None] | None = None
            active_checkpoint: _QueuedCheckpoint | None = None

            async def run_checkpoint(queued: _QueuedCheckpoint) -> None:
                queue_wait_ms = max((time.perf_counter() - queued.queued_at) * 1000, 0.0)
                item = _with_metric(
                    _with_simul_policy_decision(
                        queued.transcript,
                        queued.simul_decision,
                    ),
                    "translation_queue_wait_ms",
                    queue_wait_ms,
                )
                async for event in self._translate_checkpoint(
                    item,
                    queued.simul_decision,
                ):
                    await event_queue.put(event)

            try:
                while True:
                    if active_task is None:
                        checkpoint_key, queued = self._pop_next_checkpoint(
                            pending_checkpoints,
                            pending_order,
                        )
                        if queued is not None:
                            active_checkpoint = queued
                            active_task = asyncio.create_task(run_checkpoint(queued))
                        elif producer_done:
                            break
                        else:
                            await checkpoint_available.wait()
                            checkpoint_available.clear()
                            continue

                    assert active_task is not None
                    wait_for_checkpoint = asyncio.create_task(checkpoint_available.wait())
                    done_tasks, _pending_tasks = await asyncio.wait(
                        {active_task, wait_for_checkpoint},
                        return_when=asyncio.FIRST_COMPLETED,
                    )

                    if wait_for_checkpoint in done_tasks:
                        checkpoint_available.clear()
                        if (
                            active_checkpoint is not None
                            and active_task not in done_tasks
                            and active_checkpoint.transcript.status != SegmentStatus.COMMITTED
                        ):
                            committed = self._pending_committed_checkpoint_for_segment(
                                pending_checkpoints,
                                active_checkpoint.transcript.segment_id,
                            )
                            if committed is not None:
                                active_task.cancel()
                                with suppress(asyncio.CancelledError):
                                    await active_task
                                self._log_dropped_checkpoint(
                                    active_checkpoint,
                                    reason="preempted_by_committed",
                                    pending_checkpoints=len(pending_checkpoints),
                                    committed_transcript=committed.transcript,
                                )
                                active_task = None
                                active_checkpoint = None
                                wait_for_checkpoint = None
                                continue

                    if active_task in done_tasks:
                        try:
                            exc = active_task.exception()
                        except asyncio.CancelledError as cancel_exc:
                            exc = cancel_exc
                        active_task = None
                        active_checkpoint = None
                        if exc is not None:
                            raise exc

                    if wait_for_checkpoint not in done_tasks:
                        wait_for_checkpoint.cancel()
                        await asyncio.gather(wait_for_checkpoint, return_exceptions=True)

                    if producer_done and active_task is None and not pending_order:
                        break
            except BaseException as exc:
                await event_queue.put(exc)
            finally:
                if active_task is not None and not active_task.done():
                    active_task.cancel()
                    await asyncio.gather(active_task, return_exceptions=True)
                await event_queue.put(done)

        producer_task = asyncio.create_task(produce_transcripts())
        translator_task = asyncio.create_task(translate_checkpoints())

        try:
            while True:
                event = await event_queue.get()
                if event is done:
                    break
                if isinstance(event, BaseException):
                    raise event
                yield event
        finally:
            for task in (producer_task, translator_task):
                if not task.done():
                    task.cancel()
            await asyncio.gather(producer_task, translator_task, return_exceptions=True)

    async def _translate_checkpoint(
        self,
        transcript: TranscriptSegment,
        request_decision: SimulPolicyDecision,
    ) -> AsyncIterator[InterpretationEvent]:
        context = self._context(transcript.text, transcript.segment_id)
        translation_started_at = time.perf_counter()
        translation_first_token_ms: float | None = None
        translation_delta_count = 0
        final_translation: TranslationSegment | None = None
        final_decision: SimulPolicyDecision | None = None
        logger.info(
            "translation_checkpoint_started session_id=%s segment_id=%s rev=%d "
            "status=%s audio_start_ms=%d audio_end_ms=%d source_chars=%d "
            "asr_latency_ms=%.1f merge_wait_ms=%.1f translation_queue_wait_ms=%.1f "
            "glossary_terms=%d "
            "simul_action=%s simul_reason=%s simul_confidence=%.2f",
            transcript.session_id,
            transcript.segment_id,
            transcript.rev,
            transcript.status,
            transcript.start_ms,
            transcript.end_ms,
            len(transcript.text),
            _metric_value(transcript.metrics, "asr_latency_ms"),
            _metric_value(transcript.metrics, "merge_wait_ms"),
            _metric_value(transcript.metrics, "translation_queue_wait_ms"),
            len(context.glossary),
            request_decision.action,
            request_decision.reason,
            request_decision.confidence,
        )
        async for translation in self._stream_translation(transcript, context):
            translation_latency_ms = (time.perf_counter() - translation_started_at) * 1000
            translation_delta_count += 1
            translation_decision = self.simul_policy.classify_translation(
                translation,
                previous_revision=self._latest_segment_revision(translation.segment_id),
            )
            if translation_first_token_ms is None:
                translation_first_token_ms = translation_latency_ms
                logger.info(
                    "translation_checkpoint_first_token session_id=%s segment_id=%s "
                    "rev=%d status=%s first_token_ms=%.1f target_chars=%d "
                    "simul_action=%s simul_reason=%s",
                    translation.session_id,
                    translation.segment_id,
                    translation.rev,
                    translation.status,
                    translation_first_token_ms,
                    len(translation.target_text),
                    translation_decision.action,
                    translation_decision.reason,
                )
            translation = replace(
                translation,
                metrics={
                    **transcript.metrics,
                    **translation.metrics,
                    **_simul_policy_metrics(translation_decision),
                    "simul_policy_request_action": simul_action_code(
                        request_decision.action
                    ),
                    "translation_latency_ms": translation_latency_ms,
                    "translation_first_token_ms": translation_first_token_ms,
                    "translation_delta_count": float(translation_delta_count),
                },
            )
            translation = self._with_text_regions(translation)
            final_translation = translation
            final_decision = translation_decision
            yield translation

        if final_translation is None:
            return

        translation_final_ms = (time.perf_counter() - translation_started_at) * 1000
        final_translation = replace(
            final_translation,
            metrics={
                **final_translation.metrics,
                "translation_final_ms": translation_final_ms,
                "translation_delta_count": float(translation_delta_count),
                "translation_first_token_ms": (
                    translation_first_token_ms
                    if translation_first_token_ms is not None
                    else translation_final_ms
                ),
            },
        )
        logger.info(
            "translation_checkpoint_finished session_id=%s segment_id=%s rev=%d "
            "status=%s final_ms=%.1f first_token_ms=%.1f delta_count=%d "
            "source_chars=%d target_chars=%d simul_action=%s simul_reason=%s",
            final_translation.session_id,
            final_translation.segment_id,
            final_translation.rev,
            final_translation.status,
            translation_final_ms,
            final_translation.metrics["translation_first_token_ms"],
            translation_delta_count,
            len(final_translation.source_text),
            len(final_translation.target_text),
            final_decision.action if final_decision else request_decision.action,
            final_decision.reason if final_decision else request_decision.reason,
        )

        if final_translation.status == SegmentStatus.PARTIAL:
            return

        patch = await self._revise_with_timeout(final_translation, context)
        if patch is not None:
            yield patch

        if final_translation.status != SegmentStatus.PARTIAL:
            self._remember_segment_revision(final_translation)

        if final_translation.status == SegmentStatus.COMMITTED:
            self._history.append(final_translation)

        if transcript.status == SegmentStatus.COMMITTED:
            yield SegmentCommit(
                session_id=final_translation.session_id,
                segment_id=final_translation.segment_id,
                rev=final_translation.rev,
                start_ms=final_translation.start_ms,
                end_ms=final_translation.end_ms,
                source_lang=final_translation.source_lang,
                target_lang=final_translation.target_lang,
                source_text=final_translation.source_text,
                target_text=final_translation.target_text,
                speaker=final_translation.speaker,
                source_stable_text=final_translation.source_stable_text,
                source_unstable_text=final_translation.source_unstable_text,
                target_stable_text=final_translation.target_stable_text,
                target_unstable_text=final_translation.target_unstable_text,
                metrics=dict(final_translation.metrics),
            )

    async def _revise_with_timeout(
        self,
        translation: TranslationSegment,
        context: CorrectionContext,
    ) -> SubtitlePatch | None:
        if self.correction_timeout_ms <= 0:
            return await self.correction_engine.revise(translation, context)
        try:
            return await asyncio.wait_for(
                self.correction_engine.revise(translation, context),
                timeout=self.correction_timeout_ms / 1000,
            )
        except TimeoutError:
            logger.info(
                "translation_revision_timeout session_id=%s segment_id=%s "
                "rev=%d timeout_ms=%d",
                translation.session_id,
                translation.segment_id,
                translation.rev,
                self.correction_timeout_ms,
            )
            return None

    @staticmethod
    def _checkpoint_key(transcript: TranscriptSegment) -> tuple[str, SegmentStatus]:
        if transcript.status == SegmentStatus.PARTIAL:
            return (transcript.segment_id, SegmentStatus.PARTIAL)
        if transcript.status == SegmentStatus.STABLE:
            return (transcript.segment_id, SegmentStatus.STABLE)
        return (transcript.segment_id, SegmentStatus.COMMITTED)

    def _should_queue_partial_checkpoint(
        self,
        transcript: TranscriptSegment,
        partial_history: dict[str, TranscriptSegment],
        stable_history: dict[str, TranscriptSegment],
    ) -> bool:
        if transcript.segment_id in stable_history:
            return False

        text = transcript.text.strip()
        if _visible_char_count(text) < self.partial_translation_min_chars:
            return False

        audio_duration_ms = transcript.end_ms - transcript.start_ms
        if audio_duration_ms < self.partial_translation_min_audio_ms:
            return False

        previous = partial_history.get(transcript.segment_id)
        if previous is None:
            return True

        previous_text = previous.text.strip()
        if text == previous_text:
            return False

        audio_gap_ms = transcript.end_ms - previous.end_ms
        if not text.startswith(previous.text):
            return audio_gap_ms >= self.partial_translation_min_audio_ms

        delta_chars = _visible_char_count(text[len(previous.text) :])
        if delta_chars < self.partial_translation_min_chars:
            return False
        return audio_gap_ms >= self.partial_translation_min_audio_ms

    def _is_partial_checkpoint_candidate(self, transcript: TranscriptSegment) -> bool:
        text = transcript.text.strip()
        if _visible_char_count(text) < self.partial_translation_min_chars:
            return False
        return transcript.end_ms - transcript.start_ms >= self.partial_translation_min_audio_ms

    def _translation_policy_decision(
        self,
        transcript: TranscriptSegment,
    ) -> SimulPolicyDecision:
        return self.simul_policy.should_translate(
            transcript,
            previous_revision=self._latest_segment_revision(transcript.segment_id),
        )

    def _should_wait_translation(
        self,
        transcript: TranscriptSegment,
        decision: SimulPolicyDecision,
    ) -> bool:
        if decision.action != SimulPolicyAction.WAIT:
            return False
        logger.info(
            "translation_checkpoint_skipped session_id=%s segment_id=%s rev=%d "
            "status=%s reason=simul_wait simul_reason=%s simul_confidence=%.2f "
            "audio_start_ms=%d audio_end_ms=%d source_chars=%d",
            transcript.session_id,
            transcript.segment_id,
            transcript.rev,
            transcript.status,
            decision.reason,
            decision.confidence,
            transcript.start_ms,
            transcript.end_ms,
            len(transcript.text),
        )
        return True

    @staticmethod
    def _queue_translation_checkpoint(
        pending_checkpoints: dict[tuple[str, SegmentStatus], _QueuedCheckpoint],
        pending_order: deque[tuple[str, SegmentStatus]],
        checkpoint_key: tuple[str, SegmentStatus],
        transcript: TranscriptSegment,
        simul_decision: SimulPolicyDecision,
    ) -> None:
        if transcript.status == SegmentStatus.COMMITTED:
            CascadedInterpretationEngine._drop_pending_checkpoint(
                pending_checkpoints,
                pending_order,
                (transcript.segment_id, SegmentStatus.STABLE),
            )
            CascadedInterpretationEngine._drop_pending_checkpoint(
                pending_checkpoints,
                pending_order,
                (transcript.segment_id, SegmentStatus.PARTIAL),
            )
            CascadedInterpretationEngine._drop_pending_draft_checkpoints_before_committed(
                pending_checkpoints,
                pending_order,
                transcript,
            )
        elif transcript.status == SegmentStatus.STABLE:
            CascadedInterpretationEngine._drop_pending_checkpoint(
                pending_checkpoints,
                pending_order,
                (transcript.segment_id, SegmentStatus.PARTIAL),
            )

        if checkpoint_key not in pending_checkpoints:
            pending_order.append(checkpoint_key)

        pending_checkpoints[checkpoint_key] = _QueuedCheckpoint(
            transcript=transcript,
            queued_at=time.perf_counter(),
            simul_decision=simul_decision,
        )
        logger.info(
            "translation_checkpoint_queued session_id=%s segment_id=%s "
            "rev=%d status=%s audio_start_ms=%d audio_end_ms=%d "
            "source_chars=%d pending_checkpoints=%d simul_action=%s "
            "simul_reason=%s simul_confidence=%.2f",
            transcript.session_id,
            transcript.segment_id,
            transcript.rev,
            transcript.status,
            transcript.start_ms,
            transcript.end_ms,
            len(transcript.text),
            len(pending_checkpoints),
            simul_decision.action,
            simul_decision.reason,
            simul_decision.confidence,
        )

    @staticmethod
    def _drop_pending_checkpoint(
        pending_checkpoints: dict[tuple[str, SegmentStatus], _QueuedCheckpoint],
        pending_order: deque[tuple[str, SegmentStatus]],
        checkpoint_key: tuple[str, SegmentStatus],
    ) -> None:
        pending_checkpoints.pop(checkpoint_key, None)
        with suppress(ValueError):
            pending_order.remove(checkpoint_key)

    @staticmethod
    def _drop_pending_draft_checkpoints_before_committed(
        pending_checkpoints: dict[tuple[str, SegmentStatus], _QueuedCheckpoint],
        pending_order: deque[tuple[str, SegmentStatus]],
        committed_transcript: TranscriptSegment,
    ) -> None:
        """Prefer pending committed checkpoints over stale draft work.

        Stable/partial checkpoints are speculative UI drafts. Once a committed
        segment is waiting behind a slow translation request, translating older
        drafts first increases visible lag and often creates subtitles that are
        immediately superseded. Committed checkpoints are retained because they
        feed final subtitles, archive, and export.
        """
        dropped: list[_QueuedCheckpoint] = []
        kept_order: deque[tuple[str, SegmentStatus]] = deque()
        for checkpoint_key in pending_order:
            queued = pending_checkpoints.get(checkpoint_key)
            if queued is None:
                continue
            if checkpoint_key[1] == SegmentStatus.COMMITTED:
                kept_order.append(checkpoint_key)
                continue
            dropped.append(queued)
            pending_checkpoints.pop(checkpoint_key, None)

        if not dropped:
            return

        pending_order.clear()
        pending_order.extend(kept_order)
        for queued in dropped:
            CascadedInterpretationEngine._log_dropped_checkpoint(
                queued,
                reason="committed_backlog",
                pending_checkpoints=len(pending_checkpoints),
                committed_transcript=committed_transcript,
            )

    @staticmethod
    def _has_pending_committed_checkpoint(
        pending_checkpoints: dict[tuple[str, SegmentStatus], _QueuedCheckpoint],
    ) -> bool:
        return any(key[1] == SegmentStatus.COMMITTED for key in pending_checkpoints)

    @staticmethod
    def _pending_committed_checkpoint_for_segment(
        pending_checkpoints: dict[tuple[str, SegmentStatus], _QueuedCheckpoint],
        segment_id: str,
    ) -> _QueuedCheckpoint | None:
        return pending_checkpoints.get((segment_id, SegmentStatus.COMMITTED))

    @staticmethod
    def _pop_next_checkpoint(
        pending_checkpoints: dict[tuple[str, SegmentStatus], _QueuedCheckpoint],
        pending_order: deque[tuple[str, SegmentStatus]],
    ) -> tuple[tuple[str, SegmentStatus] | None, _QueuedCheckpoint | None]:
        if not pending_order:
            return None, None

        committed_index = next(
            (
                index
                for index, checkpoint_key in enumerate(pending_order)
                if checkpoint_key[1] == SegmentStatus.COMMITTED
                and checkpoint_key in pending_checkpoints
            ),
            None,
        )
        if committed_index is None:
            checkpoint_key = pending_order.popleft()
        else:
            checkpoint_key = pending_order[committed_index]
            del pending_order[committed_index]
        return checkpoint_key, pending_checkpoints.pop(checkpoint_key, None)

    @staticmethod
    def _log_dropped_checkpoint(
        queued: _QueuedCheckpoint,
        *,
        reason: str,
        pending_checkpoints: int,
        committed_transcript: TranscriptSegment | None = None,
    ) -> None:
        draft = queued.transcript
        logger.info(
            "translation_checkpoint_dropped session_id=%s segment_id=%s "
            "rev=%d status=%s reason=%s committed_segment_id=%s committed_rev=%d "
            "pending_checkpoints=%d",
            draft.session_id,
            draft.segment_id,
            draft.rev,
            draft.status,
            reason,
            committed_transcript.segment_id if committed_transcript else "",
            committed_transcript.rev if committed_transcript else -1,
            pending_checkpoints,
        )

    def _should_queue_stable_checkpoint(
        self,
        transcript: TranscriptSegment,
        history: dict[str, TranscriptSegment],
    ) -> bool:
        previous = history.get(transcript.segment_id)
        if previous is None:
            return True
        if transcript.text.strip() == previous.text.strip():
            return False
        audio_gap_ms = transcript.end_ms - previous.end_ms
        if not transcript.text.startswith(previous.text):
            return (
                audio_gap_ms >= self.stable_refresh_min_audio_ms
                and _visible_char_count(transcript.text) >= self.stable_refresh_min_chars
            )

        delta_chars = _visible_char_count(transcript.text[len(previous.text) :])
        if delta_chars < self.stable_refresh_min_chars:
            return False
        return audio_gap_ms >= self.stable_refresh_min_audio_ms or _ends_with_weak_boundary(
            transcript.text
        )

    def _source_only_translation(self, transcript: TranscriptSegment) -> TranslationSegment:
        source_regions = split_realtime_text(
            transcript.text,
            status=transcript.status,
            language=transcript.source_lang,
        )
        return TranslationSegment(
            session_id=transcript.session_id,
            segment_id=transcript.segment_id,
            rev=transcript.rev,
            source_rev=transcript.rev,
            start_ms=transcript.start_ms,
            end_ms=transcript.end_ms,
            source_lang=transcript.source_lang,
            target_lang=self.target_lang,
            source_text=transcript.text,
            target_text="",
            status=transcript.status,
            stability=transcript.stability,
            speaker=transcript.speaker,
            metrics=dict(transcript.metrics),
            source_stable_text=source_regions.stable_text,
            source_unstable_text=source_regions.unstable_text,
        )

    async def _stream_translation(
        self,
        transcript: TranscriptSegment,
        context: CorrectionContext,
    ) -> AsyncIterator[TranslationSegment]:
        stream_translate = getattr(self.translator, "stream_translate", None)
        has_stream_translate = "stream_translate" in type(self.translator).__dict__
        if stream_translate is not None and has_stream_translate:
            async for translation in stream_translate(transcript, context):
                yield translation
            return

        yield await self.translator.translate(transcript, context)

    def _with_text_regions(self, translation: TranslationSegment) -> TranslationSegment:
        source_regions = split_realtime_text(
            translation.source_text,
            status=translation.status,
            language=translation.source_lang,
        )
        target_regions = split_realtime_text(
            translation.target_text,
            status=translation.status,
            language=translation.target_lang,
        )
        return replace(
            translation,
            source_stable_text=source_regions.stable_text,
            source_unstable_text=source_regions.unstable_text,
            target_stable_text=target_regions.stable_text,
            target_unstable_text=target_regions.unstable_text,
        )

    def _remember_segment_revision(self, translation: TranslationSegment) -> None:
        history = self._segment_revisions.setdefault(
            translation.segment_id,
            deque(maxlen=self.revision_window_segments + 1),
        )
        history.append(translation)

    def _latest_segment_revision(self, segment_id: str) -> TranslationSegment | None:
        revisions = self._segment_revisions.get(segment_id)
        if not revisions:
            return None
        return revisions[-1]

    def _context(self, current_source_text: str, current_segment_id: str) -> CorrectionContext:
        """构建翻译上下文，包含基于流式窗口的术语匹配。

        窗口 = 最近 1-2 个 final/committed 段 + 当前段。
        只保留 span 与当前段重叠的术语，避免上一段术语污染当前段。
        """
        context_glossary: dict[str, str] = {}
        context_constraints: dict[str, str] = {}

        if current_source_text.strip():
            prefix = " ".join(
                seg.source_text
                for seg in self._history
                if seg.status == SegmentStatus.COMMITTED
            )
            prefix = " ".join(prefix.split()[-50:])  # 截断前缀，控制窗口大小
            source_window = f"{prefix} {current_source_text}".strip()
            current_start = len(prefix) + 1 if prefix else 0

            current_terms = self._glossary.match_terms(current_source_text, max_terms=12)
            matched_terms = [
                _offset_matched_term(term, current_start)
                for term in current_terms
            ]
            if len(matched_terms) < 12 and prefix:
                matched_terms.extend(
                    self._glossary.match_terms(
                        source_window,
                        max_terms=12 + len(matched_terms),
                    )
                )
            # 只保留 span 与当前段重叠的术语
            matched_terms = [m for m in matched_terms if m.end > current_start]
            matched_terms = _unique_matched_terms(matched_terms, max_terms=12)

            context_glossary = {m.source_for_prompt: m.entry.target for m in matched_terms}
            context_constraints = {m.source_for_prompt: m.entry.constraint for m in matched_terms}

            if context_glossary:
                logger.debug("glossary_match", extra={
                    "matched_terms": list(context_glossary.keys()),
                    "matched_count": len(context_glossary),
                })

        return CorrectionContext(
            recent_segments=tuple(self._history),
            current_segment_revisions=tuple(
                self._segment_revisions.get(current_segment_id, ())
            ),
            glossary=context_glossary,
            glossary_constraints=context_constraints,
            max_revision_segments=self.revision_window_segments,
        )


def _visible_char_count(text: str) -> int:
    return len([char for char in text if not char.isspace()])


def _ends_with_weak_boundary(text: str) -> bool:
    return text.rstrip().endswith((",", "，", ";", "；", ":", "："))


def _metric_value(metrics: dict[str, float], key: str) -> float:
    value = metrics.get(key)
    if value is None:
        return -1.0
    return float(value)


def _offset_matched_term(term: MatchedTerm, offset: int) -> MatchedTerm:
    return replace(term, start=term.start + offset, end=term.end + offset)


def _unique_matched_terms(
    terms: list[MatchedTerm],
    *,
    max_terms: int,
) -> list[MatchedTerm]:
    selected: list[MatchedTerm] = []
    seen: set[str] = set()
    for term in terms:
        identity = term.entry.source.strip()
        if not term.entry.case_sensitive:
            identity = identity.lower()
        if identity in seen:
            continue
        selected.append(term)
        seen.add(identity)
        if len(selected) >= max_terms:
            break
    return selected


def _with_metric(
    transcript: TranscriptSegment,
    key: str,
    value: float,
) -> TranscriptSegment:
    return replace(transcript, metrics={**transcript.metrics, key: value})


def _with_simul_policy_decision(
    transcript: TranscriptSegment,
    decision: SimulPolicyDecision,
) -> TranscriptSegment:
    return replace(
        transcript,
        metrics={**transcript.metrics, **_simul_policy_metrics(decision)},
    )


def _simul_policy_metrics(decision: SimulPolicyDecision) -> dict[str, float]:
    return {
        "simul_policy_action": simul_action_code(decision.action),
        "simul_policy_confidence": decision.confidence,
        "simul_policy_source_span_end": float(decision.source_span_end),
    }
