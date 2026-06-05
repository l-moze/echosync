from __future__ import annotations

from collections.abc import AsyncIterator
from html import escape

from echosync_agent.domain import CorrectionContext, TranscriptSegment, TranslationSegment
from echosync_agent.interfaces import Translator


class DeepSeekTranslator(Translator):
    """兼容 OpenAI API 的翻译适配器。"""

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

        system = (
            "You are a real-time subtitle translator. "
            f"Translate the user's source text into {self.target_lang}. "
            "Keep the translation concise and suitable for live captions. "
            "For glossary terms marked required, use the target translation exactly. "
            "For glossary terms marked preferred, prefer the target translation when natural. "
            "Do not invent glossary terms that are not listed. "
            "Return only the translated subtitle text. Do not include XML tags, explanations, or notes."
        )

        user = self._build_user_prompt(segment.text, context)

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

        # 术语缺失埋点（非阻塞）
        self._telemetry_glossary_missing(target_text.strip(), context)

        return self._build_segment(segment, target_text.strip())

    async def stream_translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> AsyncIterator[TranslationSegment]:
        from openai import AsyncOpenAI

        system = (
            "You are a real-time subtitle translator. "
            f"Translate the user's source text into {self.target_lang}. "
            "Keep the translation concise and suitable for live captions. "
            "For glossary terms marked required, use the target translation exactly. "
            "For glossary terms marked preferred, prefer the target translation when natural. "
            "Do not invent glossary terms that are not listed. "
            "Return only the translated subtitle text. Do not include XML tags, explanations, or notes."
        )
        user = self._build_user_prompt(segment.text, context)
        client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)
        stream = await client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.1,
            stream=True,
        )

        target_text = ""
        async for chunk in stream:
            delta = chunk.choices[0].delta.content or ""
            if not delta:
                continue
            target_text += delta
            yield self._build_segment(segment, target_text.strip())

        self._telemetry_glossary_missing(target_text.strip(), context)

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

    def _build_user_prompt(self, source_text: str, context: CorrectionContext) -> str:
        """构建带 XML 标签的用户 prompt。动态内容必须 XML escape。"""
        import logging

        logger = logging.getLogger(__name__)

        source_block = f"<source>{_xml_text(source_text)}</source>"

        if context.glossary:
            lines = []
            for src, tgt in context.glossary.items():
                constraint = context.glossary_constraints.get(src, "required")
                lines.append(
                    f'  <term source="{_xml_attr(src)}" target="{_xml_attr(tgt)}" '
                    f'constraint="{_xml_attr(constraint)}"/>'
                )
            glossary_block = "\n<glossary>\n" + "\n".join(lines) + "\n</glossary>"
        else:
            glossary_block = ""

        recent = self._recent_context(context)
        context_block = ""
        if recent:
            context_block = f"\n<context>\n{recent}\n</context>"

        result = f"{source_block}{context_block}{glossary_block}"
        logger.debug("deepseek_prompt_len", extra={"prompt_chars": len(result)})
        return result

    @staticmethod
    def _recent_context(context: CorrectionContext) -> str:
        lines = [
            "<item>"
            f"<source>{_xml_text(item.source_text)}</source>"
            f"<target>{_xml_text(item.target_text)}</target>"
            "</item>"
            for item in context.recent_segments[-context.max_revision_segments :]
        ]
        return "\n".join(lines) if lines else ""

    @staticmethod
    def _telemetry_glossary_missing(target_text: str, context: CorrectionContext) -> None:
        """检查已注入的术语是否在译文中出现，缺失时记录 debug 日志（不阻塞、不重试）"""
        import logging

        logger = logging.getLogger(__name__)
        for src, tgt in context.glossary.items():
            if tgt not in target_text:
                logger.debug("glossary_target_missing", extra={
                    "source": src,
                    "target": tgt,
                    "constraint": context.glossary_constraints.get(src, "required"),
                })


def _xml_text(value: str) -> str:
    """XML 文本节点转义（不转义引号）。"""
    return escape(value, quote=False)


def _xml_attr(value: str) -> str:
    """XML 属性值转义（转义引号）。"""
    return escape(value, quote=True)
