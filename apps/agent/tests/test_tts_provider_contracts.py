from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from echosync_agent.domain import SegmentStatus, TranslatedAudioChunk, TranslationSegment
from echosync_agent.runtime.event_bus import InMemoryEventBus
from echosync_agent.runtime.settings import Settings
from echosync_agent.services.tts.edge_tts_synthesizer import EdgeTtsSynthesizer
from echosync_agent.services.tts.elevenlabs_synthesizer import ElevenLabsTtsSynthesizer
from echosync_agent.services.tts.event_audio_sink import EventTranslatedAudioSink
from echosync_agent.services.tts.factory import build_tts_synthesizer_from_settings
from echosync_agent.services.tts.utterance_splitter import TtsUtteranceSplitter


def test_tts_factory_builds_disabled_edge_and_elevenlabs_providers() -> None:
    assert build_tts_synthesizer_from_settings(_settings(tts_provider="disabled")) is None
    edge = build_tts_synthesizer_from_settings(
        _settings(tts_provider="edge-tts", edge_tts_rate="+20%")
    )
    assert isinstance(edge, EdgeTtsSynthesizer)
    assert edge.rate == "+20%"

    elevenlabs = build_tts_synthesizer_from_settings(
        _settings(
            tts_provider="elevenlabs",
            elevenlabs_api_key="test-key",
            elevenlabs_voice_id="voice-1",
            elevenlabs_speed=1.18,
            elevenlabs_stability=0.9,
            elevenlabs_style=0.0,
            elevenlabs_use_speaker_boost=False,
        )
    )
    assert isinstance(elevenlabs, ElevenLabsTtsSynthesizer)
    assert elevenlabs.speed == 1.18
    assert elevenlabs.stability == 0.9
    assert elevenlabs.style == 0.0
    assert elevenlabs.use_speaker_boost is False


def test_tts_factory_rejects_elevenlabs_without_key_or_voice() -> None:
    try:
        build_tts_synthesizer_from_settings(
            _settings(
                tts_provider="elevenlabs",
                elevenlabs_api_key="",
                elevenlabs_voice_id="voice-1",
            )
        )
    except ValueError as exc:
        assert "ELEVENLABS_API_KEY" in str(exc)
    else:
        raise AssertionError("ElevenLabs TTS must require an API key")

    try:
        build_tts_synthesizer_from_settings(
            _settings(
                tts_provider="elevenlabs",
                elevenlabs_api_key="test-key",
                elevenlabs_voice_id="",
            )
        )
    except ValueError as exc:
        assert "ELEVENLABS_VOICE_ID" in str(exc)
    else:
        raise AssertionError("ElevenLabs TTS must require a voice id")


def test_elevenlabs_synthesizer_streams_audio_with_configured_request() -> None:
    fake_client = _FakeElevenLabsClient([b"audio-1", b"audio-2"])
    synthesizer = ElevenLabsTtsSynthesizer(
        api_key="test-key",
        voice_id="voice-1",
        model="eleven_multilingual_v2",
        output_format="mp3_44100_128",
        optimize_streaming_latency=2,
        client=fake_client,
    )

    chunks = asyncio.run(_collect_bytes(synthesizer.synthesize(_segment("你好，欢迎。"))))

    assert chunks == [b"audio-1", b"audio-2"]
    assert fake_client.requests == [
        {
            "api_key": "test-key",
            "voice_id": "voice-1",
            "model": "eleven_multilingual_v2",
            "output_format": "mp3_44100_128",
            "optimize_streaming_latency": 2,
            "similarity_boost": 0.75,
            "speed": 1.15,
            "stability": 0.85,
            "style": 0.0,
            "text": "你好，欢迎。",
            "use_speaker_boost": False,
        }
    ]


def test_tts_utterance_splitter_splits_long_translation_into_small_independent_segments() -> None:
    segment = _segment(
        "第一句先快速播报。第二句继续播报，避免长段等待。第三句也要单独进入语音队列。"
    )
    utterances = TtsUtteranceSplitter(max_chars=18, min_chars=6).split(segment)

    assert [item.target_text for item in utterances] == [
        "第一句先快速播报。",
        "第二句继续播报，",
        "避免长段等待。",
        "第三句也要单独进入语音队列。",
    ]
    assert [item.segment_id for item in utterances] == [
        "seg_tts_tts01",
        "seg_tts_tts02",
        "seg_tts_tts03",
        "seg_tts_tts04",
    ]
    assert utterances[0].metrics["tts_utterance_index"] == 1.0
    assert utterances[-1].metrics["tts_utterance_count"] == 4.0


def test_tts_utterance_splitter_prefers_comma_boundaries_even_for_short_text() -> None:
    segment = _segment("这里先快速播报，下一段马上接上。")

    utterances = TtsUtteranceSplitter(max_chars=42, min_chars=6).split(segment)

    assert [item.target_text for item in utterances] == [
        "这里先快速播报，",
        "下一段马上接上。",
    ]
    assert [item.segment_id for item in utterances] == [
        "seg_tts_tts01",
        "seg_tts_tts02",
    ]
    assert utterances[0].metrics["tts_utterance_count"] == 2.0


