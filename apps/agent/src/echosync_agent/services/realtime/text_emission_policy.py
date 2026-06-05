from __future__ import annotations

from dataclasses import dataclass

DEFAULT_SOURCE_CJK_MIN_CHARS = 4
DEFAULT_TARGET_MIN_INITIAL_CHARS = 6
DEFAULT_TARGET_MIN_DELTA_CHARS = 6
DEFAULT_TARGET_FLUSH_PUNCTUATION = "。！？!?，,；;：:"


@dataclass(frozen=True, slots=True)
class TextEmissionPolicy:
    """控制流式文本何时值得发给字幕层。

    模型内部可以继续按 token 流式处理，但 UI 事件必须按可读短语发射。
    """

    source_cjk_min_chars: int = DEFAULT_SOURCE_CJK_MIN_CHARS
    target_min_initial_chars: int = DEFAULT_TARGET_MIN_INITIAL_CHARS
    target_min_delta_chars: int = DEFAULT_TARGET_MIN_DELTA_CHARS
    target_flush_punctuation: str = DEFAULT_TARGET_FLUSH_PUNCTUATION

    def should_hold_source_partial(
        self,
        *,
        current_text: str,
        last_emitted_text: str,
        is_final: bool = False,
    ) -> bool:
        if is_final:
            return False

        current_text = current_text.strip()
        if not current_text:
            return True

        delta = _tail_delta(current_text, last_emitted_text)
        if not delta:
            return True

        visible_chars = _visible_chars(delta)
        if len(visible_chars) >= self.source_cjk_min_chars:
            return False

        cjk_chars = [char for char in visible_chars if _is_cjk(char)]
        return len(cjk_chars) == len(visible_chars) and len(cjk_chars) > 0

    def should_emit_target(
        self,
        *,
        previous_text: str,
        next_text: str,
        is_final: bool = False,
    ) -> bool:
        next_text = next_text.strip()
        previous_text = previous_text.strip()
        if not next_text:
            return False
        if is_final:
            return True
        if next_text.endswith(tuple(self.target_flush_punctuation)):
            return True
        if not previous_text:
            return _display_char_count(next_text) >= self.target_min_initial_chars
        if not next_text.startswith(previous_text):
            return True

        delta = next_text[len(previous_text) :]
        return _display_char_count(delta) >= self.target_min_delta_chars


DEFAULT_TEXT_EMISSION_POLICY = TextEmissionPolicy()


def _tail_delta(current_text: str, last_emitted_text: str) -> str:
    if last_emitted_text and current_text.startswith(last_emitted_text):
        return current_text[len(last_emitted_text) :].strip()
    return current_text


def _visible_chars(value: str) -> list[str]:
    return [char for char in value if not char.isspace()]


def _display_char_count(value: str) -> int:
    return len(_visible_chars(value))


def _is_cjk(char: str) -> bool:
    return "\u4e00" <= char <= "\u9fff"
