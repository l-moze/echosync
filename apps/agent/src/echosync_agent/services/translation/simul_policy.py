from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

from echosync_agent.domain import SegmentStatus, TranscriptSegment, TranslationSegment


class SimulPolicyAction(StrEnum):
    WAIT = "WAIT"
    DRAFT = "DRAFT"
    COMMIT = "COMMIT"
    REVISE = "REVISE"


@dataclass(frozen=True, slots=True)
class SimulPolicyDecision:
    action: SimulPolicyAction
    reason: str
    confidence: float
    source_span_end: int


class SimulTranslationPolicy:
    """Rules-first simultaneous translation policy.

    This is an application-layer approximation of the source/draft/policy stream
    split. It avoids extra LLM calls and keeps committed subtitles/TTS unchanged.
    """

    def should_translate(
        self,
        transcript: TranscriptSegment,
        *,
        previous_revision: TranslationSegment | None = None,
    ) -> SimulPolicyDecision:
        text = transcript.text.strip()
        if transcript.status == SegmentStatus.COMMITTED:
            return _decision(SimulPolicyAction.COMMIT, "source_committed", text, 1.0)

        if previous_revision is not None and _is_rewrite(
            previous_revision.source_text,
            text,
        ):
            return _decision(SimulPolicyAction.REVISE, "source_rewrite", text, 0.82)

        if transcript.status == SegmentStatus.PARTIAL:
            return _decision(SimulPolicyAction.DRAFT, "partial_experiment_enabled", text, 0.58)

        if _has_boundary(text):
            return _decision(SimulPolicyAction.DRAFT, "weak_boundary", text, 0.82)

        if _has_suspended_tail(text, transcript.source_lang):
            return _decision(SimulPolicyAction.WAIT, "suspended_tail", text, 0.74)

        return _decision(SimulPolicyAction.DRAFT, "stable_source", text, 0.7)

    def classify_translation(
        self,
        translation: TranslationSegment,
        *,
        previous_revision: TranslationSegment | None = None,
    ) -> SimulPolicyDecision:
        text = translation.source_text.strip()
        if translation.status == SegmentStatus.COMMITTED:
            return _decision(SimulPolicyAction.COMMIT, "translation_committed", text, 1.0)

        if previous_revision is not None and _is_rewrite(
            previous_revision.source_text,
            text,
        ):
            return _decision(SimulPolicyAction.REVISE, "source_rewrite", text, 0.82)

        return _decision(SimulPolicyAction.DRAFT, "translation_draft", text, 0.68)


def simul_action_code(action: SimulPolicyAction) -> float:
    return {
        SimulPolicyAction.WAIT: 0.0,
        SimulPolicyAction.DRAFT: 1.0,
        SimulPolicyAction.COMMIT: 2.0,
        SimulPolicyAction.REVISE: 3.0,
    }[action]


def _decision(
    action: SimulPolicyAction,
    reason: str,
    source_text: str,
    confidence: float,
) -> SimulPolicyDecision:
    return SimulPolicyDecision(
        action=action,
        reason=reason,
        confidence=confidence,
        source_span_end=len(source_text.strip()),
    )


def _is_rewrite(previous_source: str, current_source: str) -> bool:
    previous = previous_source.strip()
    current = current_source.strip()
    return bool(previous and current and not current.startswith(previous))


def _has_boundary(text: str) -> bool:
    return text.rstrip().endswith((",", "，", ";", "；", ":", "："))


def _has_suspended_tail(text: str, language: str) -> bool:
    if _is_cjk_language_or_text(text, language):
        return False
    words = _latin_words(text)
    if not words:
        return True
    tail = words[-1].lower()
    return tail in _SUSPENDED_LATIN_TAILS


def _latin_words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", text)


def _is_cjk_language_or_text(text: str, language: str) -> bool:
    normalized = language.lower()
    if normalized.startswith("zh") or normalized in {"ja", "ko"}:
        return True
    return any("\u4e00" <= char <= "\u9fff" for char in text)


_SUSPENDED_LATIN_TAILS = frozenset(
    {
        "a",
        "an",
        "the",
        "of",
        "to",
        "for",
        "with",
        "in",
        "on",
        "at",
        "by",
        "from",
        "about",
        "into",
        "onto",
        "as",
        "than",
        "that",
        "which",
        "who",
        "when",
        "where",
        "why",
        "how",
        "because",
        "if",
        "while",
        "although",
        "though",
        "unless",
        "until",
        "and",
        "or",
        "but",
        "so",
    }
)
