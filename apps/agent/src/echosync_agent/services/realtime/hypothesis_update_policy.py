from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

HypothesisUpdateMode = Literal["append_delta", "replace_hypothesis"]


@dataclass(frozen=True, slots=True)
class HypothesisUpdate:
    text: str
    mode: HypothesisUpdateMode


class HypothesisUpdatePolicy:
    """识别 ASR 输入是增量 delta 还是滚动完整 hypothesis。

    不同供应商的 streaming ASR 契约不同：有的只吐新增 delta，有的每次吐
    一整段滚动候选。这里把差异收敛在 ASR 组装层入口。
    """

    def apply(self, *, current_text: str, incoming_text: str) -> HypothesisUpdate:
        current_text = current_text.strip()
        incoming_raw = incoming_text
        incoming_trimmed = incoming_text.strip()
        if not incoming_trimmed:
            return HypothesisUpdate(text=current_text, mode="replace_hypothesis")
        if not current_text:
            return HypothesisUpdate(text=incoming_trimmed, mode="replace_hypothesis")
        if incoming_trimmed.startswith(current_text):
            return HypothesisUpdate(text=incoming_trimmed, mode="replace_hypothesis")
        if _has_meaningful_common_prefix(current_text, incoming_trimmed):
            return HypothesisUpdate(text=incoming_trimmed, mode="replace_hypothesis")
        if _looks_like_append_delta(current_text=current_text, incoming_text=incoming_raw):
            return HypothesisUpdate(
                text=f"{current_text}{_append_delta_text(current_text, incoming_raw)}",
                mode="append_delta",
            )
        return HypothesisUpdate(text=incoming_trimmed, mode="replace_hypothesis")


DEFAULT_HYPOTHESIS_UPDATE_POLICY = HypothesisUpdatePolicy()


def _looks_like_append_delta(*, current_text: str, incoming_text: str) -> bool:
    if not incoming_text:
        return False
    if incoming_text[0].isspace() or incoming_text[0] in ",.!?;:，。！？；：":
        return True
    if _needs_space_before_bare_latin_delta(current_text, incoming_text):
        return True
    return " " not in incoming_text and " " not in current_text


def _append_delta_text(current_text: str, incoming_text: str) -> str:
    if _needs_space_before_bare_latin_delta(current_text, incoming_text):
        return f" {incoming_text.strip()}"
    return incoming_text


def _needs_space_before_bare_latin_delta(current_text: str, incoming_text: str) -> bool:
    incoming_trimmed = incoming_text.strip()
    if not incoming_trimmed or incoming_text[0].isspace():
        return False
    if not _is_latin_word(incoming_trimmed):
        return False
    if not current_text or current_text[-1].isspace():
        return False
    if not _has_latin_word_separator(current_text):
        return False
    return current_text[-1].isalnum() or current_text[-1] in ",;:!?"


def _is_latin_word(value: str) -> bool:
    return all(char.isascii() and (char.isalnum() or char in "'-") for char in value)


def _has_latin_word_separator(value: str) -> bool:
    return any(char.isspace() or char in ",;:!?" for char in value)


def _has_meaningful_common_prefix(left: str, right: str) -> bool:
    prefix_len = 0
    for left_char, right_char in zip(left.casefold(), right.casefold(), strict=False):
        if left_char != right_char:
            break
        prefix_len += 1
    return prefix_len >= min(4, len(left), len(right))
