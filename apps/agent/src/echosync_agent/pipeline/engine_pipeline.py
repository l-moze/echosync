from __future__ import annotations

import asyncio
import logging
import re
import time
from collections import deque
from collections.abc import AsyncIterator
from contextlib import suppress
from dataclasses import dataclass

from echosync_agent.domain import (
    AudioFrame,
    CorrectionContext,
    SegmentCommit,
    SegmentStatus,
    SubtitlePatch,
    TranslatedAudioChunk,
    TranslationSegment,
)
from echosync_agent.interfaces import (
    InterpretationEngine,
    SubtitleSink,
    TranslatedAudioSink,
    TranslationRepairEngine,
    TtsSynthesizer,
)
from echosync_agent.services.correction.semantic_repair import (
    SemanticTranslationRepairPolicy,
)
from echosync_agent.services.subtitle.caption_update import caption_update_from_final_translation
from echosync_agent.services.translation.terminology import Glossary
from echosync_agent.services.tts.utterance_splitter import TtsUtteranceSplitter

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class _TranslationRepairJob:
    segment: TranslationSegment
    context: CorrectionContext
    reason: str


class EngineDrivenInterpretationPipeline:
    """面向统一听译引擎的薄编排层。"""

    def __init__(
        self,
        engine: InterpretationEngine,
        subtitle_sink: SubtitleSink,
        audio_sink: TranslatedAudioSink | None = None,
        tts_synthesizer: TtsSynthesizer | None = None,
        tts_utterance_splitter: TtsUtteranceSplitter | None = None,
        translation_repair_engine: TranslationRepairEngine | None = None,
        translation_repair_timeout_ms: int = 1_500,
        translation_repair_max_concurrency: int = 1,
        translation_repair_mode: str = "suspect_only",
        translation_repair_glossary: Glossary | dict[str, str] | None = None,
        translation_repair_context_segments: int = 3,
        tts_prefetch_concurrency: int = 2,
    ) -> None:
        self.engine = engine
        self.subtitle_sink = subtitle_sink
        self.audio_sink = audio_sink
        self.tts_synthesizer = tts_synthesizer
        self.tts_utterance_splitter = tts_utterance_splitter or TtsUtteranceSplitter()
        self.translation_repair_engine = translation_repair_engine
        self.translation_repair_timeout_ms = translation_repair_timeout_ms
        self.translation_repair_max_concurrency = max(1, translation_repair_max_concurrency)
        self.translation_repair_context_segments = max(1, translation_repair_context_segments)
        self.tts_prefetch_concurrency = max(1, tts_prefetch_concurrency)
        self.translation_repair_policy = SemanticTranslationRepairPolicy(
            mode=(
                "debug_all"
                if translation_repair_mode == "debug_all"
                else "suspect_only"
            )
        )
        self.translation_repair_glossary = _coerce_glossary(translation_repair_glossary)

    async def run(self, frames: AsyncIterator[AudioFrame]) -> None:
        tts_queue: asyncio.Queue[TranslationSegment | None] | None = None
        tts_worker: asyncio.Task[None] | None = None
        repair_queue: asyncio.Queue[_TranslationRepairJob | None] | None = None
        repair_workers: list[asyncio.Task[None]] = []
        repair_history: deque[TranslationSegment] = deque(
            maxlen=self.translation_repair_context_segments
        )
        repair_latest_revisions: dict[str, int] = {}
        completed = False
        if self.tts_synthesizer is not None and self.audio_sink is not None:
            tts_queue = asyncio.Queue()
            tts_worker = asyncio.create_task(self._run_tts_worker(tts_queue))
        if self.translation_repair_engine is not None:
            repair_queue = asyncio.Queue()
            repair_workers = [
                asyncio.create_task(
                    self._run_translation_repair_worker(
                        repair_queue,
                        repair_latest_revisions,
                    )
                )
                for _ in range(self.translation_repair_max_concurrency)
            ]
        try:
            async for event in self.engine.stream(frames):
                if isinstance(event, TranslationSegment):
                    await self.subtitle_sink.publish_translation(event)
                elif isinstance(event, SubtitlePatch):
                    await self.subtitle_sink.publish_patch(event)
                elif isinstance(event, SegmentCommit):
                    committed_segment = _translation_from_commit(event)
                    repair_latest_revisions[committed_segment.segment_id] = (
                        committed_segment.rev
                    )
                    await self.subtitle_sink.publish_commit(event)
                    self._schedule_translation_repair(
                        committed_segment,
                        repair_queue,
                        tuple(repair_history),
                    )
                    repair_history.append(committed_segment)
                    self._schedule_tts(committed_segment, tts_queue)
                elif isinstance(event, TranslatedAudioChunk) and self.audio_sink is not None:
                    await self.audio_sink.publish_audio(event)
            completed = True
        finally:
            if repair_queue is not None and repair_workers:
                if completed:
                    for _worker in repair_workers:
                        await repair_queue.put(None)
                    await asyncio.gather(*repair_workers)
                else:
                    for worker in repair_workers:
                        worker.cancel()
                    for worker in repair_workers:
                        with suppress(asyncio.CancelledError):
                            await worker
            if tts_queue is not None and tts_worker is not None:
                if completed:
                    await tts_queue.put(None)
                    await tts_worker
                else:
                    tts_worker.cancel()
                    with suppress(asyncio.CancelledError):
                        await tts_worker

    def _schedule_tts(
        self,
        segment: TranslationSegment,
        tts_queue: asyncio.Queue[TranslationSegment | None] | None,
    ) -> None:
        if tts_queue is None:
            return
        if segment.status != SegmentStatus.COMMITTED or not segment.target_text.strip():
            return
        tts_queue.put_nowait(segment)

    def _schedule_translation_repair(
        self,
        segment: TranslationSegment,
        repair_queue: asyncio.Queue[_TranslationRepairJob | None] | None,
        recent_segments: tuple[TranslationSegment, ...],
    ) -> None:
        if repair_queue is None:
            return
        decision = self.translation_repair_policy.decide(segment)
        if not decision.should_repair:
            logger.debug(
                "translation_revision_skipped session_id=%s segment_id=%s rev=%d "
                "reason=%s lane=semantic",
                segment.session_id,
                segment.segment_id,
                segment.rev,
                decision.reason,
            )
            return

        context = self._translation_repair_context(segment, recent_segments)
        repair_queue.put_nowait(
            _TranslationRepairJob(
                segment=segment,
                context=context,
                reason=decision.reason,
            )
        )
        logger.info(
            "translation_revision_queued session_id=%s segment_id=%s rev=%d "
            "reason=%s lane=semantic queue_depth=%d",
            segment.session_id,
            segment.segment_id,
            segment.rev,
            decision.reason,
            repair_queue.qsize(),
        )

    def _translation_repair_context(
        self,
        segment: TranslationSegment,
        recent_segments: tuple[TranslationSegment, ...],
    ) -> CorrectionContext:
        glossary: dict[str, str] = {}
        constraints: dict[str, str] = {}
        if self.translation_repair_glossary is not None:
            matched_terms = self.translation_repair_glossary.match_terms(
                segment.source_text,
                max_terms=12,
            )
            glossary = {term.source_for_prompt: term.entry.target for term in matched_terms}
            constraints = {
                term.source_for_prompt: term.entry.constraint
                for term in matched_terms
            }

        return CorrectionContext(
            recent_segments=recent_segments,
            glossary=glossary,
            glossary_constraints=constraints,
            max_revision_segments=self.translation_repair_context_segments,
        )

    async def _run_translation_repair_worker(
        self,
        queue: asyncio.Queue[_TranslationRepairJob | None],
        latest_revisions: dict[str, int],
    ) -> None:
        assert self.translation_repair_engine is not None
        while True:
            job = await queue.get()
            if job is None:
                return
            await self._publish_translation_repair(job, latest_revisions)

    async def _publish_translation_repair(
        self,
        job: _TranslationRepairJob,
        latest_revisions: dict[str, int],
    ) -> None:
        assert self.translation_repair_engine is not None
        segment = job.segment
        logger.info(
            "translation_revision_started session_id=%s segment_id=%s rev=%d "
            "reason=%s lane=semantic",
            segment.session_id,
            segment.segment_id,
            segment.rev,
            job.reason,
        )
        started_at = time.perf_counter()
        try:
            repaired = await asyncio.wait_for(
                self.translation_repair_engine.repair(
                    segment,
                    job.context,
                    reason=job.reason,
                ),
                timeout=self.translation_repair_timeout_ms / 1000,
            )
        except TimeoutError:
            logger.info(
                "translation_revision_timeout session_id=%s segment_id=%s rev=%d "
                "timeout_ms=%d lane=semantic",
                segment.session_id,
                segment.segment_id,
                segment.rev,
                self.translation_repair_timeout_ms,
            )
            return
        except Exception:
            logger.exception(
                "translation_revision_failed session_id=%s segment_id=%s rev=%d "
                "lane=semantic",
                segment.session_id,
                segment.segment_id,
                segment.rev,
            )
            return

        if repaired is None:
            logger.info(
                "translation_revision_skipped session_id=%s segment_id=%s rev=%d "
                "reason=unchanged lane=semantic",
                segment.session_id,
                segment.segment_id,
                segment.rev,
            )
            return
        if repaired.rev <= segment.rev:
            logger.info(
                "translation_revision_skipped session_id=%s segment_id=%s rev=%d "
                "reason=invalid_revision lane=semantic repaired_rev=%d",
                segment.session_id,
                segment.segment_id,
                segment.rev,
                repaired.rev,
            )
            return
        if repaired.target_text.strip() == segment.target_text.strip():
            logger.info(
                "translation_revision_skipped session_id=%s segment_id=%s rev=%d "
                "reason=unchanged_target lane=semantic",
                segment.session_id,
                segment.segment_id,
                segment.rev,
            )
            return
        if latest_revisions.get(segment.segment_id) != segment.rev:
            logger.info(
                "translation_revision_skipped session_id=%s segment_id=%s rev=%d "
                "reason=stale_base lane=semantic latest_rev=%s",
                segment.session_id,
                segment.segment_id,
                segment.rev,
                latest_revisions.get(segment.segment_id),
            )
            return

        latest_revisions[segment.segment_id] = repaired.rev
        await self.subtitle_sink.publish_caption_update(
            caption_update_from_final_translation(repaired)
        )
        logger.info(
            "translation_revision_finished session_id=%s segment_id=%s "
            "base_rev=%d rev=%d total_ms=%.1f lane=semantic changed_chars=%.0f",
            repaired.session_id,
            repaired.segment_id,
            segment.rev,
            repaired.rev,
            (time.perf_counter() - started_at) * 1000,
            repaired.metrics.get("semantic_revision_changed_chars", -1.0),
        )

    async def _run_tts_worker(self, queue: asyncio.Queue[TranslationSegment | None]) -> None:
        semaphore = asyncio.Semaphore(self.tts_prefetch_concurrency)
        tasks: set[asyncio.Task[None]] = set()

        async def run_prefetched(utterance: TranslationSegment, queued_at: float) -> None:
            async with semaphore:
                await self._publish_tts_segment(utterance, queued_at=queued_at)

        try:
            while True:
                segment = await queue.get()
                if segment is None:
                    break
                for utterance in self.tts_utterance_splitter.split(segment):
                    queued_at = time.perf_counter()
                    await self._publish_tts_placeholder(utterance)
                    task = asyncio.create_task(run_prefetched(utterance, queued_at))
                    tasks.add(task)
                    task.add_done_callback(tasks.discard)
                    logger.info(
                        "tts_synthesis_queued session_id=%s segment_id=%s rev=%d "
                        "target_chars=%d tts_queue_depth=%d tts_prefetch_concurrency=%d",
                        utterance.session_id,
                        utterance.segment_id,
                        utterance.rev,
                        len(utterance.target_text),
                        len(tasks),
                        self.tts_prefetch_concurrency,
                    )

            if tasks:
                await asyncio.gather(*tasks)
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

    async def _publish_tts_placeholder(self, segment: TranslationSegment) -> None:
        assert self.audio_sink is not None
        await self.audio_sink.publish_audio(
            self._audio_chunk(
                segment,
                b"",
                final=False,
                metrics=dict(segment.metrics)
                | {
                    "tts_prefetch_placeholder": 1.0,
                    "tts_prefetch_concurrency": float(self.tts_prefetch_concurrency),
                },
            )
        )

    async def _publish_tts_segment(
        self,
        segment: TranslationSegment,
        *,
        queued_at: float | None = None,
    ) -> None:
        assert self.tts_synthesizer is not None
        assert self.audio_sink is not None

        sent_any = False
        provider = type(self.tts_synthesizer).__name__
        started_at = time.perf_counter()
        queue_wait_ms = (
            max((started_at - queued_at) * 1000, 0.0) if queued_at is not None else 0.0
        )
        first_audio_ms: float | None = None
        audio_chunks = 0
        audio_bytes = 0
        logger.info(
            "tts_synthesis_started session_id=%s segment_id=%s rev=%d "
            "target_chars=%d tts_provider=%s tts_queue_wait_ms=%.1f",
            segment.session_id,
            segment.segment_id,
            segment.rev,
            len(segment.target_text),
            provider,
            queue_wait_ms,
        )
        try:
            async for chunk in self.tts_synthesizer.synthesize(segment):
                if not chunk:
                    continue
                audio_chunks += 1
                audio_bytes += len(chunk)
                if first_audio_ms is None:
                    first_audio_ms = max((time.perf_counter() - started_at) * 1000, 0.0)
                    logger.info(
                        "tts_synthesis_first_audio session_id=%s segment_id=%s rev=%d "
                        "first_audio_ms=%.1f audio_bytes=%d target_chars=%d "
                        "tts_provider=%s",
                        segment.session_id,
                        segment.segment_id,
                        segment.rev,
                        first_audio_ms,
                        len(chunk),
                        len(segment.target_text),
                        provider,
                    )
                await self.audio_sink.publish_audio(
                    self._audio_chunk(
                        segment,
                        chunk,
                        final=False,
                        metrics=_tts_metrics(
                            segment,
                            first_audio_ms=first_audio_ms,
                            total_ms=None,
                            audio_chunks=audio_chunks,
                            audio_bytes=audio_bytes,
                            queue_wait_ms=queue_wait_ms,
                        ),
                    )
                )
                sent_any = True
            if sent_any:
                total_ms = max((time.perf_counter() - started_at) * 1000, 0.0)
                logger.info(
                    "tts_synthesis_finished session_id=%s segment_id=%s rev=%d "
                    "total_ms=%.1f first_audio_ms=%.1f audio_chunks=%d "
                    "audio_bytes=%d target_chars=%d tts_provider=%s",
                    segment.session_id,
                    segment.segment_id,
                    segment.rev,
                    total_ms,
                    first_audio_ms if first_audio_ms is not None else -1.0,
                    audio_chunks,
                    audio_bytes,
                    len(segment.target_text),
                    provider,
                )
                await self.audio_sink.publish_audio(
                    self._audio_chunk(
                        segment,
                        b"",
                        final=True,
                        metrics=_tts_metrics(
                            segment,
                            first_audio_ms=first_audio_ms,
                            total_ms=total_ms,
                            audio_chunks=audio_chunks,
                            audio_bytes=audio_bytes,
                            queue_wait_ms=queue_wait_ms,
                        ),
                    )
                )
            else:
                logger.info(
                    "tts_synthesis_finished session_id=%s segment_id=%s rev=%d "
                    "total_ms=%.1f first_audio_ms=-1.0 audio_chunks=0 "
                    "audio_bytes=0 target_chars=%d tts_provider=%s",
                    segment.session_id,
                    segment.segment_id,
                    segment.rev,
                    max((time.perf_counter() - started_at) * 1000, 0.0),
                    len(segment.target_text),
                    provider,
                )
        except Exception as exc:
            total_ms = max((time.perf_counter() - started_at) * 1000, 0.0)
            logger.exception(
                "tts_synthesis_failed session_id=%s segment_id=%s rev=%d "
                "total_ms=%.1f first_audio_ms=%.1f audio_chunks=%d "
                "audio_bytes=%d target_chars=%d tts_provider=%s code=%s",
                segment.session_id,
                segment.segment_id,
                segment.rev,
                total_ms,
                first_audio_ms if first_audio_ms is not None else -1.0,
                audio_chunks,
                audio_bytes,
                len(segment.target_text),
                provider,
                _tts_error_code(exc),
            )
            await _publish_tts_error(
                self.audio_sink,
                segment=segment,
                provider=provider,
                exc=exc,
                retryable=_tts_error_retryable(exc),
                metrics=_tts_metrics(
                    segment,
                    first_audio_ms=first_audio_ms,
                    total_ms=total_ms,
                    audio_chunks=audio_chunks,
                    audio_bytes=audio_bytes,
                    queue_wait_ms=queue_wait_ms,
                )
                | {"tts_failed": 1.0},
            )

    @staticmethod
    def _audio_chunk(
        segment: TranslationSegment,
        audio: bytes,
        *,
        final: bool,
        metrics: dict[str, float] | None = None,
    ) -> TranslatedAudioChunk:
        return TranslatedAudioChunk(
            session_id=segment.session_id,
            segment_id=segment.segment_id,
            rev=segment.rev,
            start_ms=segment.start_ms,
            end_ms=segment.end_ms,
            target_lang=segment.target_lang,
            audio=audio,
            mime_type="audio/mpeg",
            final=final,
            metrics=metrics or {},
        )


