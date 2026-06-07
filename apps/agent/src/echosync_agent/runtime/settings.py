from __future__ import annotations

from dataclasses import dataclass, replace
from os import getenv

SUPPORTED_ASR_PROVIDERS = frozenset(
    {"mock", "funasr", "voxtral", "deepgram", "qwen-asr", "qwen-livetranslate"}
)
NEXT_ASR_PROVIDER_CANDIDATES = frozenset({"azure"})
SUPPORTED_ASR_LATENCY_MODES = frozenset({"low_latency", "balanced", "accuracy"})
SUPPORTED_TRANSLATION_PROVIDERS = frozenset({"mock", "deepseek", "deepl"})
SUPPORTED_TRANSLATION_REPAIR_PROVIDERS = frozenset({"disabled", "deepseek"})
SUPPORTED_TRANSLATION_REPAIR_MODES = frozenset({"suspect_only", "debug_all"})
SUPPORTED_TTS_PROVIDERS = frozenset({"disabled", "edge-tts", "elevenlabs"})


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
    deepl_api_key: str
    deepl_base_url: str
    deepl_model_type: str
    edge_tts_voice: str
    elevenlabs_api_key: str
    elevenlabs_voice_id: str
    elevenlabs_model: str
    elevenlabs_output_format: str
    elevenlabs_optimize_streaming_latency: int | None
    mistral_api_key: str
    voxtral_model: str
    voxtral_target_delay_ms: int
    edge_tts_rate: str = "+15%"
    elevenlabs_speed: float = 1.15
    tts_utterance_max_chars: int = 42
    tts_utterance_min_chars: int = 8
    tts_prefetch_concurrency: int = 2
    deepgram_api_key: str = ""
    deepgram_model: str = "nova-3"
    deepgram_language: str = "en"
    deepgram_endpointing_ms: int = 300
    qwen_api_key: str = ""
    qwen_realtime_base_url: str = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
    qwen_asr_model: str = "qwen3-asr-flash-realtime-2026-02-10"
    qwen_asr_language: str = "auto"
    qwen_asr_vad_silence_ms: int = 800
    qwen_livetranslate_model: str = "qwen3.5-livetranslate-flash-realtime"
    qwen_livetranslate_source_lang: str = "auto"
    qwen_livetranslate_output_audio: bool = False
    asr_latency_mode: str = "balanced"
    funasr_vad_enabled: bool = False
    funasr_vad_silence_ms: int = 300
    funasr_vad_activation_threshold: float = 0.5
    glossary_enabled: bool = True
    glossary_domain: str = "default"
    glossary_terms_dir: str = ""
    translation_repair_provider: str = "disabled"
    translation_repair_model: str = "deepseek-chat"
    translation_repair_timeout_ms: int = 1500
    translation_repair_max_concurrency: int = 1
    translation_repair_mode: str = "suspect_only"

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
            deepl_api_key=getenv("DEEPL_API_KEY", ""),
            deepl_base_url=getenv("DEEPL_BASE_URL", "https://api-free.deepl.com"),
            deepl_model_type=getenv("DEEPL_MODEL_TYPE", "latency_optimized"),
            edge_tts_voice=getenv("EDGE_TTS_VOICE", "zh-CN-XiaoxiaoNeural"),
            edge_tts_rate=getenv("EDGE_TTS_RATE", "+15%"),
            elevenlabs_api_key=getenv("ELEVENLABS_API_KEY", ""),
            elevenlabs_voice_id=getenv("ELEVENLABS_VOICE_ID", ""),
            elevenlabs_model=getenv("ELEVENLABS_MODEL", "eleven_flash_v2_5"),
            elevenlabs_output_format=getenv("ELEVENLABS_OUTPUT_FORMAT", "mp3_44100_128"),
            elevenlabs_optimize_streaming_latency=_optional_int(
                getenv("ELEVENLABS_OPTIMIZE_STREAMING_LATENCY", "")
            ),
            elevenlabs_speed=float(getenv("ELEVENLABS_SPEED", "1.15")),
            tts_utterance_max_chars=int(getenv("ECHOSYNC_TTS_UTTERANCE_MAX_CHARS", "42")),
            tts_utterance_min_chars=int(getenv("ECHOSYNC_TTS_UTTERANCE_MIN_CHARS", "8")),
            tts_prefetch_concurrency=max(
                1,
                int(getenv("ECHOSYNC_TTS_PREFETCH_CONCURRENCY", "2")),
            ),
            mistral_api_key=getenv("MISTRAL_API_KEY", ""),
            voxtral_model=getenv("VOXTRAL_MODEL", "voxtral-mini-transcribe-realtime-2602"),
            voxtral_target_delay_ms=int(getenv("VOXTRAL_TARGET_DELAY_MS", "1000")),
            deepgram_api_key=getenv("DEEPGRAM_API_KEY", ""),
            deepgram_model=getenv("DEEPGRAM_MODEL", "nova-3"),
            deepgram_language=getenv("DEEPGRAM_LANGUAGE", "en"),
            deepgram_endpointing_ms=int(getenv("DEEPGRAM_ENDPOINTING_MS", "300")),
            qwen_api_key=getenv("DASHSCOPE_API_KEY", getenv("QWEN_API_KEY", "")),
            qwen_realtime_base_url=getenv(
                "QWEN_REALTIME_BASE_URL",
                "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
            ),
            qwen_asr_model=getenv("QWEN_ASR_MODEL", "qwen3-asr-flash-realtime-2026-02-10"),
            qwen_asr_language=getenv("QWEN_ASR_LANGUAGE", "auto"),
            qwen_asr_vad_silence_ms=int(getenv("QWEN_ASR_VAD_SILENCE_MS", "800")),
            qwen_livetranslate_model=getenv(
                "QWEN_LIVETRANSLATE_MODEL",
                "qwen3.5-livetranslate-flash-realtime",
            ),
            qwen_livetranslate_source_lang=getenv("QWEN_LIVETRANSLATE_SOURCE_LANG", "auto"),
            qwen_livetranslate_output_audio=getenv(
                "QWEN_LIVETRANSLATE_OUTPUT_AUDIO", "false"
            ).lower()
            in ("true", "1", "yes"),
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
            translation_repair_provider=_validated_choice(
                getenv("ECHOSYNC_TRANSLATION_REPAIR_PROVIDER", "disabled"),
                SUPPORTED_TRANSLATION_REPAIR_PROVIDERS,
                "ECHOSYNC_TRANSLATION_REPAIR_PROVIDER",
            ),
            translation_repair_model=getenv(
                "ECHOSYNC_TRANSLATION_REPAIR_MODEL",
                getenv("DEEPSEEK_MODEL", "deepseek-chat"),
            ),
            translation_repair_timeout_ms=int(
                getenv("ECHOSYNC_TRANSLATION_REPAIR_TIMEOUT_MS", "1500")
            ),
            translation_repair_max_concurrency=max(
                1,
                int(getenv("ECHOSYNC_TRANSLATION_REPAIR_MAX_CONCURRENCY", "1")),
            ),
            translation_repair_mode=_validated_choice(
                getenv("ECHOSYNC_TRANSLATION_REPAIR_MODE", "suspect_only"),
                SUPPORTED_TRANSLATION_REPAIR_MODES,
                "ECHOSYNC_TRANSLATION_REPAIR_MODE",
            ),
        )


def _optional_int(value: str) -> int | None:
    text = value.strip()
    if not text:
        return None
    return int(text)


def _validated_choice(value: str, allowed: frozenset[str], name: str) -> str:
    normalized = value.strip().lower()
    if normalized not in allowed:
        raise ValueError(f"{name} 不支持：{value}")
    return normalized


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
                f"{provider.title()} ASR 尚未接入，"
                "本轮可选 provider：mock、funasr、voxtral、deepgram、qwen-asr、qwen-livetranslate"
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


def with_session_tts_overrides(
    settings: Settings,
    *,
    tts_provider: object | None = None,
) -> Settings:
    """应用来自单个 realtime session 的 TTS 选择。

    TTS 密钥、voice id、模型名等敏感或供应商配置仍来自服务端环境变量。
    """

    if tts_provider is None:
        return settings

    provider = str(tts_provider).strip().lower()
    if not provider:
        return settings
    if provider not in SUPPORTED_TTS_PROVIDERS:
        raise ValueError(f"不支持的 TTS provider：{provider}")
    if provider == settings.tts_provider:
        return settings
    return replace(settings, tts_provider=provider)
