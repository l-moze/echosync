from __future__ import annotations

import re
from dataclasses import replace

from echosync_agent.domain import TranslationSegment

_BOUNDARY_RE = re.compile(r"([^，,。！？!?；;：:\n]+[，,。！？!?；;：:\n]*|\n+)")
_TRAILING_PUNCTUATION = "，,。！？!?；;：:"
_SPLIT_PUNCTUATION = "，,。！？!?；;：:"


class TtsUtteranceSplitter:
    """把长译文拆成更适合同传播报的小句。"""

    def __init__(self, *, max_chars: int = 42, min_chars: int = 8) -> None:
        self.max_chars = max(max_chars, 12)
        self.min_chars = max(min_chars, 1)

    def split(self, segment: TranslationSegment) -> tuple[TranslationSegment, ...]:
        parts = _split_text(segment.target_text, self.max_chars, self.min_chars)
        if len(parts) <= 1:
            return (segment,)

        total_chars = sum(max(len(part), 1) for part in parts)
        duration_ms = max(segment.end_ms - segment.start_ms, len(parts))
        offset_ms = segment.start_ms
        utterances: list[TranslationSegment] = []

        for index, part in enumerate(parts):
            if index == len(parts) - 1:
                end_ms = segment.end_ms
            else:
                share = max(len(part), 1) / total_chars
                end_ms = min(segment.end_ms, offset_ms + max(round(duration_ms * share), 1))
            utterances.append(
                replace(
                    segment,
                    segment_id=f"{segment.segment_id}_tts{index + 1:02d}",
                    start_ms=offset_ms,
                    end_ms=end_ms,
                    target_text=part,
                    metrics={
                        **segment.metrics,
                        "tts_utterance_index": float(index + 1),
                        "tts_utterance_count": float(len(parts)),
                    },
                )
            )
            offset_ms = end_ms

        return tuple(utterances)


def _split_text(text: str, max_chars: int, min_chars: int) -> tuple[str, ...]:
    normalized = _normalize_tts_text(text)
    if not normalized:
        return ()
    if len(normalized) <= max_chars:
        return (normalized,)

    raw_parts = _rough_split(normalized, max_chars)
    parts: list[str] = []
    pending = ""
    for raw in raw_parts:
        if not raw:
            continue
        if not pending:
            pending = raw
            continue
        if not _ends_with_split_boundary(pending) and (
            len(pending) < min_chars or len(pending) + len(raw) <= max_chars
        ):
            pending = _join_parts(pending, raw)
            continue
        parts.append(pending)
        pending = raw
    if pending:
        parts.append(pending)

    return tuple(parts or (normalized,))


def _rough_split(text: str, max_chars: int) -> list[str]:
    parts: list[str] = []
    for match in _BOUNDARY_RE.finditer(text):
        piece = match.group(0).strip()
        if not piece:
            continue
        parts.extend(_split_long_piece(piece, max_chars))
    return parts


def _split_long_piece(piece: str, max_chars: int) -> list[str]:
    if len(piece) <= max_chars:
        return [piece]

    chunks: list[str] = []
    current = piece
    while len(current) > max_chars:
        cut = _best_cut(current, max_chars)
        chunks.append(current[:cut].strip())
        current = current[cut:].strip()
    if current:
        chunks.append(current)
    return chunks


def _best_cut(text: str, max_chars: int) -> int:
    soft_limit = min(max_chars, len(text))
    candidates = [
        text.rfind(" ", 0, soft_limit + 1),
        text.rfind("、", 0, soft_limit + 1),
        text.rfind("/", 0, soft_limit + 1),
    ]
    cut = max(candidates)
    if cut >= max_chars // 2:
        return cut + 1
    return soft_limit


def _join_parts(left: str, right: str) -> str:
    if not left:
        return right
    if not right:
        return left
    if left[-1].isascii() and right[0].isascii() and left[-1] not in _TRAILING_PUNCTUATION:
        return f"{left} {right}"
    return f"{left}{right}"


def _normalize_tts_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _ends_with_split_boundary(text: str) -> bool:
    return text.rstrip().endswith(tuple(_SPLIT_PUNCTUATION))