def test_event_audio_sink_publishes_tts_audio_as_base64_event() -> None:
    async def run() -> InMemoryEventBus:
        event_bus = InMemoryEventBus()
        sink = EventTranslatedAudioSink(event_bus)
        await sink.publish_audio(
            TranslatedAudioChunk(
                session_id="sess_tts",
                segment_id="seg_tts",
                rev=3,
                start_ms=100,
                end_ms=1200,
                target_lang="zh-CN",
                audio=b"audio-bytes",
                mime_type="audio/mpeg",
                final=True,
                metrics={"tts_first_audio_ms": 120.0},
            )
        )
        return event_bus

    event_bus = asyncio.run(run())

    assert event_bus.events == [
        (
            "tts.audio",
            {
                "type": "tts.audio",
                "session_id": "sess_tts",
                "segment_id": "seg_tts",
                "rev": 3,
                "start_ms": 100,
                "end_ms": 1200,
                "target_lang": "zh-CN",
                "audio_base64": "YXVkaW8tYnl0ZXM=",
                "mime_type": "audio/mpeg",
                "sample_rate": None,
                "final": True,
                "metrics": {"tts_first_audio_ms": 120.0},
            },
        )
    ]


def test_event_audio_sink_publishes_nonfatal_tts_error_event() -> None:
    async def run() -> InMemoryEventBus:
        event_bus = InMemoryEventBus()
        sink = EventTranslatedAudioSink(event_bus)
        await sink.publish_error(
            {
                "session_id": "sess_tts",
                "segment_id": "seg_tts",
                "rev": 3,
                "start_ms": 100,
                "end_ms": 1200,
                "target_lang": "zh-CN",
                "provider": "ElevenLabsTtsSynthesizer",
                "message": "ElevenLabs TTS failed: HTTP 404 voice_not_found",
                "code": "tts.elevenlabs.voice_not_found",
                "retryable": False,
                "target_text": "你好，欢迎。",
                "metrics": {"tts_failed": 1.0},
            }
        )
        return event_bus

    event_bus = asyncio.run(run())

    assert event_bus.events == [
        (
            "tts.error",
            {
                "type": "tts.error",
                "session_id": "sess_tts",
                "segment_id": "seg_tts",
                "rev": 3,
                "start_ms": 100,
                "end_ms": 1200,
                "target_lang": "zh-CN",
                "provider": "ElevenLabsTtsSynthesizer",
                "message": "ElevenLabs TTS failed: HTTP 404 voice_not_found",
                "code": "tts.elevenlabs.voice_not_found",
                "retryable": False,
                "target_text": "你好，欢迎。",
                "metrics": {"tts_failed": 1.0},
            },
        )
    ]


async def _collect_bytes(chunks: AsyncIterator[bytes]) -> list[bytes]:
    return [chunk async for chunk in chunks]


class _FakeElevenLabsClient:
    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = chunks
        self.requests: list[dict[str, object]] = []

    async def stream_text_to_speech(
        self,
        *,
        api_key: str,
        voice_id: str,
        model: str,
        output_format: str,
        optimize_streaming_latency: int | None,
        similarity_boost: float,
        speed: float,
        stability: float,
        style: float,
        text: str,
        use_speaker_boost: bool,
    ) -> AsyncIterator[bytes]:
        self.requests.append(
            {
                "api_key": api_key,
                "voice_id": voice_id,
                "model": model,
                "output_format": output_format,
                "optimize_streaming_latency": optimize_streaming_latency,
                "similarity_boost": similarity_boost,
                "speed": speed,
                "stability": stability,
                "style": style,
                "text": text,
                "use_speaker_boost": use_speaker_boost,
            }
        )
        for chunk in self.chunks:
            yield chunk


def _segment(text: str) -> TranslationSegment:
    return TranslationSegment(
        session_id="sess_tts",
        segment_id="seg_tts",
        rev=1,
        source_rev=1,
        start_ms=0,
        end_ms=1200,
        source_lang="en",
        target_lang="zh-CN",
        source_text="Welcome.",
        target_text=text,
        status=SegmentStatus.COMMITTED,
        stability=1.0,
    )


def _settings(**overrides: object) -> Settings:
    values = {
        "asr_provider": "mock",
        "translator_provider": "mock",
        "tts_provider": "disabled",
        "target_lang": "zh-CN",
        "funasr_model": "paraformer-zh-streaming",
        "funasr_device": "auto",
        "funasr_chunk_ms": 600,
        "asr_server_port": 8765,
        "deepseek_api_key": "",
        "deepseek_base_url": "https://api.deepseek.com/v1",
        "deepseek_model": "deepseek-chat",
        "deepl_api_key": "",
        "deepl_base_url": "https://api-free.deepl.com",
        "deepl_model_type": "latency_optimized",
        "edge_tts_voice": "zh-CN-XiaoxiaoNeural",
        "elevenlabs_api_key": "",
        "elevenlabs_voice_id": "",
        "elevenlabs_model": "eleven_multilingual_v2",
        "elevenlabs_output_format": "mp3_44100_128",
        "elevenlabs_optimize_streaming_latency": None,
        "mistral_api_key": "",
        "voxtral_model": "voxtral-mini-transcribe-realtime-2602",
        "voxtral_target_delay_ms": 1000,
    }
    values.update(overrides)
    return Settings(**values)
