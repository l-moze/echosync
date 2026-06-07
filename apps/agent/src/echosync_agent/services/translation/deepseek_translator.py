from __future__ import annotations

import logging
import re
import time
from collections.abc import AsyncIterator, Callable
from html import escape
from typing import Any

from echosync_agent.domain import CorrectionContext, TranscriptSegment, TranslationSegment
from echosync_agent.interfaces import Translator
from echosync_agent.services.realtime.text_emission_policy import DEFAULT_TEXT_EMISSION_POLICY

ClientFactory = Callable[..., Any]
DEEPSEEK_BETA_BASE_URL = "https://api.deepseek.com/beta"
THINKING_DISABLED = {"thinking": {"type": "disabled"}}
STREAM_OPTIONS_WITH_USAGE = {"include_usage": True}
logger = logging.getLogger(__name__)


class DeepSeekTranslator(Translator):
    """兼容 OpenAI API 的翻译适配器。"""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        target_lang: str = "zh-CN",
        client_factory: ClientFactory | None = None,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        self.target_lang = target_lang
        self._client_factory = client_factory or _default_client_factory
        self._clients: dict[str, Any] = {}

    async def translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> TranslationSegment:
        client = self._client_for_base_url(self.base_url)
        response = await client.chat.completions.create(
            model=self.model,
            messages=self._messages(segment.text, context),
            temperature=0.1,
            extra_body=THINKING_DISABLED,
        )
        target_text = response.choices[0].message.content or ""
        metrics = _usage_metrics(getattr(response, "usage", None))

        translated = self._build_segment(
            segment,
            target_text.strip(),
            metrics=metrics,
            context=context,
        )
        # 术语缺失埋点（非阻塞）
        self._telemetry_glossary_missing(translated.target_text, context)
        return translated

    async def stream_translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> AsyncIterator[TranslationSegment]:
        prefix = self._completion_prefix(segment, context)
        base_url = self._beta_base_url() if prefix else self.base_url
        client = self._client_for_base_url(base_url)
        messages = self._messages(segment.text, context)
        prompt_chars = sum(len(str(message.get("content", ""))) for message in messages)
        if prefix:
            messages.append({"role": "assistant", "content": prefix, "prefix": True})
        logger.debug(
            "deepseek_stream_request_started session_id=%s segment_id=%s rev=%d "
            "model=%s beta_prefix=%s prefix_chars=%d prompt_chars=%d "
            "recent_segments=%d current_revisions=%d glossary_terms=%d",
            segment.session_id,
            segment.segment_id,
            segment.rev,
            self.model,
            bool(prefix),
            len(prefix),
            prompt_chars,
            len(context.recent_segments),
            len(context.current_segment_revisions),
            len(context.glossary),
        )
        request_started_at = time.perf_counter()

        stream = await client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=0.1,
            stream=True,
            stream_options=STREAM_OPTIONS_WITH_USAGE,
            extra_body=THINKING_DISABLED,
        )

        target_text = ""
        last_published_target = ""
        last_published_metrics: dict[str, float] = {}
        metrics: dict[str, float] = {}
        delta_count = 0
        first_delta_ms: float | None = None
        stream_open_ms = (time.perf_counter() - request_started_at) * 1000
        async for chunk in stream:
            metrics.update(_usage_metrics(getattr(chunk, "usage", None)))
            choices = getattr(chunk, "choices", None) or []
            if not choices:
                continue
            delta = choices[0].delta.content or ""
            if not delta:
                continue
            if first_delta_ms is None:
                first_delta_ms = (time.perf_counter() - request_started_at) * 1000
                logger.debug(
                    "deepseek_stream_first_delta session_id=%s segment_id=%s rev=%d "
                    "stream_open_ms=%.1f first_delta_ms=%.1f delta_chars=%d",
                    segment.session_id,
                    segment.segment_id,
                    segment.rev,
                    stream_open_ms,
                    first_delta_ms,
                    len(delta),
                )
            delta_count += 1
            target_text += delta
            metrics.update(
                {
                    "deepseek_delta_count": float(delta_count),
                    "deepseek_first_delta_ms": float(first_delta_ms),
                    "deepseek_prefix_chars": float(len(prefix)),
                    "deepseek_prompt_chars": float(prompt_chars),
                    "deepseek_stream_open_ms": stream_open_ms,
                }
            )
            stripped_target = _combine_prefix_completion(prefix, target_text)
            published = self._build_segment(
                segment,
                stripped_target,
                metrics=metrics,
                context=context,
            )
            if should_flush_streaming_target(
                previous_text=last_published_target,
                next_text=published.target_text,
            ):
                last_published_target = published.target_text
                last_published_metrics = dict(published.metrics)
                yield published

        if first_delta_ms is None:
            metrics.update(
                {
                    "deepseek_delta_count": 0.0,
                    "deepseek_prefix_chars": float(len(prefix)),
                    "deepseek_prompt_chars": float(prompt_chars),
                    "deepseek_stream_open_ms": stream_open_ms,
                }
            )
        final_target = _combine_prefix_completion(prefix, target_text)
        final_segment = self._build_segment(
            segment,
            final_target,
            metrics=metrics,
            context=context,
        )
        final_has_new_metrics = final_segment.metrics != last_published_metrics
        logger.debug(
            "deepseek_stream_finished session_id=%s segment_id=%s rev=%d "
            "stream_open_ms=%.1f first_delta_ms=%.1f delta_count=%d target_chars=%d "
            "prefix_chars=%d prompt_chars=%d",
            segment.session_id,
            segment.segment_id,
            segment.rev,
            stream_open_ms,
            first_delta_ms if first_delta_ms is not None else -1.0,
            delta_count,
            len(final_target),
            len(prefix),
            prompt_chars,
        )
        if (
            should_flush_streaming_target(
                previous_text=last_published_target,
                next_text=final_segment.target_text,
                is_final=True,
            )
            and (
                final_segment.target_text != last_published_target
                or final_has_new_metrics
            )
        ):
            yield final_segment

        self._telemetry_glossary_missing(final_segment.target_text, context)

    def _client_for_base_url(self, base_url: str) -> Any:
        if base_url not in self._clients:
            self._clients[base_url] = self._client_factory(
                api_key=self.api_key,
                base_url=base_url,
            )
        return self._clients[base_url]

    def _messages(self, source_text: str, context: CorrectionContext) -> list[dict[str, Any]]:
        return [
            {"role": "system", "content": self._system_prompt()},
            {"role": "user", "content": self._build_user_prompt(source_text, context)},
        ]

    def _system_prompt(self) -> str:
        return (
            "You are a real-time subtitle translator. "
            f"Translate the user's source text into {self.target_lang}. "
            "Keep the translation compact and suitable for live captions, but do not summarize, "
            "drop, or merge semantic content. "
            "Preserve final content words and head nouns, especially technical objects such as "
            "tasks, methods, datasets, demonstrations, models, and reasoning types. "
            "Smooth obvious speech fillers such as 'like' or 'kind of' without deleting the "
            "surrounding meaning. "
            "For spoken discourse markers such as leading 'So' or 'Like', omit them unless "
            "they are needed for logic; do not start every sentence with '所以' or '像'. "
            "Use natural Simplified Chinese word order for zh-CN; never output Traditional "
            "Chinese characters for zh-CN. "
            "For short fragments, use recent context and current-segment revisions to produce "
            "a natural continuation; do not invent first-person '我' for English 'we'. "
            "Prefer idiomatic Mandarin over literal word-for-word structure, for example "
            "translate busy places as '人多' or '热闹' when natural. "
            "For glossary terms marked required, use the target translation exactly. "
            "For glossary terms marked preferred, prefer the target translation when natural. "
            "Do not invent glossary terms that are not listed. "
            "Return only the translated subtitle text. "
            "Do not include XML tags, explanations, or notes."
        )

    def _beta_base_url(self) -> str:
        normalized = self.base_url.rstrip("/")
        if normalized.endswith("/beta"):
            return normalized
        if normalized.endswith("/v1"):
            return f"{normalized[:-3]}/beta"
        if normalized == "https://api.deepseek.com":
            return DEEPSEEK_BETA_BASE_URL
        return DEEPSEEK_BETA_BASE_URL

    @staticmethod
    def _completion_prefix(
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> str:
        previous = next(
            (
                item
                for item in reversed(context.current_segment_revisions)
                if item.target_text.strip()
            ),
            None,
        )
        if previous is None:
            return ""

        previous_source = previous.source_text.strip()
        current_source = segment.text.strip()
        if (
            not previous_source
            or current_source == previous_source
            or not current_source.startswith(previous_source)
        ):
            return ""

        previous_target = (previous.target_stable_text or previous.target_text).strip()
        if _target_closes_sentence(previous_target) and not _source_closes_sentence(
            previous_source
        ):
            return ""

        return previous_target

    def _build_segment(
        self,
        segment: TranscriptSegment,
        target_text: str,
        *,
        metrics: dict[str, float] | None = None,
        context: CorrectionContext | None = None,
    ) -> TranslationSegment:
        target_text, target_cleanup_metrics = _postprocess_target_text(
            target_text,
            source_text=segment.text,
            target_lang=self.target_lang,
        )
        target_text, glossary_metrics = _repair_required_glossary_copies(
            target_text,
            context,
        )
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
            metrics={**(metrics or {}), **target_cleanup_metrics, **glossary_metrics},
        )

    def _build_user_prompt(self, source_text: str, context: CorrectionContext) -> str:
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
        current_segment_revisions = self._current_segment_revision_context(context)
        current_segment_block = ""
        if current_segment_revisions:
            current_segment_block = (
                "\n<current_segment_revisions>\n"
                f"{current_segment_revisions}\n"
                "</current_segment_revisions>"
            )
        context_block = ""
        if recent:
            context_block = f"\n<context>\n{recent}\n</context>"

        source_block = f"\n<source>{_xml_text(_normalize_source_for_prompt(source_text))}</source>"
        result = f"{context_block}{current_segment_block}{glossary_block}{source_block}"
        logger.debug("deepseek_prompt_len", extra={"prompt_chars": len(result)})
        return result

    @staticmethod
    def _recent_context(context: CorrectionContext) -> str:
        lines = [
            "<item>"
            f"<source>{_xml_text(_normalize_source_for_prompt(item.source_text))}</source>"
            f"<target>{_xml_text(item.target_text)}</target>"
            "</item>"
            for item in context.recent_segments[-context.max_revision_segments :]
        ]
        return "\n".join(lines) if lines else ""

    @staticmethod
    def _current_segment_revision_context(context: CorrectionContext) -> str:
        lines = [
            "<item>"
            f"<source>{_xml_text(_normalize_source_for_prompt(item.source_text))}</source>"
            f"<target>{_xml_text(item.target_text)}</target>"
            "</item>"
            for item in context.current_segment_revisions[-context.max_revision_segments :]
        ]
        return "\n".join(lines) if lines else ""

    @staticmethod
    def _telemetry_glossary_missing(target_text: str, context: CorrectionContext) -> None:
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


