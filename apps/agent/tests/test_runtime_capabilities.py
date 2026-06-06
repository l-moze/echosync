from __future__ import annotations

from echosync_agent.runtime.capabilities import build_realtime_capabilities
from echosync_agent.runtime.settings import Settings


def test_capabilities_report_defaults_and_provider_readiness() -> None:
    capabilities = build_realtime_capabilities(
        _settings(
            asr_provider="voxtral",
            translator_provider="deepseek",
            mistral_api_key="",
            deepseek_api_key="",
        ),
        dependency_available=lambda name: name in {"funasr", "modelscope", "openai"},
    )

    assert capabilities["defaults"] == {
        "asr_latency_mode": "balanced",
        "asr_provider": "voxtral",
        "target_lang": "zh-CN",
        "translation_provider": "deepseek",
    }
    assert _provider(capabilities["asr_providers"], "mock")["real_audio_supported"] is False
    assert _provider(capabilities["asr_providers"], "funasr")["status"] == "ready"
    assert _provider(capabilities["asr_providers"], "voxtral")["status"] == "missing_key"
    assert _provider(capabilities["translation_providers"], "deepseek")["status"] == "missing_key"


def test_capabilities_report_missing_dependencies_without_importing_sdks() -> None:
    capabilities = build_realtime_capabilities(
        _settings(
            asr_provider="funasr",
            translator_provider="deepseek",
            mistral_api_key="test-key",
            deepseek_api_key="test-key",
        ),
        dependency_available=lambda _name: False,
    )

    assert _provider(capabilities["asr_providers"], "funasr")["status"] == "missing_dependency"
    assert _provider(capabilities["asr_providers"], "voxtral")["status"] == "missing_dependency"
    assert (
        _provider(capabilities["translation_providers"], "deepseek")["status"]
        == "missing_dependency"
    )


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
        "edge_tts_voice": "zh-CN-XiaoxiaoNeural",
        "mistral_api_key": "",
        "voxtral_model": "voxtral-mini-transcribe-realtime-2602",
        "voxtral_target_delay_ms": 1000,
    }
    values.update(overrides)
    return Settings(**values)
