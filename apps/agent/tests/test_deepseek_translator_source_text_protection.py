"""Tests for source text protection against ASR truncation artifacts."""

from __future__ import annotations

from echosync_agent.domain import CorrectionContext, SegmentStatus, TranscriptSegment, TranslationSegment
from echosync_agent.services.translation.deepseek_translator import DeepSeekTranslator


def test_protect_source_text_preserves_longer_text_on_significant_shrinkage() -> None:
    """When current text is significantly shorter (>5 chars), preserve the longest historical text."""
    translator = DeepSeekTranslator(
        api_key="test",
        base_url="https://example.invalid/v1",
        model="deepseek-test",
        target_lang="zh-CN",
    )

    # Previous revision had 148 characters
    previous = TranslationSegment(
        session_id="sess_test",
        segment_id="seg_6b1e5e3213e2",
        rev=10,
        source_rev=10,
        start_ms=0,
        end_ms=5000,
        source_lang="en",
        target_lang="zh-CN",
        source_text="an extremely resource-intensive research topic, can we also scale the science to allow the community to drive the collective progress of this topic",
        target_text="一个极其资源密集的研究课题，我们是否也能扩展科学，让社区推动这一课题的集体进展",
        status=SegmentStatus.PARTIAL,
        stability=0.72,
    )

    # Current revision only has 78 characters (ASR dropped the tail)
    current = TranscriptSegment(
        session_id="sess_test",
        segment_id="seg_6b1e5e3213e2",
        rev=11,
        start_ms=0,
        end_ms=5000,
        source_lang="en",
        text="an extremely resource-intensive research topic, can we also scale the science",
        status=SegmentStatus.COMMITTED,
        stability=1.0,
    )

    context = CorrectionContext(
        recent_segments=(),
        current_segment_revisions=(previous,),
    )
    metrics: dict[str, float] = {}

    protected = translator._protect_source_text(current, context, metrics)

    # Should preserve the longer historical text
    assert protected == previous.source_text
    assert len(protected) == 147
    assert metrics["source_text_protected"] == 1.0
    assert metrics["source_text_shrink_chars"] == 70.0  # 147 - 77


def test_protect_source_text_allows_extension() -> None:
    """When current text is longer, use it (normal growth)."""
    translator = DeepSeekTranslator(
        api_key="test",
        base_url="https://example.invalid/v1",
        model="deepseek-test",
        target_lang="zh-CN",
    )

    previous = TranslationSegment(
        session_id="sess_test",
        segment_id="seg_test",
        rev=1,
        source_rev=1,
        start_ms=0,
        end_ms=2000,
        source_lang="en",
        target_lang="zh-CN",
        source_text="Hello world",
        target_text="你好世界",
        status=SegmentStatus.PARTIAL,
        stability=0.8,
    )

    current = TranscriptSegment(
        session_id="sess_test",
        segment_id="seg_test",
        rev=2,
        start_ms=0,
        end_ms=3000,
        source_lang="en",
        text="Hello world, this is a test",
        status=SegmentStatus.PARTIAL,
        stability=0.85,
    )

    context = CorrectionContext(
        recent_segments=(),
        current_segment_revisions=(previous,),
    )
    metrics: dict[str, float] = {}

    protected = translator._protect_source_text(current, context, metrics)

    # Should use the longer current text
    assert protected == current.text
    assert "source_text_protected" not in metrics


def test_protect_source_text_allows_minor_correction() -> None:
    """When text shrinks by ≤5 chars, allow it (likely ASR correction)."""
    translator = DeepSeekTranslator(
        api_key="test",
        base_url="https://example.invalid/v1",
        model="deepseek-test",
        target_lang="zh-CN",
    )

    previous = TranslationSegment(
        session_id="sess_test",
        segment_id="seg_test",
        rev=1,
        source_rev=1,
        start_ms=0,
        end_ms=2000,
        source_lang="en",
        target_lang="zh-CN",
        source_text="I think this is a wrld",  # 22 chars with typo
        target_text="我认为这是一个世界",
        status=SegmentStatus.PARTIAL,
        stability=0.7,
    )

    current = TranscriptSegment(
        session_id="sess_test",
        segment_id="seg_test",
        rev=2,
        start_ms=0,
        end_ms=2000,
        source_lang="en",
        text="I think this is a world",  # 23 chars, corrected
        status=SegmentStatus.COMMITTED,
        stability=1.0,
    )

    context = CorrectionContext(
        recent_segments=(),
        current_segment_revisions=(previous,),
    )
    metrics: dict[str, float] = {}

    protected = translator._protect_source_text(current, context, metrics)

    # Should use current (correction is legitimate)
    assert protected == current.text
    assert "source_text_protected" not in metrics


def test_protect_source_text_allows_small_shrinkage() -> None:
    """When text shrinks by ≤5 chars, allow it."""
    translator = DeepSeekTranslator(
        api_key="test",
        base_url="https://example.invalid/v1",
        model="deepseek-test",
        target_lang="zh-CN",
    )

    previous = TranslationSegment(
        session_id="sess_test",
        segment_id="seg_test",
        rev=1,
        source_rev=1,
        start_ms=0,
        end_ms=2000,
        source_lang="en",
        target_lang="zh-CN",
        source_text="This is a test sentence here",  # 28 chars
        target_text="这是一个测试句子",
        status=SegmentStatus.PARTIAL,
        stability=0.75,
    )

    current = TranscriptSegment(
        session_id="sess_test",
        segment_id="seg_test",
        rev=2,
        start_ms=0,
        end_ms=2000,
        source_lang="en",
        text="This is a test sentence",  # 23 chars (shrink by 5)
        status=SegmentStatus.COMMITTED,
        stability=1.0,
    )

    context = CorrectionContext(
        recent_segments=(),
        current_segment_revisions=(previous,),
    )
    metrics: dict[str, float] = {}

    protected = translator._protect_source_text(current, context, metrics)

    # Should use current (5 chars is at the threshold)
    assert protected == current.text
    assert "source_text_protected" not in metrics


