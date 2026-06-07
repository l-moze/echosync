from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import replace
from typing import Any

from echosync_agent.domain import AudioFrame, SegmentCommit, TranslationSegment
from echosync_agent.pipeline.engine_pipeline import EngineDrivenInterpretationPipeline
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
        def __init__(self, voice: str = "zh-CN-XiaoxiaoNeural", rate: str = "+15%") -> None:
            self.voice = voice
            self.rate = rate

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
    assert [event["audio_base64"] for event in tts_events] == [
        "",
        "dHRzLQ==",
        "YXVkaW8=",
        "",
    ]
    assert [event["final"] for event in tts_events] == [False, False, False, True]
    assert tts_events[0]["metrics"]["tts_prefetch_placeholder"] == 1.0
    assert tts_events[1]["metrics"]["tts_first_audio_ms"] >= 0
    assert tts_events[1]["metrics"]["tts_queue_wait_ms"] >= 0
    assert tts_events[-1]["metrics"]["tts_total_ms"] >= 0
    assert tts_events[-1]["metrics"]["tts_audio_chunks"] == 2.0
    assert synthesized_segments[0].metrics["translation_first_token_ms"] >= 0
    assert synthesized_segments[0].metrics["translation_queue_wait_ms"] >= 0


def test_pipeline_emits_nonfatal_tts_error_when_synthesis_fails(
    monkeypatch: Any,
) -> None:
    class FailingElevenLabsTtsSynthesizer:
        def __init__(
            self,
            api_key: str,
            voice_id: str,
            model: str,
            output_format: str,
            optimize_streaming_latency: int | None,
            similarity_boost: float,
            speed: float,
            stability: float,
            style: float,
            use_speaker_boost: bool,
        ) -> None:
            self.api_key = api_key
            self.voice_id = voice_id
            self.model = model
            self.output_format = output_format
            self.optimize_streaming_latency = optimize_streaming_latency
            self.similarity_boost = similarity_boost
            self.speed = speed
            self.stability = stability
            self.style = style
            self.use_speaker_boost = use_speaker_boost

        async def synthesize(self, _segment: object) -> AsyncIterator[bytes]:
            if False:
                yield b""
            raise RuntimeError(
                "ElevenLabs TTS failed: HTTP 404 "
                '{"detail":{"code":"voice_not_found"}}'
            )

    monkeypatch.setattr(
        "echosync_agent.services.tts.factory.ElevenLabsTtsSynthesizer",
        FailingElevenLabsTtsSynthesizer,
    )

    async def run() -> list[tuple[str, object]]:
        settings = replace(
            _mock_settings(),
            tts_provider="elevenlabs",
            elevenlabs_api_key="test-key",
            elevenlabs_voice_id="missing-voice",
        )
        pipeline, event_bus = build_demo_pipeline(settings)
        await pipeline.run(_frames())
        return event_bus.events

    events = asyncio.run(run())

    event_types = [event_type for event_type, _payload in events]
    assert "segment.commit" in event_types
    tts_events = [payload for event_type, payload in events if event_type == "tts.audio"]
    assert len(tts_events) == 1
    assert tts_events[0]["audio_base64"] == ""
    assert tts_events[0]["final"] is False
    assert tts_events[0]["metrics"]["tts_prefetch_placeholder"] == 1.0

    tts_errors = [payload for event_type, payload in events if event_type == "tts.error"]
    assert len(tts_errors) == 1
    assert tts_errors[0]["type"] == "tts.error"
    assert tts_errors[0]["session_id"] == "sess_test"
    assert tts_errors[0]["code"] == "tts.elevenlabs.voice_not_found"
    assert tts_errors[0]["provider"] == "FailingElevenLabsTtsSynthesizer"
    assert tts_errors[0]["retryable"] is False
    assert "voice_not_found" in tts_errors[0]["message"]
    assert tts_errors[0]["metrics"]["tts_failed"] == 1.0
    assert tts_errors[0]["metrics"]["tts_total_ms"] >= 0