def _repair_required_glossary_copies(
    target_text: str,
    context: CorrectionContext | None,
) -> tuple[str, dict[str, float]]:
    if context is None or not context.glossary:
        return target_text, {}

    required_terms = [
        (source, target)
        for source, target in context.glossary.items()
        if context.glossary_constraints.get(source, "required") == "required"
        and source.strip()
        and target.strip()
    ]
    if not required_terms:
        return target_text, {}

    repaired_text = target_text
    repaired_count = 0
    missing_count = 0
    for source, target in required_terms:
        if target in repaired_text:
            continue
        repaired_text, repaired = _replace_source_copy_with_target(
            repaired_text,
            source,
            target,
        )
        if repaired and target in repaired_text:
            repaired_count += 1
            continue
        missing_count += 1

    metrics = {
        "glossary_required_terms": float(len(required_terms)),
        "glossary_missing_required_terms": float(missing_count),
    }
    if repaired_count:
        metrics["glossary_repaired_required_terms"] = float(repaired_count)
    return repaired_text, metrics


def _replace_source_copy_with_target(
    text: str,
    source: str,
    target: str,
) -> tuple[str, bool]:
    pattern = re.compile(
        rf"(?<![A-Za-z0-9_]){re.escape(source)}(?![A-Za-z0-9_])",
        re.IGNORECASE,
    )
    repaired, count = pattern.subn(target, text)
    return repaired, count > 0


