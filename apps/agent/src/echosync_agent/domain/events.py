from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Literal
from uuid import uuid4


def new_segment_id() -> str:
    return f"seg_{uuid4().hex[:12]}"


class SegmentStatus(StrEnum):
    PARTIAL = "partial"
    STABLE = "stable"
    COMMITTED = "committed"


PatchOperation = Literal["insert", "replace", "delete"]


@dataclass(frozen=True, slots=True)
class AudioFrame:
    """Transport-neutral audio frame contract.

    LiveKit, WebSocket, file replay, and future native realtime providers should all adapt
    their audio into this shape before entering the interpretation pipeline.
    """

    session_id: str
    seq: int
    pcm: bytes
    sample_rate: int
    channels: int
    start_ms: int
    end_ms: int
    source_lang: str = "auto"


@dataclass(frozen=True, slots=True)
class TranscriptSegment:
    session_id: str
    segment_id: str
    rev: int
    start_ms: int
    end_ms: int
    source_lang: str
    text: str
    status: SegmentStatus
    stability: float
    speaker: str | None = None


@dataclass(frozen=True, slots=True)
class TranslationSegment:
    session_id: str
    segment_id: str
    rev: int
    source_rev: int
    start_ms: int
    end_ms: int
    source_lang: str
    target_lang: str
    source_text: str
    target_text: str
    status: SegmentStatus
    stability: float
    speaker: str | None = None


@dataclass(frozen=True, slots=True)
class CorrectionContext:
    """Bounded context passed to correction strategies."""

    recent_segments: tuple[TranslationSegment, ...]
    glossary: dict[str, str] = field(default_factory=dict)
    max_revision_segments: int = 2


@dataclass(frozen=True, slots=True)
class SubtitlePatchOperation:
    op: PatchOperation
    text: str = ""
    at_char: int | None = None
    from_char: int | None = None
    to_char: int | None = None


@dataclass(frozen=True, slots=True)
class SubtitlePatch:
    session_id: str
    segment_id: str
    rev: int
    base_rev: int
    target_lang: str
    operations: tuple[SubtitlePatchOperation, ...]
    reason: str
    stability: float


@dataclass(frozen=True, slots=True)
class SegmentCommit:
    session_id: str
    segment_id: str
    rev: int
    start_ms: int
    end_ms: int
    source_lang: str
    target_lang: str
    source_text: str
    target_text: str
    speaker: str | None = None
    final: bool = True
