from __future__ import annotations

from dataclasses import dataclass, replace
from os import getenv

SUPPORTED_ASR_PROVIDERS = frozenset({"mock", "funasr", "voxtral"})
NEXT_ASR_PROVIDER_CANDIDATES = frozenset({"deepgram", "azure"})
SUPPORTED_ASR_LATENCY_MODES = frozenset({"low_latency", "balanced", "accuracy"})
SUPPORTED_TRANSLATION_PROVIDERS = frozenset({"mock", "deepseek"})


@dataclass(frozen=True, slots=True)
class Settings:
    asr_provider: str
    translator_provider: str
    tts_provider: str
    target_lang: str
    funasr_model: str
    funasr_device: str
    funasr_chunk_ms: int
    asr_server_port: int
    deepseek_api_key: str
    deepseek_base_url: str
    deepseek_model: str
    edge_tts_voice: str
    mistral_api_key: str
    voxtral_model: str
    voxtral_target_delay_ms: int
    asr_latency_mode: str = "balanced"
    funasr_vad_enabled: bool = False
    funasr_vad_silence_ms: int = 300
    funasr_vad_activation_threshold: float = 0.5
    glossary_enabled: bool = True
    glossary_domain: str = "default"
    glossary_terms_dir: str = ""

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            asr_provider=getenv("ECHOSYNC_ASR_PROVIDER", "mock"),
            translator_provider=getenv("ECHOSYNC_TRANSLATOR_PROVIDER", "mock"),
            tts_provider=getenv("ECHOSYNC_TTS_PROVIDER", "disabled"),
            target_lang=getenv("ECHOSYNC_TARGET_LANG", "zh-CN"),
            funasr_model=getenv("FUNASR_MODEL", "paraformer-zh-streaming"),
            funasr_device=getenv("FUNASR_DEVICE", "auto"),
            funasr_chunk_ms=int(getenv("FUNASR_CHUNK_MS", "600")),
            asr_server_port=int(getenv("ECHOSYNC_ASR_SERVER_PORT", "8765")),
            deepseek_api_key=getenv("DEEPSEEK_API_KEY", ""),
            deepseek_base_url=getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
            deepseek_model=getenv("DEEPSEEK_MODEL", "deepseek-chat"),
            edge_tts_voice=getenv("EDGE_TTS_VOICE", "zh-CN-XiaoxiaoNeural"),
            mistral_api_key=getenv("MISTRAL_API_KEY", ""),
            voxtral_model=getenv("VOXTRAL_MODEL", "voxtral-mini-transcribe-realtime-2602"),
            voxtral_target_delay_ms=int(getenv("VOXTRAL_TARGET_DELAY_MS", "1000")),
            asr_latency_mode=getenv("ECHOSYNC_ASR_LATENCY_MODE", "balanced"),
            funasr_vad_enabled=getenv("FUNASR_VAD_ENABLED", "false").lower()
            in ("true", "1", "yes"),
            funasr_vad_silence_ms=int(getenv("FUNASR_VAD_SILENCE_MS", "300")),
            funasr_vad_activation_threshold=float(
                getenv("FUNASR_VAD_ACTIVATION_THRESHOLD", "0.5")
            ),
            glossary_enabled=getenv("ECHOSYNC_GLOSSARY_ENABLED", "true").lower()
            in ("true", "1", "yes"),
            glossary_domain=getenv("ECHOSYNC_GLOSSARY_DOMAIN", "default"),
            glossary_terms_dir=getenv("ECHOSYNC_GLOSSARY_TERMS_DIR", ""),
        )


def with_session_asr_overrides(
    settings: Settings,
    *,
    asr_latency_mode: object | None = None,
    asr_provider: object | None = None,
) -> Settings:
    """应用来自单个 realtime session 的 ASR 选择。

    API key、模型 URL 等敏感配置仍来自服务端环境变量；客户端只允许选择
    已知 provider 和延迟模式。
    """

    updates: dict[str, str] = {}
    if asr_provider is not None:
        provider = str(asr_provider).strip().lower()
        if provider in NEXT_ASR_PROVIDER_CANDIDATES:
            raise ValueError(
                f"{provider.title()} ASR 尚未接入，本轮可选 provider：mock、funasr、voxtral"
            )
        if provider not in SUPPORTED_ASR_PROVIDERS:
            raise ValueError(f"不支持的 ASR provider：{provider}")
        updates["asr_provider"] = provider

    if asr_latency_mode is not None:
        mode = str(asr_latency_mode).strip().lower()
        if mode not in SUPPORTED_ASR_LATENCY_MODES:
            raise ValueError(f"不支持的 ASR 延迟模式：{mode}")
        updates["asr_latency_mode"] = mode

    if not updates:
        return settings
    return replace(settings, **updates)


def with_session_translation_overrides(
    settings: Settings,
    *,
    translation_provider: object | None = None,
) -> Settings:
    """应用来自单个 realtime session 的翻译模型选择。

    客户端只声明 provider id；API key、base URL 和模型名仍由服务端环境变量控制。
    """

    if translation_provider is None:
        return settings

    provider = str(translation_provider).strip().lower()
    if not provider:
        return settings
    if provider not in SUPPORTED_TRANSLATION_PROVIDERS:
        raise ValueError(f"不支持的翻译 provider：{provider}")
    if provider == settings.translator_provider:
        return settings
    return replace(settings, translator_provider=provider)
