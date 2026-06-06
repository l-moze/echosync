from __future__ import annotations

from echosync_agent.domain import CorrectionContext, SegmentStatus, TranslationSegment
from echosync_agent.services.translation.deepseek_translator import (
    DeepSeekTranslator,
    should_flush_streaming_target,
)


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


def test_deepseek_prompt_includes_current_segment_revision_context() -> None:
    translator = DeepSeekTranslator(
        api_key="test",
        base_url="https://example.invalid/v1",
        model="deepseek-test",
        target_lang="zh-CN",
    )
    previous = TranslationSegment(
        session_id="sess_prompt",
        segment_id="seg_live",
        rev=2,
        source_rev=2,
        start_ms=0,
        end_ms=1_200,
        source_lang="en",
        target_lang="zh-CN",
        source_text="I think this model",
        target_text="我认为这个模型",
        status=SegmentStatus.STABLE,
        stability=0.9,
    )
    context = CorrectionContext(
        recent_segments=(),
        current_segment_revisions=(previous,),
    )

    prompt = translator._build_user_prompt("I think this module", context)

    assert "<current_segment_revisions>" in prompt
    assert "<source>I think this model</source>" in prompt
    assert "<target>我认为这个模型</target>" in prompt
    assert "<source>I think this module</source>" in prompt
