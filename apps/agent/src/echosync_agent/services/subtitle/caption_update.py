from __future__ import annotations

from typing import Any

from echosync_agent.domain import SegmentCommit, SegmentStatus, TranslationSegment


def caption_update_from_translation(segment: TranslationSegment) -> dict[str, Any]:
    event: dict[str, Any] = {
        "type": "caption_update",
        "session_id": segment.session_id,
        "segment_id": segment.segment_id,
        "revision": segment.rev,
        "state": _state_from_status(segment.status),
        "source": {
            "full_text": segment.source_text,
            "stable_text": segment.source_stable_text,
            "unstable_text": segment.source_unstable_text,
            "language": segment.source_lang,
        },
        "timing": {"start_ms": segment.start_ms, "end_ms": segment.end_ms},
    }
    if segment.target_text:
        event["target"] = {
            "full_text": segment.target_text,
            "stable_text": segment.target_stable_text,
            "unstable_text": segment.target_unstable_text,
            "language": segment.target_lang,
        }
    return event


def caption_update_from_commit(commit: SegmentCommit) -> dict[str, Any]:
    return {
        "type": "caption_update",
        "session_id": commit.session_id,
        "segment_id": commit.segment_id,
        "revision": commit.rev,
        "state": "final",
        "source": {
            "full_text": commit.source_text,
            "stable_text": commit.source_stable_text,
            "unstable_text": commit.source_unstable_text,
            "language": commit.source_lang,
        },
        "target": {
            "full_text": commit.target_text,
            "stable_text": commit.target_stable_text,
            "unstable_text": commit.target_unstable_text,
            "language": commit.target_lang,
        },
        "timing": {"start_ms": commit.start_ms, "end_ms": commit.end_ms},
    }


def _state_from_status(status: SegmentStatus) -> str:
    if status == SegmentStatus.PARTIAL:
        return "interim"
    if status == SegmentStatus.STABLE:
        return "stable"
    return "final"
