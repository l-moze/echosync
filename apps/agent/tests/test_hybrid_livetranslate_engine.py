from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from echosync_agent.domain import (
    AudioFrame,
    ModelCapability,
    ModelMode,
    ModelProfile,
    SegmentCommit,
    SegmentStatus,
    TranscriptSegment,
    TranslationSegment,
)
from echosync_agent.services.engine.hybrid_livetranslate_engine import (
    SourceBackfilledLiveTranslateEngine,
)


def test_hybrid_livetranslate_commits_when_source_stays_partial_until_timeout() -> None:
    async def scenario() -> list[object]:
        engine = SourceBackfilledLiveTranslateEngine(
            source_transcriber=_SlowPartialSourceTranscriber(),
            source_timeout_ms=5,
            target_engine=_CommittedTargetEngine(),
            target_lang="zh-CN",
        )
        return [event async for event in engine.stream(_frames())]

    events = asyncio.run(scenario())

    translations = [event for event in events if isinstance(event, TranslationSegment)]
    commits = [event for event in events if isinstance(event, SegmentCommit)]
    assert any(event.source_text == "hello" for event in translations)
    assert any(event.target_text == "你好。" for event in translations)
    assert len(commits) == 1
    assert commits[0].source_text == "hello"
    assert commits[0].target_text == "你好。"
    assert commits[0].metrics["qwen_livetranslate_hybrid_commit"] == 1.0


def test_hybrid_livetranslate_commits_target_only_when_source_missing() -> None:
    async def scenario() -> list[object]:
        engine = SourceBackfilledLiveTranslateEngine(
            source_transcriber=_EmptySourceTranscriber(),
            source_timeout_ms=5,
            target_engine=_CommittedTargetEngine(),
            target_lang="zh-CN",
        )
        return [event async for event in engine.stream(_frames())]

    events = asyncio.run(scenario())

    commits = [event for event in events if isinstance(event, SegmentCommit)]
    assert len(commits) == 1
    assert commits[0].source_text == ""
    assert commits[0].target_text == "你好。"


class _EmptySourceTranscriber:
    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        async for _frame in frames:
            pass
        if False:
            yield


class _SlowPartialSourceTranscriber:
    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        async for frame in frames:
            if not frame.pcm:
                continue
            yield TranscriptSegment(
                session_id=frame.session_id,
                segment_id="src_partial",
                rev=1,
                start_ms=frame.start_ms,
                end_ms=frame.end_ms,
                source_lang="en",
                text="hello",
                status=SegmentStatus.PARTIAL,
                stability=0.7,
            )
            await asyncio.sleep(0.05)
            return


class _CommittedTargetEngine:
    @property
    def profile(self) -> ModelProfile:
        return ModelProfile(
            provider="fake-target",
            model="fake-live",
            mode=ModelMode.END_TO_END,
            capabilities=(ModelCapability.TRANSLATION,),
            source_lang="en",
            target_lang="zh-CN",
        )

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranslationSegment]:
        async for frame in frames:
            if not frame.pcm:
                continue
            await asyncio.sleep(0.01)
            yield TranslationSegment(
                session_id=frame.session_id,
                segment_id="target_committed",
                rev=1,
                source_rev=0,
                start_ms=frame.start_ms,
                end_ms=frame.end_ms,
                source_lang="en",
                target_lang="zh-CN",
                source_text="",
                target_text="你好。",
                status=SegmentStatus.COMMITTED,
                stability=1.0,
            )
            return


async def _frames() -> AsyncIterator[AudioFrame]:
    yield AudioFrame(
        session_id="sess_hybrid",
        seq=1,
        pcm=b"\x01\x02",
        sample_rate=16_000,
        channels=1,
        start_ms=0,
        end_ms=80,
        source_lang="en",
    )
    yield AudioFrame(
        session_id="sess_hybrid",
        seq=2,
        pcm=b"",
        sample_rate=16_000,
        channels=1,
        start_ms=80,
        end_ms=80,
        source_lang="en",
        is_final=True,
    )
