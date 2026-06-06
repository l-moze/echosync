from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import replace
from typing import Any

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


def test_pipeline_emits_tts_audio_when_provider_enabled(monkeypatch: Any) -> None:
    synthesized_segments: list[Any] = []

    class FakeEdgeTtsSynthesizer:
        def __init__(self, voice: str = "zh-CN-XiaoxiaoNeural") -> None:
            self.voice = voice

        async def synthesize(self, segment: object) -> AsyncIterator[bytes]:
            synthesized_segments.append(segment)
            yield b"tts-"
            yield b"audio"

    monkeypatch.setattr(
        "echosync_agent.services.tts.factory.EdgeTtsSynthesizer",
        FakeEdgeTtsSynthesizer,
    )

    async def run() -> list[tuple[str, object]]:
        settings = replace(_mock_settings(), tts_provider="edge-tts")
        pipeline, event_bus = build_demo_pipeline(settings)
        await pipeline.run(_frames())
        return event_bus.events

    events = asyncio.run(run())

    event_types = [event_type for event_type, _ in events]
    assert event_types[:8] == [
        "transcript.partial",
        "caption_update",
        "translation.partial",
        "caption_update",
        "translation.partial",
        "caption_update",
        "segment.commit",
        "caption_update",
    ]
    tts_events = [payload for event_type, payload in events if event_type == "tts.audio"]
    assert [event["audio_base64"] for event in tts_events] == ["dHRzLQ==", "YXVkaW8=", ""]
    assert [event["final"] for event in tts_events] == [False, False, True]
    assert tts_events[0]["metrics"]["tts_first_audio_ms"] >= 0
    assert tts_events[-1]["metrics"]["tts_total_ms"] >= 0
    assert tts_events[-1]["metrics"]["tts_audio_chunks"] == 2.0
    assert synthesized_segments[0].metrics["translation_first_token_ms"] >= 0
    assert synthesized_segments[0].metrics["translation_queue_wait_ms"] >= 0


def test_pipeline_forwards_caption_update_events_to_caption_event_bus() -> None:
    asyncio.run(_assert_pipeline_forwards_caption_update_events_to_caption_event_bus())


async def _assert_pipeline_emits_translation_and_commit_events() -> None:
    pipeline, event_bus = build_demo_pipeline(_mock_settings())

    await pipeline.run(_frames())

    event_types = [event_type for event_type, _ in event_bus.events]
    assert event_types == [
        "transcript.partial",
        "caption_update",
        "translation.partial",
        "caption_update",
        "translation.partial",
        "caption_update",
        "segment.commit",
        "caption_update",
    ]
    assert event_bus.events[0][1]["source_text"] == "Vector database latency matters."
    assert event_bus.events[0][1]["target_text"] == ""
    first_update = event_bus.events[1][1]
    assert first_update["type"] == "caption_update"
    assert first_update["state"] == "stable"
    assert first_update["source"]["full_text"] == "Vector database latency matters."
    assert "target" not in first_update
    assert event_bus.events[2][1]["source_text"] == "Vector database latency matters."
    assert event_bus.events[2][1]["target_text"] == "[zh]"
    assert event_bus.events[4][1]["target_text"].startswith("[zh] Vector")
    assert event_bus.events[6][1]["final"] is True
    final_update = event_bus.events[7][1]
    assert final_update["type"] == "caption_update"
    assert final_update["state"] == "final"
    assert final_update["target"]["full_text"].startswith("[zh] Vector")


async def _assert_pipeline_forwards_caption_update_events_to_caption_event_bus() -> None:
    hub = _MemoryCaptionHub()
    pipeline, _event_bus = build_demo_pipeline(_mock_settings(), caption_event_bus=hub)

    await pipeline.run(_frames())

    event_types = [event_type for event_type, _payload in hub.events]
    assert event_types == [
        "transcript.partial",
        "caption_update",
        "translation.partial",
        "caption_update",
        "translation.partial",
        "caption_update",
        "segment.commit",
        "caption_update",
    ]
    assert hub.events[1][1]["source"]["full_text"] == "Vector database latency matters."


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
        elevenlabs_api_key="",
        elevenlabs_voice_id="",
        elevenlabs_model="eleven_multilingual_v2",
        elevenlabs_output_format="mp3_44100_128",
        elevenlabs_optimize_streaming_latency=None,
        mistral_api_key="",
        voxtral_model="voxtral-mini-transcribe-realtime-2602",
        voxtral_target_delay_ms=1000,
        glossary_enabled=False,
        glossary_domain="",
        glossary_terms_dir="",
    )


class _MemoryCaptionHub:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []

    async def publish(self, event_type: str, payload: dict[str, Any]) -> None:
        self.events.append((event_type, payload))