def _postprocess_target_text(
    target_text: str,
    *,
    source_text: str,
    target_lang: str,
) -> tuple[str, dict[str, float]]:
    processed = target_text.strip()
    metrics: dict[str, float] = {}

    processed, trimmed = _trim_redundant_leading_so_translation(
        processed,
        source_text=source_text,
    )
    if trimmed:
        metrics["target_discourse_marker_trimmed"] = 1.0

    processed, normalized_chars = _normalize_target_locale(processed, target_lang)
    if normalized_chars:
        metrics["target_locale_normalized_chars"] = float(normalized_chars)

    return processed, metrics


def _trim_redundant_leading_so_translation(
    target_text: str,
    *,
    source_text: str,
) -> tuple[str, bool]:
    source = source_text.lstrip()
    if not re.match(r"(?i)^so(?:\s|[,.;:!?])", source):
        return target_text, False
    if re.match(r"(?i)^so\s+that(?:\s|[,.;:!?])", source):
        return target_text, False
    if not target_text.startswith("所以"):
        return target_text, False
    trimmed = target_text.removeprefix("所以").lstrip("，,、 ")
    if not trimmed:
        return target_text, False
    return trimmed, True


def _normalize_target_locale(text: str, target_lang: str) -> tuple[str, int]:
    if not _is_simplified_chinese_target(target_lang):
        return text, 0
    normalized_chars = sum(1 for char in text if char in _ZH_CN_CHAR_MAP)
    if normalized_chars == 0:
        return text, 0
    return text.translate(_ZH_CN_TRANSLATION_TABLE), normalized_chars


