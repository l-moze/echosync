from __future__ import annotations

from echosync_agent.services.translation.cjk_spacing import normalize_cjk_spacing


def test_normalize_cjk_spacing_removes_unexpected_zh_internal_spaces() -> None:
    normalized, removed = normalize_cjk_spacing("这 些 是 住 宅 房 屋 。", "zh-CN")

    assert normalized == "这些是住宅房屋。"
    assert removed == 7


def test_normalize_cjk_spacing_handles_ja_and_ko_compact_scripts() -> None:
    ja_normalized, ja_removed = normalize_cjk_spacing("こ れ は テ ス ト です 。", "ja")
    ko_normalized, ko_removed = normalize_cjk_spacing("한 국 어 문 장 입니다 。", "ko")

    assert ja_normalized == "これはテストです。"
    assert ja_removed == 7
    assert ko_normalized == "한국어문장입니다。"
    assert ko_removed == 6


def test_normalize_cjk_spacing_preserves_latin_and_numeric_spacing() -> None:
    normalized, removed = normalize_cjk_spacing(
        "使用 GPT-4o 处理 JSON 数据，并保留 3 个窗口。",
        "zh-CN",
    )

    assert normalized == "使用 GPT-4o 处理 JSON 数据，并保留 3 个窗口。"
    assert removed == 0
