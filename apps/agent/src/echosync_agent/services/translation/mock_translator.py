from __future__ import annotations

from collections.abc import AsyncIterator

from echosync_agent.domain import CorrectionContext, TranscriptSegment, TranslationSegment
from echosync_agent.interfaces import Translator
from echosync_agent.services.translation.terminology import apply_glossary_replacements


class MockTranslator(Translator):
    """用于契约测试和 UI 演示的可预测翻译器。"""

    def __init__(self, target_lang: str = "zh-CN") -> None:
        self.target_lang = target_lang

    async def translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> TranslationSegment:
        glossary_text = apply_glossary_replacements(segment.text, context.glossary)
        target_text = f"[zh] {glossary_text}"
        return self._build_segment(segment, target_text)

    async def stream_translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> AsyncIterator[TranslationSegment]:
        translation = await self.translate(segment, context)
        yield self._build_segment(segment, "[zh]")
        yield translation

    def _build_segment(self, segment: TranscriptSegment, target_text: str) -> TranslationSegment:
        return TranslationSegment(
            session_id=segment.session_id,
            segment_id=segment.segment_id,
            rev=segment.rev,
            source_rev=segment.rev,
            start_ms=segment.start_ms,
            end_ms=segment.end_ms,
            source_lang=segment.source_lang,
            target_lang=self.target_lang,
            source_text=segment.text,
            target_text=target_text,
            status=segment.status,
            stability=segment.stability,
            speaker=segment.speaker,
        )