def _translation_from_commit(commit: SegmentCommit) -> TranslationSegment:
    return TranslationSegment(
        session_id=commit.session_id,
        segment_id=commit.segment_id,
        rev=commit.rev,
        source_rev=commit.rev,
        start_ms=commit.start_ms,
        end_ms=commit.end_ms,
        source_lang=commit.source_lang,
        target_lang=commit.target_lang,
        source_text=commit.source_text,
        target_text=commit.target_text,
        status=SegmentStatus.COMMITTED,
        stability=1.0,
        speaker=commit.speaker,
        metrics=dict(commit.metrics),
        source_stable_text=commit.source_stable_text,
        source_unstable_text=commit.source_unstable_text,
        target_stable_text=commit.target_stable_text,
        target_unstable_text=commit.target_unstable_text,
    )


def _tts_metrics(
    segment: TranslationSegment,
    *,
    first_audio_ms: float | None,
    total_ms: float | None,
    audio_chunks: int,
    audio_bytes: int,
    queue_wait_ms: float = 0.0,
) -> dict[str, float]:
    metrics = dict(segment.metrics)
    metrics.update(
        {
            "tts_first_audio_ms": first_audio_ms if first_audio_ms is not None else -1.0,
            "tts_queue_wait_ms": queue_wait_ms,
            "tts_audio_chunks": float(audio_chunks),
            "tts_audio_bytes": float(audio_bytes),
        }
    )
    if total_ms is not None:
        metrics["tts_total_ms"] = total_ms
    return metrics


