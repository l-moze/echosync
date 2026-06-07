from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, replace
from typing import Any, Literal

from echosync_agent.domain import CorrectionContext, SegmentStatus, TranslationSegment
from echosync_agent.interfaces import TranslationRepairEngine
from echosync_agent.services.translation.deepseek_translator import (
    THINKING_DISABLED,
    ClientFactory,
    _default_client_factory,
    _normalize_source_for_prompt,
    _postprocess_target_text,
    _repair_required_glossary_copies,
    _usage_metrics,
    _xml_attr,
    _xml_text,
)

logger = logging.getLogger(__name__)

RepairMode = Literal["suspect_only", "debug_all"]


@dataclass(frozen=True, slots=True)
class TranslationRepairDecision:
    should_repair: bool
    reason: str = ""


class SemanticTranslationRepairPolicy:
    """Decides whether a committed subtitle deserves slow semantic repair."""

    def __init__(self, mode: RepairMode = "suspect_only") -> None:
        self.mode = mode

    def decide(self, segment: TranslationSegment) -> TranslationRepairDecision:
        source = segment.source_text.strip()
        target = segment.target_text.strip()
        if not source or not target:
            return TranslationRepairDecision(False, "empty_text")
        if segment.status != SegmentStatus.COMMITTED:
            return TranslationRepairDecision(False, "not_committed")
        if self.mode == "debug_all":
            return TranslationRepairDecision(True, "debug_all")

        reasons: list[str] = []
        metrics = segment.metrics
        if metrics.get("glossary_missing_required_terms", 0.0) > 0:
            reasons.append("glossary_missing")
        if metrics.get("target_locale_normalized_chars", 0.0) > 0:
            reasons.append("locale_normalized")
        if metrics.get("target_discourse_marker_trimmed", 0.0) > 0:
            reasons.append("discourse_marker")
        if _has_asr_artifact(source):
            reasons.append("asr_artifact")
        if _looks_like_fragment(source):
            reasons.append("source_fragment")
        if _looks_like_target_artifact(source, target):
            reasons.append("target_artifact")
        if _length_ratio_is_suspicious(source, target):
            reasons.append("length_ratio")

        if reasons:
            return TranslationRepairDecision(True, ",".join(reasons[:4]))
        return TranslationRepairDecision(False, "clean")


class DeepSeekTranslationRepairEngine(TranslationRepairEngine):
    """DeepSeek-backed committed subtitle semantic repair."""

    def __init__(
        self,
        *,
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

    async def repair(
        self,
        segment: TranslationSegment,
        context: CorrectionContext,
        *,
        reason: str = "",
    ) -> TranslationSegment | None:
        started_at = time.perf_counter()
        client = self._client_for_base_url(self.base_url)
        response = await client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": self._system_prompt()},
                {"role": "user", "content": self._user_prompt(segment, context, reason)},
            ],
            temperature=0.0,
            extra_body=THINKING_DISABLED,
        )
        raw_target = _plain_repair_text(response.choices[0].message.content or "")
        if not raw_target:
            return None

        target_text, cleanup_metrics = _postprocess_target_text(
            raw_target,
            source_text=segment.source_text,
            target_lang=self.target_lang,
        )
        target_text, glossary_metrics = _repair_required_glossary_copies(
            target_text,
            context,
        )
        if not target_text or target_text == segment.target_text.strip():
            return None

        usage_metrics = _usage_metrics(getattr(response, "usage", None))
        latency_ms = (time.perf_counter() - started_at) * 1000
        changed_chars = _changed_char_count(segment.target_text, target_text)
        logger.info(
            "translation_semantic_repair_model_finished session_id=%s segment_id=%s "
            "base_rev=%d latency_ms=%.1f changed_chars=%d reason=%s",
            segment.session_id,
            segment.segment_id,
            segment.rev,
            latency_ms,
            changed_chars,
            reason or "unspecified",
        )
        return replace(
            segment,
            rev=segment.rev + 1,
            target_text=target_text,
            status=SegmentStatus.COMMITTED,
            stability=1.0,
            target_stable_text=target_text,
            target_unstable_text="",
            metrics={
                **segment.metrics,
                **usage_metrics,
                **cleanup_metrics,
                **glossary_metrics,
                "semantic_revision_latency_ms": latency_ms,
                "semantic_revision_changed_chars": float(changed_chars),
                "semantic_revision_trigger_count": float(
                    len([item for item in reason.split(",") if item])
                ),
            },
        )

    def _client_for_base_url(self, base_url: str) -> Any:
        if base_url not in self._clients:
            self._clients[base_url] = self._client_factory(
                api_key=self.api_key,
                base_url=base_url,
            )
        return self._clients[base_url]

    def _system_prompt(self) -> str:
        return (
            "You are EchoSync's live subtitle translation repair editor. "
            f"Repair the current subtitle translation into {self.target_lang}. "
            "Use the source text, recent context, current translation, and glossary. "
            "Preserve the source meaning exactly; do not summarize, expand, merge, or "
            "add information. "
            "For zh-CN, output natural Simplified Chinese with idiomatic spoken Mandarin "
            "word order. Avoid Traditional Chinese characters. "
            "For fragmented ASR text, infer only the minimal continuation that is clear "
            "from recent context. "
            "Honor required glossary translations exactly. "
            "If the current translation is already correct, return it unchanged. "
            "Return only the corrected subtitle text, with no JSON, tags, notes, or quotes."
        )

    def _user_prompt(
        self,
        segment: TranslationSegment,
        context: CorrectionContext,
        reason: str,
    ) -> str:
        recent_block = _recent_context_block(context)
        glossary_block = _glossary_block(context)
        reason_block = f"\n<repair_reason>{_xml_text(reason)}</repair_reason>" if reason else ""
        return (
            f"{recent_block}"
            f"{glossary_block}"
            f"{reason_block}\n"
            "<current>\n"
            f"<source>{_xml_text(_normalize_source_for_prompt(segment.source_text))}</source>\n"
            f"<translation>{_xml_text(segment.target_text)}</translation>\n"
            "</current>"
        )


