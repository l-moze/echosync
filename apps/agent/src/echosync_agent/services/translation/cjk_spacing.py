from __future__ import annotations


def normalize_target_cjk_spacing_metrics(
    text: str,
    *,
    target_lang: str,
) -> tuple[str, dict[str, float]]:
    normalized, removed_chars = normalize_cjk_spacing(text, target_lang)
    if not removed_chars:
        return normalized, {}
    return normalized, {"target_cjk_spacing_removed_chars": float(removed_chars)}


def normalize_cjk_spacing(text: str, target_lang: str) -> tuple[str, int]:
    if not _is_cjk_spacing_target(target_lang) or not text:
        return text, 0

    output: list[str] = []
    removed_chars = 0
    index = 0
    while index < len(text):
        char = text[index]
        if char.isspace():
            whitespace_start = index
            while index < len(text) and text[index].isspace():
                index += 1
            previous = output[-1] if output else ""
            next_char = text[index] if index < len(text) else ""
            if _should_remove_cjk_space(previous, next_char):
                removed_chars += index - whitespace_start
                continue
            output.append(" " if index - whitespace_start == 1 else text[whitespace_start:index])
            continue
        output.append(char)
        index += 1

    return "".join(output), removed_chars


def _should_remove_cjk_space(previous: str, next_char: str) -> bool:
    if not previous or not next_char:
        return False
    if _is_cjk_compact_boundary(previous) and _is_cjk_compact_boundary(next_char):
        return True
    if _is_cjk_letter(previous) and _is_cjk_punctuation(next_char):
        return True
    if _is_cjk_punctuation(previous) and _is_cjk_letter(next_char):
        return True
    return False


def _is_cjk_spacing_target(target_lang: str) -> bool:
    normalized = target_lang.lower().replace("_", "-")
    return (
        normalized.startswith("zh")
        or normalized.startswith("ja")
        or normalized.startswith("ko")
    )


def _is_cjk_compact_boundary(char: str) -> bool:
    return _is_cjk_letter(char) or _is_cjk_punctuation(char)


def _is_cjk_letter(char: str) -> bool:
    return (
        "\u3400" <= char <= "\u4dbf"
        or "\u4e00" <= char <= "\u9fff"
        or "\u3040" <= char <= "\u309f"
        or "\u30a0" <= char <= "\u30ff"
        or "\uac00" <= char <= "\ud7af"
        or "\u1100" <= char <= "\u11ff"
        or "\u3130" <= char <= "\u318f"
    )


def _is_cjk_punctuation(char: str) -> bool:
    return char in _CJK_SPACING_PUNCTUATION


_CJK_SPACING_PUNCTUATION = set(
    "，。！？；：、（）《》〈〉【】『』「」“”‘’…—～·￥"
    ",.!?;:()[]{}<>"
)