async def _publish_tts_error(
    audio_sink: TranslatedAudioSink,
    *,
    segment: TranslationSegment,
    provider: str,
    exc: Exception,
    retryable: bool,
    metrics: dict[str, float],
) -> None:
    publish_error = getattr(audio_sink, "publish_error", None)
    if publish_error is None:
        logger.debug(
            "tts_error_sink_unsupported session_id=%s segment_id=%s rev=%d",
            segment.session_id,
            segment.segment_id,
            segment.rev,
        )
        return

    await publish_error(
        {
            "session_id": segment.session_id,
            "segment_id": segment.segment_id,
            "rev": segment.rev,
            "start_ms": segment.start_ms,
            "end_ms": segment.end_ms,
            "target_lang": segment.target_lang,
            "target_text": segment.target_text,
            "provider": provider,
            "message": _safe_tts_error_message(exc),
            "code": _tts_error_code(exc),
            "retryable": retryable,
            "metrics": metrics,
        }
    )


def _tts_error_code(exc: Exception) -> str:
    message = str(exc).lower()
    if "voice_not_found" in message:
        return "tts.elevenlabs.voice_not_found"
    if "paid_plan_required" in message or "http 402" in message:
        return "tts.elevenlabs.paid_plan_required"
    if "http 401" in message or "unauthorized" in message:
        return "tts.auth_failed"
    if "http 403" in message or "permission" in message:
        return "tts.permission_denied"
    if "http 429" in message or "rate_limit" in message:
        return "tts.rate_limited"
    if "timeout" in message or isinstance(exc, TimeoutError):
        return "tts.timeout"
    if re.search(r"http 5\d\d", message):
        return "tts.upstream_unavailable"
    return "tts.synthesis_failed"


def _tts_error_retryable(exc: Exception) -> bool:
    return _tts_error_code(exc) in {
        "tts.rate_limited",
        "tts.timeout",
        "tts.upstream_unavailable",
    }


def _safe_tts_error_message(exc: Exception, *, max_chars: int = 480) -> str:
    message = str(exc).strip() or type(exc).__name__
    message = re.sub(
        r"(?i)((?:xi-api-key|api[_-]?key|authorization)"
        r"(?:['\"]?\s*[:=]\s*['\"]?))([^'\"\s,}]+)",
        r"\1<redacted>",
        message,
    )
    if len(message) <= max_chars:
        return message
    return f"{message[:max_chars]}..."


def _coerce_glossary(glossary: Glossary | dict[str, str] | None) -> Glossary | None:
    if glossary is None:
        return None
    if isinstance(glossary, Glossary):
        return glossary
    if not glossary:
        return None
    return Glossary.from_dict(glossary)
