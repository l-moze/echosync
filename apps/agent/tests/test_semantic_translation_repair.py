from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

from echosync_agent.domain import CorrectionContext, SegmentStatus, TranslationSegment
from echosync_agent.services.correction.semantic_repair import (
    DeepSeekTranslationRepairEngine,
    SemanticTranslationRepairPolicy,
)


def test_semantic_repair_policy_triggers_on_quality_metrics() -> None:
    segment = _segment(
        source_text="So this part of the UK has more of a seasonal economy.",
        target_text="所以这部分英国，更像季节性经济。",
        metrics={"target_discourse_marker_trimmed": 1.0},
    )

    decision = SemanticTranslationRepairPolicy().decide(segment)

    assert decision.should_repair is True
    assert "discourse_marker" in decision.reason


def test_semantic_repair_policy_skips_clean_committed_segment() -> None:
    segment = _segment(
        source_text="Cornwall is famous for cider.",
        target_text="康沃尔以苹果酒闻名。",
    )

    decision = SemanticTranslationRepairPolicy().decide(segment)

    assert decision.should_repair is False
    assert decision.reason == "clean"


def test_semantic_repair_policy_does_not_treat_uppercase_article_as_fragment() -> None:
    segment = _segment(
        source_text="A seasonal economy is busy in summer and quiet in winter.",
        target_text="季节性经济夏季繁忙，冬季冷清。",
    )

    decision = SemanticTranslationRepairPolicy().decide(segment)

    assert decision.should_repair is False
    assert decision.reason == "clean"


def test_semantic_repair_policy_preserves_logical_so_that() -> None:
    segment = _segment(
        source_text="So that we can learn from field demonstrations.",
        target_text="所以我们可以从现场演示中学习。",
    )

    decision = SemanticTranslationRepairPolicy().decide(segment)

    assert decision.should_repair is False
    assert decision.reason == "clean"


def test_semantic_repair_policy_debug_all_repairs_committed_text() -> None:
    decision = SemanticTranslationRepairPolicy(mode="debug_all").decide(
        _segment(source_text="So pretty.", target_text="真漂亮。")
    )

    assert decision.should_repair is True
    assert decision.reason == "debug_all"


def test_deepseek_semantic_repair_uses_context_and_returns_final_revision() -> None:
    fake_client = _FakeClient("英国的这个地区更依赖季节性经济。")
    engine = DeepSeekTranslationRepairEngine(
        api_key="test",
        base_url="https://example.invalid/v1",
        model="deepseek-test",
        target_lang="zh-CN",
        client_factory=lambda **_kwargs: fake_client,
    )
    previous = _segment(
        segment_id="seg_prev",
        source_text="Cornwall has a lot of tourists in summer.",
        target_text="康沃尔夏天游客很多。",
    )
    current = _segment(
        source_text="So this part of the UK has more of like a seasonal economy.",
        target_text="所以这部分英国，更像季节性经济。",
    )
    context = CorrectionContext(
        recent_segments=(previous,),
        glossary={"seasonal economy": "季节性经济"},
        glossary_constraints={"seasonal economy": "required"},
    )

    repaired = asyncio.run(engine.repair(current, context, reason="source_fragment"))

    assert repaired is not None
    assert repaired.rev == current.rev + 1
    assert repaired.status == SegmentStatus.COMMITTED
    assert repaired.target_text == "英国的这个地区更依赖季节性经济。"
    assert repaired.target_stable_text == repaired.target_text
    assert repaired.metrics["semantic_revision_latency_ms"] >= 0
    assert repaired.metrics["semantic_revision_changed_chars"] > 0
    prompt = fake_client.requests[0]["messages"][1]["content"]
    assert "<recent_segments>" in prompt
    assert "Cornwall has a lot of tourists" in prompt
    assert '<term source="seasonal economy" target="季节性经济" constraint="required"/>' in prompt
    assert "<translation>所以这部分英国，更像季节性经济。</translation>" in prompt


def test_deepseek_semantic_repair_returns_none_when_unchanged() -> None:
    fake_client = _FakeClient("康沃尔以苹果酒闻名。")
    engine = DeepSeekTranslationRepairEngine(
        api_key="test",
        base_url="https://example.invalid/v1",
        model="deepseek-test",
        target_lang="zh-CN",
        client_factory=lambda **_kwargs: fake_client,
    )
    current = _segment(
        source_text="Cornwall is famous for cider.",
        target_text="康沃尔以苹果酒闻名。",
    )

    repaired = asyncio.run(engine.repair(current, CorrectionContext(recent_segments=())))

    assert repaired is None


class _FakeClient:
    def __init__(self, response_text: str) -> None:
        self.requests: list[dict[str, Any]] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))
        self.response_text = response_text

    async def _create(self, **kwargs: Any) -> Any:
        self.requests.append(kwargs)
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content=self.response_text),
                )
            ],
            usage=None,
        )


def _segment(
    *,
    session_id: str = "sess_repair",
    segment_id: str = "seg_current",
    source_text: str,
    target_text: str,
    metrics: dict[str, float] | None = None,
) -> TranslationSegment:
    return TranslationSegment(
        session_id=session_id,
        segment_id=segment_id,
        rev=2,
        source_rev=2,
        start_ms=0,
        end_ms=1_800,
        source_lang="en",
        target_lang="zh-CN",
        source_text=source_text,
        target_text=target_text,
        status=SegmentStatus.COMMITTED,
        stability=1.0,
        metrics=metrics or {},
        source_stable_text=source_text,
        target_stable_text=target_text,
    )
