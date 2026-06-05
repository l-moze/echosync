from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from echosync_agent.domain import AudioFrame
from echosync_agent.runtime import build_demo_pipeline


async def _frames() -> AsyncIterator[AudioFrame]:
    yield AudioFrame(
        session_id="sess_test",
        seq=1,
        pcm=b"Vector database latency matters.",
        sample_rate=16_000,
        channels=1,
        start_ms=0,
        end_ms=1600,
        source_lang="en",
    )


def test_pipeline_emits_translation_and_commit_events() -> None:
    asyncio.run(_assert_pipeline_emits_translation_and_commit_events())


async def _assert_pipeline_emits_translation_and_commit_events() -> None:
    pipeline, event_bus = build_demo_pipeline()

    await pipeline.run(_frames())

    event_types = [event_type for event_type, _ in event_bus.events]
    assert event_types == ["translation.partial", "segment.commit"]
    assert event_bus.events[0][1]["target_text"].startswith("[zh]")
    assert event_bus.events[1][1]["final"] is True
