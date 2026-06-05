from __future__ import annotations

from echosync_agent.domain import CorrectionContext, TranscriptSegment, TranslationSegment
from echosync_agent.interfaces import Translator


class DeepSeekTranslator(Translator):
    """OpenAI-compatible DeepSeek translator adapter."""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        target_lang: str = "zh-CN",
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        self.target_lang = target_lang

    async def translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> TranslationSegment:
        from openai import AsyncOpenAI

        glossary = "\n".join(f"- {src} => {dst}" for src, dst in context.glossary.items())
        system = (
            "You are a low-latency simultaneous interpreter. Translate the source text "
            f"into {self.target_lang}. Preserve technical terms and do not add commentary."
        )
        user = (
            f"Recent context:\n{self._recent_context(context)}\n\n"
            f"Glossary:\n{glossary or '(none)'}\n\n"
            f"Source:\n{segment.text}"
        )

        client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)
        response = await client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.1,
        )
        target_text = response.choices[0].message.content or ""

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
            target_text=target_text.strip(),
            status=segment.status,
            stability=segment.stability,
            speaker=segment.speaker,
        )

    @staticmethod
    def _recent_context(context: CorrectionContext) -> str:
        lines = [
            f"{item.source_text} => {item.target_text}"
            for item in context.recent_segments[-context.max_revision_segments :]
        ]
        return "\n".join(lines) if lines else "(none)"
