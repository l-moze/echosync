from __future__ import annotations

COMMON_SHORT_LATIN_WORDS = frozenset(
    {
        "a",
        "am",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "but",
        "by",
        "can",
        "do",
        "for",
        "go",
        "he",
        "if",
        "in",
        "is",
        "it",
        "me",
        "my",
        "no",
        "not",
        "now",
        "of",
        "on",
        "or",
        "our",
        "out",
        "so",
        "the",
        "to",
        "up",
        "us",
        "we",
        "will",
        "you",
    }
)

LATIN_CONTINUATION_PREFIXES = (
    "abil",
    "able",
    "ally",
    "ant",
    "ation",
    "ed",
    "ent",
    "er",
    "est",
    "ful",
    "ibility",
    "ication",
    "ing",
    "ise",
    "ism",
    "ist",
    "ity",
    "ive",
    "ize",
    "less",
    "ly",
    "ment",
    "ness",
    "ous",
    "sion",
    "tion",
)


def should_join_latin_word_continuation(base_text: str, incoming_text: str) -> bool:
    """Detect ASR deltas that are likely fragments of the current Latin word."""

    base = base_text.rstrip()
    incoming = incoming_text.strip()
    if not base or not incoming:
        return False
    if not _is_latin_word(incoming):
        return False
    if not incoming[0].islower():
        return False
    if not (base[-1].isascii() and base[-1].isalpha()):
        return False

    last_word = _last_latin_word(base)
    if len(last_word) < 4:
        return False

    lowered = incoming.lower()
    if lowered in COMMON_SHORT_LATIN_WORDS:
        return False
    if len(lowered) <= 3:
        return True
    return lowered.startswith(LATIN_CONTINUATION_PREFIXES)


def _last_latin_word(text: str) -> str:
    index = len(text) - 1
    while index >= 0 and text[index].isascii() and (text[index].isalnum() or text[index] in "'-"):
        index -= 1
    return text[index + 1 :]


def _is_latin_word(value: str) -> bool:
    return all(char.isascii() and (char.isalnum() or char in "'-") for char in value)
