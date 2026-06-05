from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from echosync_agent.domain import AudioFrame
from echosync_agent.runtime import build_demo_pipeline
from echosync_agent.runtime.settings import Settings


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
    pipeline, event_bus = build_demo_pipeline(_mock_settings())

    await pipeline.run(_frames())

    event_types = [event_type for event_type, _ in event_bus.events]
    assert event_types == [
        "transcript.partial",
        "translation.partial",
        "translation.partial",
        "segment.commit",
    ]
    assert event_bus.events[0][1]["source_text"] == "Vector database latency matters."
    assert event_bus.events[0][1]["target_text"] == ""
    assert event_bus.events[1][1]["source_text"] == "Vector database latency matters."
    assert event_bus.events[1][1]["target_text"] == "[zh]"
    assert event_bus.events[2][1]["target_text"].startswith("[zh] Vector")
    assert event_bus.events[3][1]["final"] is True


def _mock_settings() -> Settings:
    return Settings(
        asr_provider="mock",
        translator_provider="mock",
        tts_provider="disabled",
        target_lang="zh-CN",
        funasr_model="paraformer-zh-streaming",
        funasr_device="auto",
        funasr_chunk_ms=600,
        asr_server_port=8765,
        deepseek_api_key="",
        deepseek_base_url="https://api.deepseek.com/v1",
        deepseek_model="deepseek-chat",
        edge_tts_voice="zh-CN-XiaoxiaoNeural",
        mistral_api_key="",
        voxtral_model="voxtral-mini-transcribe-realtime-2602",
        voxtral_target_delay_ms=1000,
        glossary_enabled=False,
        glossary_domain="",
        glossary_terms_dir="",
    )
