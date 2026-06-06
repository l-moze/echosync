from __future__ import annotations

from echosync_agent.services.translation.deepseek_translator import should_flush_streaming_target


def test_deepseek_streaming_target_waits_for_short_cjk_deltas() -> None:
    assert should_flush_streaming_target(previous_text="", next_text="大") is False
    assert should_flush_streaming_target(previous_text="", next_text="大家好") is False
    assert should_flush_streaming_target(previous_text="大家好", next_text="大家好呀") is False


def test_deepseek_streaming_target_flushes_on_enough_text_or_punctuation() -> None:
    assert should_flush_streaming_target(previous_text="", next_text="大家好呀") is True
    assert should_flush_streaming_target(previous_text="大家好呀", next_text="大家好呀今天") is True
    assert should_flush_streaming_target(previous_text="", next_text="大家好，欢迎") is True
    assert should_flush_streaming_target(previous_text="", next_text="大家好欢迎大家") is True
    assert should_flush_streaming_target(previous_text="大家好", next_text="大家好呀。") is True
    assert (
        should_flush_streaming_target(
            previous_text="大家好欢迎大家",
            next_text="大家好欢迎大家今天",
        )
        is True
    )


def test_deepseek_streaming_target_flushes_on_final_and_rewrite() -> None:
    assert should_flush_streaming_target(previous_text="旧译文", next_text="新") is True
    assert (
        should_flush_streaming_target(
            previous_text="大家好",
            next_text="大家好呀",
            is_final=True,
        )
        is True
    )