def _is_simplified_chinese_target(target_lang: str) -> bool:
    normalized = target_lang.lower().replace("_", "-")
    return normalized in {"zh", "zh-cn", "zh-hans", "zh-hans-cn"}


def _normalize_source_for_prompt(text: str) -> str:
    normalized = text.strip()
    if not normalized:
        return normalized
    normalized = re.sub(r"\b([A-Za-z]+)\s+'\s*([A-Za-z]+)\b", r"\1'\2", normalized)
    normalized = re.sub(r"\s+([,.;:!?])", r"\1", normalized)
    normalized = re.sub(r"([(\[])\s+", r"\1", normalized)
    normalized = re.sub(r"\s+([)\]])", r"\1", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return _repair_known_asr_word_splits(normalized)


def _repair_known_asr_word_splits(text: str) -> str:
    repairs = {
        "c ider": "cider",
        "C ider": "Cider",
    }
    repaired = text
    for source, target in repairs.items():
        repaired = repaired.replace(source, target)
    return repaired


_ZH_CN_CHAR_MAP = {
    "國": "国",
    "們": "们",
    "這": "这",
    "裡": "里",
    "裏": "里",
    "來": "来",
    "時": "时",
    "會": "会",
    "個": "个",
    "說": "说",
    "對": "对",
    "讓": "让",
    "從": "从",
    "學": "学",
    "類": "类",
    "實": "实",
    "體": "体",
    "開": "开",
    "關": "关",
    "經": "经",
    "濟": "济",
    "業": "业",
    "遊": "游",
    "觀": "观",
    "樂": "乐",
    "聽": "听",
    "標": "标",
    "錄": "录",
    "語": "语",
    "顯": "显",
    "應": "应",
    "該": "该",
    "風": "风",
    "區": "区",
    "歡": "欢",
    "愛": "爱",
    "飲": "饮",
}
_ZH_CN_TRANSLATION_TABLE = str.maketrans(_ZH_CN_CHAR_MAP)


def _default_client_factory(*, api_key: str, base_url: str) -> Any:
    from openai import AsyncOpenAI

    return AsyncOpenAI(api_key=api_key, base_url=base_url)


def _combine_prefix_completion(prefix: str, completion: str) -> str:
    prefix = prefix.strip()
    if not prefix:
        return completion.strip()
    if not completion:
        return prefix
    if completion.startswith(prefix):
        return completion.strip()
    return f"{prefix}{completion}".strip()


def _source_closes_sentence(text: str) -> bool:
    return text.rstrip().endswith((".", "?", "!", "。", "？", "！"))


def _target_closes_sentence(text: str) -> bool:
    return _source_closes_sentence(text)


def _usage_metrics(usage: object | None) -> dict[str, float]:
    if usage is None:
        return {}

    hit = _usage_value(usage, "prompt_cache_hit_tokens")
    miss = _usage_value(usage, "prompt_cache_miss_tokens")
    metrics: dict[str, float] = {}
    if hit is not None:
        metrics["prompt_cache_hit_tokens"] = float(hit)
    if miss is not None:
        metrics["prompt_cache_miss_tokens"] = float(miss)
    return metrics


def _usage_value(usage: object, key: str) -> object | None:
    if isinstance(usage, dict):
        return usage.get(key)
    return getattr(usage, key, None)


def should_flush_streaming_target(
    *,
    previous_text: str,
    next_text: str,
    is_final: bool = False,
) -> bool:
    """判断流式译文是否值得发布给字幕层。

    中文模型常按单字 token 返回；逐 token 发布会让字幕窗一字一刷。
    这里按可见字符数和标点做轻量合帧，最终译文由 stream 结束时强制 flush。
    """
    return DEFAULT_TEXT_EMISSION_POLICY.should_emit_target(
        previous_text=previous_text,
        next_text=next_text,
        is_final=is_final,
    )