def test_pipeline_splits_long_tts_text_into_ordered_utterance_audio_streams(
    monkeypatch: Any,
) -> None:
    synthesized_segments: list[Any] = []

    class FakeEdgeTtsSynthesizer:
        def __init__(self, voice: str = "zh-CN-XiaoxiaoNeural", rate: str = "+15%") -> None:
            self.voice = voice
            self.rate = rate

        async def synthesize(self, segment: object) -> AsyncIterator[bytes]:
            synthesized_segments.append(segment)
            yield f"audio:{segment.segment_id}".encode()

    monkeypatch.setattr(
        "echosync_agent.services.tts.factory.EdgeTtsSynthesizer",
        FakeEdgeTtsSynthesizer,
    )

    async def run() -> list[tuple[str, object]]:
        settings = replace(
            _mock_settings(),
            tts_provider="edge-tts",
            tts_utterance_max_chars=18,
            tts_utterance_min_chars=6,
        )
        pipeline, event_bus = build_demo_pipeline(settings)
        await pipeline.run(_frames())
        return event_bus.events

    events = asyncio.run(run())

    assert len(synthesized_segments) >= 2
    assert [segment.metrics["tts_utterance_index"] for segment in synthesized_segments] == [
        float(index) for index in range(1, len(synthesized_segments) + 1)
    ]
    assert all(
        segment.segment_id.endswith(f"_tts{index:02d}")
        for index, segment in enumerate(synthesized_segments, start=1)
    )
    tts_events = [payload for event_type, payload in events if event_type == "tts.audio"]
    expected_segment_ids = [segment.segment_id for segment in synthesized_segments]
    assert [
        event["segment_id"]
        for event in tts_events
        if event["metrics"].get("tts_prefetch_placeholder") == 1.0
    ] == expected_segment_ids
    for segment_id in expected_segment_ids:
        segment_events = [event for event in tts_events if event["segment_id"] == segment_id]
        assert [event["audio_base64"] for event in segment_events].count("") == 2
        assert [event["final"] for event in segment_events].count(True) == 1


def test_pipeline_forwards_caption_update_events_to_caption_event_bus() -> None:
    asyncio.run(_assert_pipeline_forwards_caption_update_events_to_caption_event_bus())


def test_pipeline_semantic_repair_publishes_final_caption_update_after_commit() -> None:
    asyncio.run(_assert_pipeline_semantic_repair_publishes_final_caption_update_after_commit())


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


async def _assert_pipeline_semantic_repair_publishes_final_caption_update_after_commit() -> None:
    release_repair = asyncio.Event()
    repair_started = asyncio.Event()
    sink = _RecordingSubtitleSink()
    pipeline = EngineDrivenInterpretationPipeline(
        engine=_OneCommitEngine(),
        subtitle_sink=sink,
        translation_repair_engine=_BlockingRepairEngine(
            repair_started=repair_started,
            release_repair=release_repair,
        ),
        translation_repair_mode="debug_all",
    )

    task = asyncio.create_task(pipeline.run(_frames()))
    await asyncio.wait_for(repair_started.wait(), timeout=0.2)

    assert sink.events == [("segment.commit", "seg_repair")]

    release_repair.set()
    await asyncio.wait_for(task, timeout=0.2)

    assert sink.events == [
        ("segment.commit", "seg_repair"),
        ("caption_update", "seg_repair"),
    ]
    update = sink.caption_updates[0]
    assert update["state"] == "final"
    assert update["revision"] == 2
    assert update["target"]["full_text"] == "英国的这个地区更依赖季节性经济。"
    assert update["metrics"]["semantic_revision_changed_chars"] == 12.0


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
        deepl_api_key="",
        deepl_base_url="https://api-free.deepl.com",
        deepl_model_type="latency_optimized",
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


class _OneCommitEngine:
    async def stream(self, _frames: Any):
        yield SegmentCommit(
            session_id="sess_repair",
            segment_id="seg_repair",
            rev=1,
            start_ms=0,
            end_ms=1_800,
            source_lang="en",
            target_lang="zh-CN",
            source_text="So this part of the UK has more of a seasonal economy.",
            target_text="所以这部分英国，更像季节性经济。",
            metrics={"target_discourse_marker_trimmed": 1.0},
        )


class _BlockingRepairEngine:
    def __init__(
        self,
        *,
        repair_started: asyncio.Event,
        release_repair: asyncio.Event,
    ) -> None:
        self.repair_started = repair_started
        self.release_repair = release_repair

    async def repair(
        self,
        segment: TranslationSegment,
        _context: Any,
        *,
        reason: str = "",
    ) -> TranslationSegment:
        self.repair_started.set()
        await self.release_repair.wait()
        return replace(
            segment,
            rev=segment.rev + 1,
            target_text="英国的这个地区更依赖季节性经济。",
            target_stable_text="英国的这个地区更依赖季节性经济。",
            metrics={
                **segment.metrics,
                "semantic_revision_changed_chars": 12.0,
                "semantic_revision_latency_ms": 20.0,
            },
        )


class _RecordingSubtitleSink:
    def __init__(self) -> None:
        self.events: list[tuple[str, str]] = []
        self.caption_updates: list[dict[str, Any]] = []

    async def publish_translation(self, segment: object) -> None:
        self.events.append(("translation.partial", getattr(segment, "segment_id", "")))

    async def publish_patch(self, patch: object) -> None:
        self.events.append(("translation.patch", getattr(patch, "segment_id", "")))

    async def publish_commit(self, commit: SegmentCommit) -> None:
        self.events.append(("segment.commit", commit.segment_id))

    async def publish_caption_update(self, event: dict[str, Any]) -> None:
        self.caption_updates.append(event)
        self.events.append(("caption_update", str(event["segment_id"])))
