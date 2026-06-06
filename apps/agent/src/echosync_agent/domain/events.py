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


class ModelMode(StrEnum):
    CASCADED = "cascaded"
    END_TO_END = "end_to_end"


class ModelCapability(StrEnum):
    ASR = "asr"
    TRANSLATION = "translation"
    CORRECTION = "correction"
    TTS = "tts"
    SPEECH_TRANSLATION = "speech_translation"


class AudioSourceKind(StrEnum):
    MICROPHONE = "microphone"
    WINDOWS_SYSTEM = "windows_system"
    MIXED = "mixed"
    FILE = "file"
    NETWORK_STREAM = "network_stream"


PatchOperation = Literal["insert", "replace", "delete"]


@dataclass(frozen=True, slots=True)
class AudioFrame:
    """与传输层无关的音频帧契约。

    LiveKit、WebSocket、文件回放以及未来的原生实时供应商，都需要先把音频适配成
    这个形状，再进入同传管道。
    """

    session_id: str
    seq: int
    pcm: bytes
    sample_rate: int
    channels: int
    start_ms: int
    end_ms: int
    source_lang: str = "auto"
    source_kind: AudioSourceKind = AudioSourceKind.NETWORK_STREAM
    device_id: str | None = None
    is_final: bool = False


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
    metrics: dict[str, float] = field(default_factory=dict)
    stable_text: str = ""
    unstable_text: str = ""


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
    metrics: dict[str, float] = field(default_factory=dict)
    source_stable_text: str = ""
    source_unstable_text: str = ""
    target_stable_text: str = ""
    target_unstable_text: str = ""


@dataclass(frozen=True, slots=True)
class CorrectionContext:
    """传给修正策略的有界上下文。"""

    recent_segments: tuple[TranslationSegment, ...]
    current_segment_revisions: tuple[TranslationSegment, ...] = ()
    glossary: dict[str, str] = field(default_factory=dict)
    glossary_constraints: dict[str, str] = field(default_factory=dict)
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
    source_stable_text: str = ""
    source_unstable_text: str = ""
    target_stable_text: str = ""
    target_unstable_text: str = ""
    metrics: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class TranslatedAudioChunk:
    """端到端或 TTS 模型产出的译文音频块。"""

    session_id: str
    segment_id: str
    rev: int
    start_ms: int
    end_ms: int
    target_lang: str
    audio: bytes
    mime_type: str = "audio/mpeg"
    sample_rate: int | None = None
    final: bool = False
    metrics: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ModelProfile:
    """描述一个模型适配器的能力边界，而不是描述具体供应商实现。"""

    provider: str
    model: str
    mode: ModelMode
    capabilities: tuple[ModelCapability, ...]
    source_lang: str = "auto"
    target_lang: str = "zh-CN"


InterpretationEvent = TranslationSegment | SubtitlePatch | SegmentCommit | TranslatedAudioChunk