def test_protect_source_text_no_context_uses_current() -> None:
    """When no context is available, use current text."""
    translator = DeepSeekTranslator(
        api_key="test",
        base_url="https://example.invalid/v1",
        model="deepseek-test",
        target_lang="zh-CN",
    )

    current = TranscriptSegment(
        session_id="sess_test",
        segment_id="seg_new",
        rev=1,
        start_ms=0,
        end_ms=1000,
        source_lang="en",
        text="First segment",
        status=SegmentStatus.PARTIAL,
        stability=0.8,
    )

    metrics: dict[str, float] = {}

    # No context
    protected = translator._protect_source_text(current, None, metrics)
    assert protected == current.text
    assert "source_text_protected" not in metrics

    # Empty revision history
    context = CorrectionContext(recent_segments=(), current_segment_revisions=())
    protected = translator._protect_source_text(current, context, metrics)
    assert protected == current.text
    assert "source_text_protected" not in metrics


def test_protect_source_text_picks_longest_from_multiple_revisions() -> None:
    """When multiple revisions exist, pick the longest one."""
    translator = DeepSeekTranslator(
        api_key="test",
        base_url="https://example.invalid/v1",
        model="deepseek-test",
        target_lang="zh-CN",
    )

    rev1 = TranslationSegment(
        session_id="sess_test",
        segment_id="seg_test",
        rev=1,
        source_rev=1,
        start_ms=0,
        end_ms=2000,
        source_lang="en",
        target_lang="zh-CN",
        source_text="Hello",  # 5 chars
        target_text="你好",
        status=SegmentStatus.PARTIAL,
        stability=0.6,
    )

    rev2 = TranslationSegment(
        session_id="sess_test",
        segment_id="seg_test",
        rev=2,
        source_rev=2,
        start_ms=0,
        end_ms=3000,
        source_lang="en",
        target_lang="zh-CN",
        source_text="Hello world everyone",  # 20 chars (longest)
        target_text="你好世界各位",
        status=SegmentStatus.PARTIAL,
        stability=0.7,
    )

    rev3 = TranslationSegment(
        session_id="sess_test",
        segment_id="seg_test",
        rev=3,
        source_rev=3,
        start_ms=0,
        end_ms=3500,
        source_lang="en",
        target_lang="zh-CN",
        source_text="Hello world",  # 11 chars
        target_text="你好世界",
        status=SegmentStatus.PARTIAL,
        stability=0.8,
    )

    current = TranscriptSegment(
        session_id="sess_test",
        segment_id="seg_test",
        rev=4,
        start_ms=0,
        end_ms=3500,
        source_lang="en",
        text="Hello wo",  # 8 chars (truncated)
        status=SegmentStatus.COMMITTED,
        stability=1.0,
    )

    context = CorrectionContext(
        recent_segments=(),
        current_segment_revisions=(rev1, rev2, rev3),
    )
    metrics: dict[str, float] = {}

    protected = translator._protect_source_text(current, context, metrics)

    # Should preserve rev2 (the longest)
    assert protected == "Hello world everyone"
    assert metrics["source_text_protected"] == 1.0
    assert metrics["source_text_shrink_chars"] == 12.0  # 20 - 8


def test_protect_source_text_real_case_seg_6b1e5e3213e2() -> None:
    """Test the actual case from the bug report."""
    translator = DeepSeekTranslator(
        api_key="test",
        base_url="https://example.invalid/v1",
        model="deepseek-test",
        target_lang="zh-CN",
    )

    # Interim state with longer text
    previous = TranslationSegment(
        session_id="sess_real",
        segment_id="seg_6b1e5e3213e2",
        rev=6,
        source_rev=6,
        start_ms=0,
        end_ms=5000,
        source_lang="en",
        target_lang="zh-CN",
        source_text="an extremely resource-intensive research topic, can we also scale the science to allow the community to drive the",
        target_text="一个极其资源密集的研究课题",
        status=SegmentStatus.PARTIAL,
        stability=0.72,
    )

    # Stable state with truncated text (the bug!)
    current = TranscriptSegment(
        session_id="sess_real",
        segment_id="seg_6b1e5e3213e2",
        rev=7,
        start_ms=0,
        end_ms=5000,
        source_lang="en",
        text="an extremely resource-intensive research topic, can we also scale the science",
        status=SegmentStatus.COMMITTED,
        stability=1.0,
    )

    context = CorrectionContext(
        recent_segments=(),
        current_segment_revisions=(previous,),
    )
    metrics: dict[str, float] = {}

    protected = translator._protect_source_text(current, context, metrics)

    # Bug fix: should preserve the longer interim text
    assert protected == previous.source_text
    assert len(protected) == 113
    assert len(current.text) == 77
    assert metrics["source_text_protected"] == 1.0
    assert metrics["source_text_shrink_chars"] == 36.0
