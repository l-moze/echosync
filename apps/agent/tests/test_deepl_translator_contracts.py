from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

from echosync_agent.domain import CorrectionContext, SegmentStatus, TranscriptSegment
from echosync_agent.services.translation.deepl_translator import (
    DeepLTranslator,
    _context_text,
    _source_lang_code,
    _target_lang_code,
    _translate_endpoint,
)


def test_deepl_translate_endpoint_normalization() -> None:
    assert _translate_endpoint("") == "https://api-free.deepl.com/v2/translate"
    assert _translate_endpoint("https://api.deepl.com") == "https://api.deepl.com/v2/translate"
    assert (
        _translate_endpoint("https://api-free.deepl.com")
        == "https://api-free.deepl.com/v2/translate"
    )
    assert (
        _translate_endpoint("https://api-free.deepl.com/v2")
        == "https://api-free.deepl.com/v2/translate"
    )
    assert (
        _translate_endpoint("https://api-free.deepl.com/v2/translate")
        == "https://api-free.deepl.com/v2/translate"
    )


def test_deepl_target_lang_code_normalization() -> None:
    assert _target_lang_code("") == "ZH"
    assert _target_lang_code("zh-CN") == "ZH"
    assert _target_lang_code("zh_CN") == "ZH"
    assert _target_lang_code("zh-Hans") == "ZH"
    assert _target_lang_code("en") == "EN-US"
    assert _target_lang_code("en-US") == "EN-US"
    assert _target_lang_code("en-GB") == "EN-GB"
    assert _target_lang_code("pt") == "PT-PT"
    assert _target_lang_code("pt-BR") == "PT-BR"
    assert _target_lang_code("DE") == "DE"


def test_deepl_source_lang_code_normalization() -> None:
    assert _source_lang_code("") == ""
    assert _source_lang_code("auto") == ""
    assert _source_lang_code("unknown") == ""
    assert _source_lang_code("zh-CN") == "ZH"
    assert _source_lang_code("zh_CN") == "ZH"
    assert _source_lang_code("en-US") == "EN"
    assert _source_lang_code("en-GB") == "EN"
    assert _source_lang_code("ja") == "JA"
    assert _source_lang_code("de") == "DE"


def test_deepl_context_text_uses_recent_and_current_segment_revisions() -> None:
    from echosync_agent.domain import TranslationSegment

    context = CorrectionContext(
        recent_segments=(
            TranslationSegment(
                session_id="sess",
                segment_id="seg1",
                rev=1,
                source_rev=1,
                start_ms=0,
                end_ms=1000,
                source_lang="en",
                target_lang="zh-CN",
                source_text="First sentence.",
                target_text="第一句。",
                status=SegmentStatus.COMMITTED,
                stability=1.0,
            ),
            TranslationSegment(
                session_id="sess",
                segment_id="seg2",
                rev=1,
                source_rev=1,
                start_ms=1000,
                end_ms=2000,
                source_lang="en",
                target_lang="zh-CN",
                source_text="Second sentence.",
                target_text="第二句。",
                status=SegmentStatus.COMMITTED,
                stability=1.0,
            ),
        ),
        current_segment_revisions=(
            TranslationSegment(
                session_id="sess",
                segment_id="seg3",
                rev=1,
                source_rev=1,
                start_ms=2000,
                end_ms=3000,
                source_lang="en",
                target_lang="zh-CN",
                source_text="Third sentence partial",
                target_text="第三句部分",
                status=SegmentStatus.PARTIAL,
                stability=0.7,
            ),
        ),
    )

    result = _context_text(context, max_chars=1000)

    assert "First sentence." in result
    assert "Second sentence." in result
    assert "Third sentence partial" in result


def test_deepl_context_text_truncates_to_max_chars() -> None:
    from echosync_agent.domain import TranslationSegment

    context = CorrectionContext(
        recent_segments=(
            TranslationSegment(
                session_id="sess",
                segment_id="seg1",
                rev=1,
                source_rev=1,
                start_ms=0,
                end_ms=1000,
                source_lang="en",
                target_lang="zh-CN",
                source_text="A" * 500,
                target_text="",
                status=SegmentStatus.COMMITTED,
                stability=1.0,
            ),
            TranslationSegment(
                session_id="sess",
                segment_id="seg2",
                rev=1,
                source_rev=1,
                start_ms=1000,
                end_ms=2000,
                source_lang="en",
                target_lang="zh-CN",
                source_text="B" * 500,
                target_text="",
                status=SegmentStatus.COMMITTED,
                stability=1.0,
            ),
        ),
    )

    result = _context_text(context, max_chars=100)

    assert len(result) <= 100
    assert "B" in result


