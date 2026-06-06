from __future__ import annotations

from collections.abc import AsyncIterator

from echosync_agent.domain import AudioFrame
from echosync_agent.interfaces import (
    CorrectionEngine,
    SubtitleSink,
    Transcriber,
    TranslatedAudioSink,
    Translator,
    TtsSynthesizer,
)
from echosync_agent.pipeline.engine_pipeline import EngineDrivenInterpretationPipeline
from echosync_agent.services.engine import CascadedInterpretationEngine
from echosync_agent.services.translation.terminology import Glossary


class RealtimeInterpretationPipeline:
    """音频 -> ASR -> 翻译 -> 修正 -> 字幕输出。

    这个类保留旧构造函数作为兼容门面，实际编排委托给统一听译引擎管道。
    """

    def __init__(
        self,
        transcriber: Transcriber,
        translator: Translator,
        correction_engine: CorrectionEngine,
        subtitle_sink: SubtitleSink,
        target_lang: str = "zh-CN",
        revision_window_segments: int = 2,
        glossary: Glossary | dict[str, str] | None = None,
        tts_synthesizer: TtsSynthesizer | None = None,
        audio_sink: TranslatedAudioSink | None = None,
    ) -> None:
        engine = CascadedInterpretationEngine(
            transcriber=transcriber,
            translator=translator,
            correction_engine=correction_engine,
            target_lang=target_lang,
            revision_window_segments=revision_window_segments,
            glossary=glossary,
        )
        self._pipeline = EngineDrivenInterpretationPipeline(
            engine=engine,
            subtitle_sink=subtitle_sink,
            audio_sink=audio_sink,
            tts_synthesizer=tts_synthesizer,
        )

    async def run(self, frames: AsyncIterator[AudioFrame]) -> None:
        await self._pipeline.run(frames)
