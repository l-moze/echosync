from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator

from echosync_agent.domain import (
    AudioFrame,
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
    TtsSynthesizer,
)

logger = logging.getLogger(__name__)


class EngineDrivenInterpretationPipeline:
    """面向统一听译引擎的薄编排层。"""

    def __init__(
        self,
        engine: InterpretationEngine,
        subtitle_sink: SubtitleSink,
        audio_sink: TranslatedAudioSink | None = None,
        tts_synthesizer: TtsSynthesizer | None = None,
    ) -> None:
        self.engine = engine
        self.subtitle_sink = subtitle_sink
        self.audio_sink = audio_sink
        self.tts_synthesizer = tts_synthesizer

    async def run(self, frames: AsyncIterator[AudioFrame]) -> None:
        tts_tasks: set[asyncio.Task[None]] = set()
        try:
            async for event in self.engine.stream(frames):
                if isinstance(event, TranslationSegment):
                    await self.subtitle_sink.publish_translation(event)
                elif isinstance(event, SubtitlePatch):
                    await self.subtitle_sink.publish_patch(event)
                elif isinstance(event, SegmentCommit):
                    await self.subtitle_sink.publish_commit(event)
                    self._schedule_tts(_translation_from_commit(event), tts_tasks)
                elif isinstance(event, TranslatedAudioChunk) and self.audio_sink is not None:
                    await self.audio_sink.publish_audio(event)
        finally:
            if tts_tasks:
                await asyncio.gather(*tts_tasks, return_exceptions=True)

    def _schedule_tts(
        self,
        segment: TranslationSegment,
        tts_tasks: set[asyncio.Task[None]],
    ) -> None:
        if self.tts_synthesizer is None or self.audio_sink is None:
            return
        if segment.status != SegmentStatus.COMMITTED or not segment.target_text.strip():
            return

        task = asyncio.create_task(self._publish_tts_segment(segment))
        tts_tasks.add(task)
        task.add_done_callback(tts_tasks.discard)

    async def _publish_tts_segment(self, segment: TranslationSegment) -> None:
        assert self.tts_synthesizer is not None
        assert self.audio_sink is not None

        sent_any = False
        provider = type(self.tts_synthesizer).__name__
        started_at = time.perf_counter()
        first_audio_ms: float | None = None
        audio_chunks = 0
        audio_bytes = 0
        logger.info(
            "tts_synthesis_started session_id=%s segment_id=%s rev=%d "
            "target_chars=%d tts_provider=%s",
            segment.session_id,
            segment.segment_id,
            segment.rev,
            len(segment.target_text),
            provider,
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
        except Exception:
            logger.exception(
                "tts_synthesis_failed session_id=%s segment_id=%s rev=%d",
                segment.session_id,
                segment.segment_id,
                segment.rev,
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
) -> dict[str, float]:
    metrics = dict(segment.metrics)
    metrics.update(
        {
            "tts_first_audio_ms": first_audio_ms if first_audio_ms is not None else -1.0,
            "tts_audio_chunks": float(audio_chunks),
            "tts_audio_bytes": float(audio_bytes),
        }
    )
    if total_ms is not None:
        metrics["tts_total_ms"] = total_ms
    return metrics
