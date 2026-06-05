from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from echosync_agent.domain import (
    AudioFrame,
    InterpretationEvent,
    ModelCapability,
    ModelMode,
    ModelProfile,
    SegmentCommit,
    SegmentStatus,
    TranslatedAudioChunk,
    TranslationSegment,
)
from echosync_agent.interfaces import TranslatedAudioSink
from echosync_agent.pipeline import EngineDrivenInterpretationPipeline
from echosync_agent.runtime.event_bus import InMemoryEventBus
from echosync_agent.services.subtitle.event_sink import EventSubtitleSink


async def _frames() -> AsyncIterator[AudioFrame]:
    yield AudioFrame(
        session_id="sess_e2e",
        seq=1,
        pcm=b"Native realtime translation can emit audio directly.",
        sample_rate=16_000,
        channels=1,
        start_ms=0,
        end_ms=2000,
        source_lang="en",
    )


class FakeEndToEndEngine:
    @property
    def profile(self) -> ModelProfile:
        return ModelProfile(
            provider="fake",
            model="native-speech-translation",
            mode=ModelMode.END_TO_END,
            capabilities=(ModelCapability.SPEECH_TRANSLATION, ModelCapability.TTS),
            source_lang="en",
            target_lang="zh-CN",
        )

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[InterpretationEvent]:
        async for frame in frames:
            segment = TranslationSegment(
                session_id=frame.session_id,
                segment_id="seg_e2e",
                rev=1,
                source_rev=1,
                start_ms=frame.start_ms,
                end_ms=frame.end_ms,
                source_lang=frame.source_lang,
                target_lang="zh-CN",
                source_text="Native realtime translation can emit audio directly.",
                target_text="原生实时翻译可以直接输出音频。",
                status=SegmentStatus.COMMITTED,
                stability=1.0,
            )
            yield segment
            yield TranslatedAudioChunk(
                session_id=segment.session_id,
                segment_id=segment.segment_id,
                rev=segment.rev,
                start_ms=segment.start_ms,
                end_ms=segment.end_ms,
                target_lang=segment.target_lang,
                audio=b"translated-audio",
                mime_type="audio/pcm",
                sample_rate=24_000,
                final=True,
            )
            yield SegmentCommit(
                session_id=segment.session_id,
                segment_id=segment.segment_id,
                rev=segment.rev,
                start_ms=segment.start_ms,
                end_ms=segment.end_ms,
                source_lang=segment.source_lang,
                target_lang=segment.target_lang,
                source_text=segment.source_text,
                target_text=segment.target_text,
            )


class CollectingAudioSink(TranslatedAudioSink):
    def __init__(self) -> None:
        self.chunks: list[TranslatedAudioChunk] = []

    async def publish_audio(self, chunk: TranslatedAudioChunk) -> None:
        self.chunks.append(chunk)


def test_end_to_end_engine_can_share_the_output_pipeline() -> None:
    asyncio.run(_assert_end_to_end_engine_can_share_the_output_pipeline())


async def _assert_end_to_end_engine_can_share_the_output_pipeline() -> None:
    event_bus = InMemoryEventBus()
    audio_sink = CollectingAudioSink()
    pipeline = EngineDrivenInterpretationPipeline(
        engine=FakeEndToEndEngine(),
        subtitle_sink=EventSubtitleSink(event_bus),
        audio_sink=audio_sink,
    )

    await pipeline.run(_frames())

    event_types = [event_type for event_type, _ in event_bus.events]
    assert event_types == ["translation.partial", "segment.commit"]
    assert event_bus.events[0][1]["target_text"] == "原生实时翻译可以直接输出音频。"
    assert audio_sink.chunks[0].audio == b"translated-audio"
    assert audio_sink.chunks[0].final is True
