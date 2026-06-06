from __future__ import annotations

import pytest

from echosync_agent.runtime.settings import Settings
from echosync_agent.services.asr.factory import build_transcriber_from_settings
from echosync_agent.services.asr.funasr_transcriber import FunAsrTranscriber
from echosync_agent.services.asr.mock_transcriber import MockTranscriber
from echosync_agent.services.asr.semantic_chunker import FrameVadDetector
from echosync_agent.services.asr.voxtral_transcriber import VoxtralRealtimeTranscriber


def test_asr_factory_builds_mock_transcriber() -> None:
    transcriber = build_transcriber_from_settings(_settings(asr_provider="mock"))

    assert isinstance(transcriber, MockTranscriber)


def test_asr_factory_builds_funasr_transcriber() -> None:
    transcriber = build_transcriber_from_settings(
        _settings(
            asr_provider="funasr",
            funasr_model="paraformer-zh-streaming",
            funasr_device="cpu",
            funasr_chunk_ms=600,
        )
    )

    assert isinstance(transcriber, FunAsrTranscriber)
    assert transcriber.config.model == "paraformer-zh-streaming"
    assert transcriber.config.device == "cpu"
    assert transcriber.config.chunk_ms == 600


def test_asr_factory_injects_funasr_vad_detector_when_enabled() -> None:
    detector = StubVadDetector()

    transcriber = build_transcriber_from_settings(
        _settings(
            asr_provider="funasr",
            funasr_vad_enabled=True,
            funasr_vad_silence_ms=240,
        ),
        vad_detector_factory=lambda settings: detector,
    )

    assert isinstance(transcriber, FunAsrTranscriber)
    assert transcriber.vad_detector is detector
    assert transcriber.config.vad_silence_ms == 240


def test_asr_factory_skips_funasr_vad_detector_when_disabled() -> None:
    called = False

    def factory(_: Settings) -> FrameVadDetector:
        nonlocal called
        called = True
        return StubVadDetector()

    transcriber = build_transcriber_from_settings(
        _settings(
            asr_provider="funasr",
            funasr_vad_enabled=False,
        ),
        vad_detector_factory=factory,
    )

    assert isinstance(transcriber, FunAsrTranscriber)
    assert transcriber.vad_detector is None
    assert called is False


@pytest.mark.parametrize(
    ("latency_mode", "expected_chunk_ms"),
    [
        ("low_latency", 320),
        ("balanced", 600),
        ("accuracy", 900),
    ],
)
def test_asr_factory_maps_funasr_latency_mode_to_inference_window(
    latency_mode: str,
    expected_chunk_ms: int,
) -> None:
    transcriber = build_transcriber_from_settings(
        _settings(
            asr_provider="funasr",
            asr_latency_mode=latency_mode,
            funasr_chunk_ms=600,
        )
    )

    assert isinstance(transcriber, FunAsrTranscriber)
    assert transcriber.config.chunk_ms == expected_chunk_ms


def test_asr_factory_builds_voxtral_transcriber() -> None:
    transcriber = build_transcriber_from_settings(
        _settings(
            asr_provider="voxtral",
            mistral_api_key="test-key",
            voxtral_model="voxtral-mini-transcribe-realtime-2602",
            voxtral_target_delay_ms=480,
        )
    )

    assert isinstance(transcriber, VoxtralRealtimeTranscriber)
    assert transcriber.config.api_key == "test-key"
    assert transcriber.config.model == "voxtral-mini-transcribe-realtime-2602"
    assert transcriber.config.target_streaming_delay_ms == 480


@pytest.mark.parametrize(
    ("latency_mode", "expected_delay_ms"),
    [
        ("low_latency", 480),
        ("balanced", 1000),
        ("accuracy", 1600),
    ],
)
def test_asr_factory_maps_voxtral_latency_mode_to_target_streaming_delay(
    latency_mode: str,
    expected_delay_ms: int,
) -> None:
    transcriber = build_transcriber_from_settings(
        _settings(
            asr_provider="voxtral",
            asr_latency_mode=latency_mode,
            mistral_api_key="test-key",
            voxtral_target_delay_ms=1000,
        )
    )

    assert isinstance(transcriber, VoxtralRealtimeTranscriber)
    assert transcriber.config.target_streaming_delay_ms == expected_delay_ms


def test_asr_factory_requires_mistral_api_key_for_voxtral() -> None:
    with pytest.raises(ValueError, match="MISTRAL_API_KEY"):
        build_transcriber_from_settings(_settings(asr_provider="voxtral", mistral_api_key=""))


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
        "edge_tts_voice": "zh-CN-XiaoxiaoNeural",
        "mistral_api_key": "",
        "voxtral_model": "voxtral-mini-transcribe-realtime-2602",
        "voxtral_target_delay_ms": 1000,
        "funasr_vad_enabled": False,
    }
    values.update(overrides)
    return Settings(**values)


class StubVadDetector(FrameVadDetector):
    def is_speech(self, frame: object) -> bool:
        return True
