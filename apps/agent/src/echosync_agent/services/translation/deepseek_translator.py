from __future__ import annotations

import logging
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

        # 术语缺失埋点（非阻塞）
        self._telemetry_glossary_missing(target_text.strip(), context)

        return self._build_segment(segment, target_text.strip(), metrics=metrics)

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
            if should_flush_streaming_target(
                previous_text=last_published_target,
                next_text=stripped_target,
            ):
                last_published_target = stripped_target
                last_published_metrics = dict(metrics)
                yield self._build_segment(segment, stripped_target, metrics=metrics)

        final_target = _combine_prefix_completion(prefix, target_text)
        final_has_new_metrics = metrics != last_published_metrics
        if first_delta_ms is None:
            metrics.update(
                {
                    "deepseek_delta_count": 0.0,
                    "deepseek_prefix_chars": float(len(prefix)),
                    "deepseek_prompt_chars": float(prompt_chars),
                    "deepseek_stream_open_ms": stream_open_ms,
                }
            )
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
                next_text=final_target,
                is_final=True,
            )
            and (final_target != last_published_target or final_has_new_metrics)
        ):
            yield self._build_segment(segment, final_target, metrics=metrics)

        self._telemetry_glossary_missing(final_target, context)

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
    ) -> TranslationSegment:
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
            metrics=metrics or {},
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

        source_block = f"\n<source>{_xml_text(source_text)}</source>"
        result = f"{context_block}{current_segment_block}{glossary_block}{source_block}"
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
    def _current_segment_revision_context(context: CorrectionContext) -> str:
        lines = [
            "<item>"
            f"<source>{_xml_text(item.source_text)}</source>"
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