def _recent_context_block(context: CorrectionContext) -> str:
    lines = [
        "<item>"
        f"<source>{_xml_text(_normalize_source_for_prompt(item.source_text))}</source>"
        f"<target>{_xml_text(item.target_text)}</target>"
        "</item>"
        for item in context.recent_segments[-context.max_revision_segments :]
    ]
    if not lines:
        return ""
    return "\n<recent_segments>\n" + "\n".join(lines) + "\n</recent_segments>"


def _glossary_block(context: CorrectionContext) -> str:
    if not context.glossary:
        return ""
    lines = []
    for source, target in context.glossary.items():
        constraint = context.glossary_constraints.get(source, "required")
        lines.append(
            f'  <term source="{_xml_attr(source)}" target="{_xml_attr(target)}" '
            f'constraint="{_xml_attr(constraint)}"/>'
        )
    return "\n<glossary>\n" + "\n".join(lines) + "\n</glossary>"


def _plain_repair_text(content: str) -> str:
    text = content.strip()
    if not text:
        return ""
    if text.startswith("```"):
        text = re.sub(r"^```(?:json|text)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text).strip()
    if text.startswith("{"):
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, dict):
            for key in ("translation", "target", "text", "corrected_translation"):
                value = parsed.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
    if _is_wrapped_quote(text):
        text = text[1:-1].strip()
    return text


def _is_wrapped_quote(text: str) -> bool:
    if len(text) < 2:
        return False
    pairs = {
        '"': '"',
        "'": "'",
        "“": "”",
        "‘": "’",
    }
    return pairs.get(text[0]) == text[-1]


def _has_asr_artifact(source: str) -> bool:
    return bool(
        re.search(r"\b[A-Za-z]+\s+'\s*[A-Za-z]+\b", source)
        or re.search(r"\b[cC]\s+ider\b", source)
    )


def _looks_like_fragment(source: str) -> bool:
    text = source.strip()
    if not text:
        return False
    lower = text.lower()
    if lower.startswith(("and ", "or ", "but ", "unless ")):
        return True
    if text.startswith(("a ", "an ")):
        return True
    if lower.startswith(("here unless", "like this", "a sunny day")):
        return True
    first = text[0]
    return first.islower() and len(text.split()) >= 4


def _looks_like_target_artifact(source: str, target: str) -> bool:
    stripped = target.lstrip()
    if stripped.startswith(("所以所以", "像这个一 样", "真的很不错天气")):
        return True
    if "的里" in stripped or "下 班" in stripped:
        return True
    source_lower = source.lower()
    if (
        source_lower.startswith("so ")
        and not source_lower.startswith("so that ")
        and stripped.startswith("所以")
    ):
        return True
    return False


def _length_ratio_is_suspicious(source: str, target: str) -> bool:
    source_words = len(re.findall(r"[A-Za-z0-9]+", source))
    target_chars = len([char for char in target if char.strip()])
    if source_words < 8 or target_chars == 0:
        return False
    return target_chars < max(4, source_words // 2) or target_chars > source_words * 6


def _changed_char_count(old: str, new: str) -> int:
    shared = min(len(old), len(new))
    changed = abs(len(old) - len(new))
    changed += sum(1 for index in range(shared) if old[index] != new[index])
    return changed
