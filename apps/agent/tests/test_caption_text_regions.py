from __future__ import annotations

from echosync_agent.domain import SegmentStatus
from echosync_agent.services.realtime.text_regions import split_realtime_text


def test_committed_text_is_fully_stable() -> None:
    region = split_realtime_text(
        "I think this module should be improved",
        status=SegmentStatus.COMMITTED,
        language="en",
    )

    assert region.full_text == "I think this module should be improved"
    assert region.stable_text == "I think this module should be improved"
    assert region.unstable_text == ""


def test_latin_provisional_text_keeps_last_three_tokens_unstable() -> None:
    region = split_realtime_text(
        "I think this module should be improved",
        status=SegmentStatus.PARTIAL,
        language="en",
    )

    assert region.stable_text == "I think this module"
    assert region.unstable_text == "should be improved"


def test_cjk_provisional_text_keeps_last_six_characters_unstable() -> None:
    region = split_realtime_text(
        "我们正在测试实时字幕系统",
        status=SegmentStatus.PARTIAL,
        language="zh-CN",
    )

    assert region.stable_text == "我们正在测试"
    assert region.unstable_text == "实时字幕系统"


def test_punctuation_boundary_text_is_stable_before_final_lock() -> None:
    region = split_realtime_text(
        "The model starts,",
        status=SegmentStatus.STABLE,
        language="en",
    )

    assert region.stable_text == "The model starts,"
    assert region.unstable_text == ""

