from __future__ import annotations

from collections import deque
from collections.abc import AsyncIterator

from echosync_agent.domain import (
    AudioFrame,
    CorrectionContext,
    SegmentCommit,
    SegmentStatus,
    TranslationSegment,
)
from echosync_agent.interfaces import CorrectionEngine, SubtitleSink, Transcriber, Translator


class RealtimeInterpretationPipeline:
    """Audio -> ASR -> translation -> correction -> subtitle output.

    The class owns orchestration only. It deliberately has no provider SDK imports.
    """

    def __init__(
        self,
        transcriber: Transcriber,
        translator: Translator,
        correction_engine: CorrectionEngine,
        subtitle_sink: SubtitleSink,
        target_lang: str = "zh-CN",
        revision_window_segments: int = 2,
        glossary: dict[str, str] | None = None,
    ) -> None:
        self.transcriber = transcriber
        self.translator = translator
        self.correction_engine = correction_engine
        self.subtitle_sink = subtitle_sink
        self.target_lang = target_lang
        self.revision_window_segments = revision_window_segments
        self.glossary = glossary or {}
        self._history: deque[TranslationSegment] = deque(maxlen=revision_window_segments + 4)

    async def run(self, frames: AsyncIterator[AudioFrame]) -> None:
        async for transcript in self.transcriber.stream(frames):
            context = self._context()
            translation = await self.translator.translate(transcript, context)

            patch = await self.correction_engine.revise(translation, context)
            await self.subtitle_sink.publish_translation(translation)
            if patch is not None:
                await self.subtitle_sink.publish_patch(patch)

            self._history.append(translation)

            if transcript.status == SegmentStatus.COMMITTED:
                await self.subtitle_sink.publish_commit(
                    SegmentCommit(
                        session_id=translation.session_id,
                        segment_id=translation.segment_id,
                        rev=translation.rev,
                        start_ms=translation.start_ms,
                        end_ms=translation.end_ms,
                        source_lang=translation.source_lang,
                        target_lang=translation.target_lang,
                        source_text=translation.source_text,
                        target_text=translation.target_text,
                        speaker=translation.speaker,
                    )
                )

    def _context(self) -> CorrectionContext:
        return CorrectionContext(
            recent_segments=tuple(self._history),
            glossary=self.glossary,
            max_revision_segments=self.revision_window_segments,
        )
