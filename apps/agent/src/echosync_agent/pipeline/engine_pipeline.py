from __future__ import annotations

from collections.abc import AsyncIterator

from echosync_agent.domain import (
    AudioFrame,
    SegmentCommit,
    SubtitlePatch,
    TranslatedAudioChunk,
    TranslationSegment,
)
from echosync_agent.interfaces import InterpretationEngine, SubtitleSink, TranslatedAudioSink


class EngineDrivenInterpretationPipeline:
    """面向统一听译引擎的薄编排层。"""

    def __init__(
        self,
        engine: InterpretationEngine,
        subtitle_sink: SubtitleSink,
        audio_sink: TranslatedAudioSink | None = None,
    ) -> None:
        self.engine = engine
        self.subtitle_sink = subtitle_sink
        self.audio_sink = audio_sink

    async def run(self, frames: AsyncIterator[AudioFrame]) -> None:
        async for event in self.engine.stream(frames):
            if isinstance(event, TranslationSegment):
                await self.subtitle_sink.publish_translation(event)
            elif isinstance(event, SubtitlePatch):
                await self.subtitle_sink.publish_patch(event)
            elif isinstance(event, SegmentCommit):
                await self.subtitle_sink.publish_commit(event)
            elif isinstance(event, TranslatedAudioChunk) and self.audio_sink is not None:
                await self.audio_sink.publish_audio(event)
