from __future__ import annotations

import re
from dataclasses import dataclass

from echosync_agent.domain import SegmentStatus


BOUNDARY_PUNCTUATION = ".,!?;:，。！？；："
DEFAULT_CJK_UNSTABLE_CHARS = 6
DEFAULT_LATIN_UNSTABLE_TOKENS = 3


@dataclass(frozen=True, slots=True)
class TextRegions:
    full_text: str
    stable_text: str
    unstable_text: str


def split_realtime_text(
    text: str,
    *,
    status: SegmentStatus,
    language: str,
) -> TextRegions:
    full_text = text.strip()
    if not full_text:
        return TextRegions(full_text="", stable_text="", unstable_text="")

    if status == SegmentStatus.COMMITTED or full_text.endswith(tuple(BOUNDARY_PUNCTUATION)):
        return TextRegions(full_text=full_text, stable_text=full_text, unstable_text="")

    if _is_cjk_text(full_text, language):
        return _split_cjk(full_text)

    return _split_latin(full_text)


def _split_cjk(text: str) -> TextRegions:
    chars = list(text)
    if len(chars) <= DEFAULT_CJK_UNSTABLE_CHARS:
        return TextRegions(full_text=text, stable_text="", unstable_text=text)

    split_at = len(chars) - DEFAULT_CJK_UNSTABLE_CHARS
    return TextRegions(
        full_text=text,
        stable_text="".join(chars[:split_at]),
        unstable_text="".join(chars[split_at:]),
    )


def _split_latin(text: str) -> TextRegions:
    tokens = list(re.finditer(r"\S+", text))
    if len(tokens) <= DEFAULT_LATIN_UNSTABLE_TOKENS:
        return TextRegions(full_text=text, stable_text="", unstable_text=text)

    split_at = tokens[-DEFAULT_LATIN_UNSTABLE_TOKENS].start()
    return TextRegions(
        full_text=text,
        stable_text=text[:split_at].rstrip(),
        unstable_text=text[split_at:].lstrip(),
    )


def _is_cjk_text(text: str, language: str) -> bool:
    normalized_language = language.lower()
    if normalized_language.startswith("zh") or normalized_language in {"ja", "ko"}:
        return True
    return any("\u4e00" <= char <= "\u9fff" for char in text)

