from __future__ import annotations

import asyncio
import logging
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
                    self._schedule_tts(event, tts_tasks)
                elif isinstance(event, SubtitlePatch):
                    await self.subtitle_sink.publish_patch(event)
                elif isinstance(event, SegmentCommit):
                    await self.subtitle_sink.publish_commit(event)
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

        previous: bytes | None = None
        try:
            async for chunk in self.tts_synthesizer.synthesize(segment):
                if previous is not None:
                    await self.audio_sink.publish_audio(
                        self._audio_chunk(segment, previous, final=False)
                    )
                previous = chunk
            if previous is not None:
                await self.audio_sink.publish_audio(
                    self._audio_chunk(segment, previous, final=True)
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
        )
