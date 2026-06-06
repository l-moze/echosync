from __future__ import annotations

from echosync_agent.domain import SegmentCommit, SegmentStatus, TranslationSegment
from echosync_agent.services.subtitle.caption_update import (
    caption_update_from_commit,
    caption_update_from_translation,
)


def test_caption_update_from_source_only_translation_omits_empty_target() -> None:
    event = caption_update_from_translation(
        TranslationSegment(
            session_id="sess_update",
            segment_id="seg_live",
            rev=3,
            source_rev=3,
            start_ms=100,
            end_ms=900,
            source_lang="en",
            target_lang="zh-CN",
            source_text="I think this module",
            target_text="",
            status=SegmentStatus.PARTIAL,
            stability=0.72,
            source_stable_text="I think",
            source_unstable_text="this module",
        )
    )

    assert event == {
        "type": "caption_update",
        "session_id": "sess_update",
        "segment_id": "seg_live",
        "revision": 3,
        "state": "interim",
        "source": {
            "full_text": "I think this module",
            "stable_text": "I think",
            "unstable_text": "this module",
            "language": "en",
        },
        "timing": {"start_ms": 100, "end_ms": 900},
    }


def test_caption_update_from_translated_segment_includes_target_regions() -> None:
    event = caption_update_from_translation(
        TranslationSegment(
            session_id="sess_update",
            segment_id="seg_live",
            rev=4,
            source_rev=4,
            start_ms=100,
            end_ms=1_400,
            source_lang="en",
            target_lang="zh-CN",
            source_text="I think this module should work",
            target_text="我觉得这个模块应该能用",
            status=SegmentStatus.STABLE,
            stability=0.9,
            metrics={
                "translation_first_token_ms": 140.0,
                "translation_queue_wait_ms": 8.0,
            },
            source_stable_text="I think this module",
            source_unstable_text="should work",
            target_stable_text="我觉得这个模块",
            target_unstable_text="应该能用",
        )
    )

    assert event["state"] == "stable"
    assert event["source"]["full_text"] == "I think this module should work"
    assert event["target"] == {
        "full_text": "我觉得这个模块应该能用",
        "stable_text": "我觉得这个模块",
        "unstable_text": "应该能用",
        "language": "zh-CN",
    }
    assert event["metrics"] == {
        "translation_first_token_ms": 140.0,
        "translation_queue_wait_ms": 8.0,
    }


def test_caption_update_from_committed_translation_stays_stable_until_commit_event() -> None:
    event = caption_update_from_translation(
        TranslationSegment(
            session_id="sess_update",
            segment_id="seg_live",
            rev=5,
            source_rev=5,
            start_ms=100,
            end_ms=1_400,
            source_lang="en",
            target_lang="zh-CN",
            source_text="I think this module should work",
            target_text="我觉得这个模块应该能用",
            status=SegmentStatus.COMMITTED,
            stability=1.0,
            source_stable_text="I think this module should work",
            target_stable_text="我觉得这个模块应该能用",
        )
    )

    assert event["state"] == "stable"


def test_caption_update_from_commit_is_final() -> None:
    event = caption_update_from_commit(
        SegmentCommit(
            session_id="sess_update",
            segment_id="seg_done",
            rev=7,
            start_ms=0,
            end_ms=2_000,
            source_lang="en",
            target_lang="zh-CN",
            source_text="The final caption is ready.",
            target_text="最终字幕已经准备好了。",
            source_stable_text="The final caption is ready.",
            target_stable_text="最终字幕已经准备好了。",
            metrics={"translation_latency_ms": 220.0},
        )
    )

    assert event["state"] == "final"
    assert event["revision"] == 7
    assert event["source"]["stable_text"] == "The final caption is ready."
    assert event["target"]["stable_text"] == "最终字幕已经准备好了。"
    assert event["metrics"]["translation_latency_ms"] == 220.0
