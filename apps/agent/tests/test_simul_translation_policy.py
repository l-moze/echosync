from __future__ import annotations

from echosync_agent.domain import SegmentStatus, TranscriptSegment, TranslationSegment
from echosync_agent.services.translation.simul_policy import (
    SimulPolicyAction,
    SimulTranslationPolicy,
)


def test_simul_policy_waits_for_suspended_latin_tail() -> None:
    decision = SimulTranslationPolicy().should_translate(
        _transcript("We need to talk about the", SegmentStatus.STABLE)
    )

    assert decision.action == SimulPolicyAction.WAIT
    assert decision.reason == "suspended_tail"


def test_simul_policy_drafts_on_weak_boundary() -> None:
    decision = SimulTranslationPolicy().should_translate(
        _transcript("We need to talk about the model,", SegmentStatus.STABLE)
    )

    assert decision.action == SimulPolicyAction.DRAFT
    assert decision.reason == "weak_boundary"


def test_simul_policy_commits_final_transcript() -> None:
    decision = SimulTranslationPolicy().should_translate(
        _transcript("We need to talk about the model.", SegmentStatus.COMMITTED)
    )

    assert decision.action == SimulPolicyAction.COMMIT
    assert decision.reason == "source_committed"


def test_simul_policy_marks_rewrite_before_draft() -> None:
    previous = _translation("We need to talk about the database", "[zh] old")

    decision = SimulTranslationPolicy().should_translate(
        _transcript("We need to talk about the data lake", SegmentStatus.STABLE),
        previous_revision=previous,
    )

    assert decision.action == SimulPolicyAction.REVISE
    assert decision.reason == "source_rewrite"


def _transcript(text: str, status: SegmentStatus) -> TranscriptSegment:
    return TranscriptSegment(
        session_id="sess_simul",
        segment_id="seg_simul",
        rev=1,
        start_ms=0,
        end_ms=1200,
        source_lang="en",
        text=text,
        status=status,
        stability=1.0 if status == SegmentStatus.COMMITTED else 0.9,
    )


def _translation(source_text: str, target_text: str) -> TranslationSegment:
    return TranslationSegment(
        session_id="sess_simul",
        segment_id="seg_simul",
        rev=1,
        source_rev=1,
        start_ms=0,
        end_ms=1200,
        source_lang="en",
        target_lang="zh-CN",
        source_text=source_text,
        target_text=target_text,
        status=SegmentStatus.STABLE,
        stability=0.9,
    )
