from __future__ import annotations

from echosync_agent.domain import CorrectionContext, TranscriptSegment, TranslationSegment
from echosync_agent.interfaces import Translator


class MockTranslator(Translator):
    """Predictable translator for contract tests and UI demos."""

    def __init__(self, target_lang: str = "zh-CN") -> None:
        self.target_lang = target_lang

    async def translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> TranslationSegment:
        glossary_text = self._apply_glossary(segment.text, context.glossary)
        target_text = f"[zh] {glossary_text}"
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

    @staticmethod
    def _apply_glossary(text: str, glossary: dict[str, str]) -> str:
        result = text
        for source, target in glossary.items():
            result = result.replace(source, target)
        return result
