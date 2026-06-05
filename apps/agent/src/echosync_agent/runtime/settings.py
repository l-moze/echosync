from __future__ import annotations

from dataclasses import dataclass
from os import getenv


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
            glossary_enabled=getenv("ECHOSYNC_GLOSSARY_ENABLED", "true").lower()
            in ("true", "1", "yes"),
            glossary_domain=getenv("ECHOSYNC_GLOSSARY_DOMAIN", "default"),
            glossary_terms_dir=getenv("ECHOSYNC_GLOSSARY_TERMS_DIR", ""),
        )