def test_deepl_translator_builds_request_body_with_text_and_target_lang() -> None:
    translator = DeepLTranslator(
        api_key="test-key",
        target_lang="ZH",
    )
    segment = _transcript_segment(text="Hello world")
    context = CorrectionContext(recent_segments=())

    body = translator._request_body(segment, context, "official")

    assert body["text"] == ["Hello world"]
    assert body["target_lang"] == "ZH"


def test_deepl_translator_includes_source_lang_when_configured() -> None:
    translator = DeepLTranslator(
        api_key="test-key",
        target_lang="ZH",
        source_lang="EN",
    )
    segment = _transcript_segment(text="Hello world")
    context = CorrectionContext(recent_segments=())

    body = translator._request_body(segment, context, "official")

    assert body["source_lang"] == "EN"


def test_deepl_translator_includes_context_when_available() -> None:
    from echosync_agent.domain import TranslationSegment

    translator = DeepLTranslator(
        api_key="test-key",
        target_lang="ZH",
        context_chars=500,
    )
    segment = _transcript_segment(text="This is great.")
    context = CorrectionContext(
        recent_segments=(
            TranslationSegment(
                session_id="sess",
                segment_id="seg1",
                rev=1,
                source_rev=1,
                start_ms=0,
                end_ms=1000,
                source_lang="en",
                target_lang="zh-CN",
                source_text="Previous context.",
                target_text="前文。",
                status=SegmentStatus.COMMITTED,
                stability=1.0,
            ),
        ),
    )

    body = translator._request_body(segment, context, "official")

    assert "context" in body
    assert "Previous context." in body["context"]


def test_deepl_translator_includes_glossary_id_when_configured() -> None:
    translator = DeepLTranslator(
        api_key="test-key",
        target_lang="ZH",
        source_lang="EN",
        glossary_id="glossary-12345",
    )
    segment = _transcript_segment(text="Hello world")
    context = CorrectionContext(recent_segments=())

    body = translator._request_body(segment, context, "official")

    assert body["glossary_id"] == "glossary-12345"


def test_deepl_translator_includes_model_type_when_configured() -> None:
    translator = DeepLTranslator(
        api_key="test-key",
        target_lang="ZH",
        model_type="quality_optimized",
    )
    segment = _transcript_segment(text="Hello world")
    context = CorrectionContext(recent_segments=())

    body = translator._request_body(segment, context, "official")

    assert body["model_type"] == "quality_optimized"


def test_deepl_translator_rejects_glossary_without_source_lang() -> None:
    translator = DeepLTranslator(
        api_key="test-key",
        target_lang="ZH",
        glossary_id="glossary-12345",
    )
    segment = _transcript_segment(text="Hello world", source_lang="unknown")
    context = CorrectionContext(recent_segments=())

    try:
        translator._request_body(segment, context, "official")
    except ValueError as exc:
        assert "glossary_id requires source_lang" in str(exc)
    else:
        raise AssertionError("Expected ValueError for glossary without source_lang")


def test_deepl_translator_translate_returns_translation_segment() -> None:
    from echosync_agent.services.translation.deepl_translator import DeepLResponse

    translator = DeepLTranslator(
        api_key="test-key",
        target_lang="ZH",
    )
    translator._translate_sync = MagicMock(  # type: ignore[method-assign]
        return_value=DeepLResponse(
            text="你好世界",
            detected_source_language="EN",
            model_type_used="latency_optimized",
        )
    )
    segment = _transcript_segment(text="Hello world")
    context = CorrectionContext(recent_segments=())

    result = asyncio.run(translator.translate(segment, context))

    assert result.target_text == "你好世界"
    assert result.source_text == "Hello world"
    assert result.target_lang == "ZH"
    assert result.session_id == "sess_deepl"
    assert result.segment_id == "seg_deepl"


def _transcript_segment(
    text: str,
    source_lang: str = "en",
) -> TranscriptSegment:
    return TranscriptSegment(
        session_id="sess_deepl",
        segment_id="seg_deepl",
        rev=1,
        start_ms=0,
        end_ms=1000,
        source_lang=source_lang,
        text=text,
        status=SegmentStatus.STABLE,
        stability=0.9,
    )
