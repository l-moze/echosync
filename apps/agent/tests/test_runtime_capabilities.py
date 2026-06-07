from __future__ import annotations

from echosync_agent.runtime import capabilities as capabilities_module
from echosync_agent.runtime.capabilities import (
    ElevenLabsVoiceValidation,
    build_realtime_capabilities,
)
from echosync_agent.runtime.settings import Settings


def test_capabilities_report_defaults_and_provider_readiness() -> None:
    capabilities = build_realtime_capabilities(
        _settings(
            asr_provider="voxtral",
            translator_provider="deepseek",
            mistral_api_key="",
            deepseek_api_key="",
        ),
        dependency_available=lambda name: name in {
            "edge_tts",
            "websockets",
            "funasr",
            "modelscope",
            "openai",
            "torch",
        },
    )

    assert capabilities["defaults"] == {
        "asr_latency_mode": "balanced",
        "asr_provider": "voxtral",
        "target_lang": "zh-CN",
        "translation_provider": "deepseek",
        "tts_provider": "disabled",
    }
    assert _provider(capabilities["asr_providers"], "mock")["real_audio_supported"] is False
    assert _provider(capabilities["asr_providers"], "funasr")["status"] == "ready"
    assert _provider(capabilities["asr_providers"], "voxtral")["status"] == "missing_key"
    assert _provider(capabilities["asr_providers"], "deepgram")["status"] == "missing_key"
    assert not any(provider["id"] == "qwen-livetranslate" for provider in capabilities["asr_providers"])
    assert _provider(capabilities["translation_providers"], "deepseek")["status"] == "missing_key"
    assert _provider(capabilities["translation_providers"], "qwen-livetranslate")["kind"] == "translation"
    assert _provider(capabilities["translation_providers"], "qwen-livetranslate")["status"] == "missing_key"
    assert _provider(capabilities["tts_providers"], "disabled")["status"] == "ready"
    assert _provider(capabilities["tts_providers"], "edge-tts")["status"] == "ready"
    assert _provider(capabilities["tts_providers"], "elevenlabs")["status"] == "missing_key"


def test_capabilities_report_missing_dependencies_without_importing_sdks() -> None:
    capabilities = build_realtime_capabilities(
        _settings(
            asr_provider="funasr",
            translator_provider="deepseek",
            mistral_api_key="test-key",
            deepseek_api_key="test-key",
            deepgram_api_key="test-key",
        ),
        dependency_available=lambda _name: False,
    )

    assert _provider(capabilities["asr_providers"], "funasr")["status"] == "missing_dependency"
    assert _provider(capabilities["asr_providers"], "voxtral")["status"] == "missing_dependency"
    assert _provider(capabilities["asr_providers"], "deepgram")["status"] == "missing_dependency"
    assert (
        _provider(capabilities["translation_providers"], "deepseek")["status"]
        == "missing_dependency"
    )
    assert _provider(capabilities["tts_providers"], "edge-tts")["status"] == "missing_dependency"


def test_capabilities_mark_funasr_unavailable_when_torch_is_missing() -> None:
    capabilities = build_realtime_capabilities(
        _settings(asr_provider="funasr"),
        dependency_available=lambda name: name in {"funasr", "modelscope"},
    )

    funasr = _provider(capabilities["asr_providers"], "funasr")
    assert funasr["status"] == "missing_dependency"
    assert funasr["available"] is False
    assert "torch" in str(funasr["reason"])


def test_capabilities_validate_elevenlabs_voice_before_marking_ready() -> None:
    capabilities = build_realtime_capabilities(
        _settings(
            elevenlabs_api_key="test-key",
            elevenlabs_voice_id="voice-ready",
        ),
        elevenlabs_voice_validator=lambda _settings: ElevenLabsVoiceValidation(
            status="ready",
            available=True,
            voice_name="Anna Su",
        ),
    )

    elevenlabs = _provider(capabilities["tts_providers"], "elevenlabs")
    assert elevenlabs["status"] == "ready"
    assert elevenlabs["available"] is True
    assert elevenlabs["voice_name"] == "Anna Su"
    assert elevenlabs["voice_id"] == "voice...eady(len=11)"


def test_capabilities_mark_elevenlabs_unavailable_when_voice_id_is_not_accessible() -> None:
    capabilities = build_realtime_capabilities(
        _settings(
            elevenlabs_api_key="test-key",
            elevenlabs_voice_id="missing-voice",
        ),
        elevenlabs_voice_validator=lambda _settings: ElevenLabsVoiceValidation(
            status="unavailable",
            available=False,
            reason="ELEVENLABS_VOICE_ID 不属于当前 ElevenLabs API key。",
        ),
    )

    elevenlabs = _provider(capabilities["tts_providers"], "elevenlabs")
    assert elevenlabs["status"] == "unavailable"
    assert elevenlabs["available"] is False
    assert "ELEVENLABS_VOICE_ID" in str(elevenlabs["reason"])


def test_capabilities_mark_elevenlabs_unavailable_when_tts_probe_requires_paid_plan(
    monkeypatch,
) -> None:
    capabilities_module._validate_elevenlabs_voice_cached.cache_clear()
    monkeypatch.setattr(
        capabilities_module,
        "_get_elevenlabs_voice",
        lambda **_kwargs: (200, {"name": "Chihiro Yoko"}),
    )
    monkeypatch.setattr(
        capabilities_module,
        "_probe_elevenlabs_tts",
        lambda **_kwargs: (402, {"detail": {"code": "paid_plan_required"}}),
    )

    capabilities = build_realtime_capabilities(
        _settings(
            elevenlabs_api_key="test-key",
            elevenlabs_voice_id="paid-plan-voice",
        )
    )

    elevenlabs = _provider(capabilities["tts_providers"], "elevenlabs")
    assert elevenlabs["status"] == "unavailable"
    assert elevenlabs["available"] is False
    assert elevenlabs["voice_name"] == "Chihiro Yoko"
    assert "paid_plan_required" in str(elevenlabs["reason"])


def _provider(providers: list[dict[str, object]], provider_id: str) -> dict[str, object]:
    return next(provider for provider in providers if provider["id"] == provider_id)


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
        "deepgram_api_key": "",
        "deepgram_model": "nova-3",
        "deepgram_language": "en",
        "deepgram_endpointing_ms": 300,
    }
    values.update(overrides)
    return Settings(**values)
