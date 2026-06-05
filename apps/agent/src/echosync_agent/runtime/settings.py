from __future__ import annotations

from dataclasses import dataclass
from os import getenv


@dataclass(frozen=True, slots=True)
class Settings:
    asr_provider: str
    translator_provider: str
    tts_provider: str
    target_lang: str
    funasr_ws_url: str
    deepseek_api_key: str
    deepseek_base_url: str
    deepseek_model: str
    edge_tts_voice: str

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            asr_provider=getenv("ECHOSYNC_ASR_PROVIDER", "mock"),
            translator_provider=getenv("ECHOSYNC_TRANSLATOR_PROVIDER", "mock"),
            tts_provider=getenv("ECHOSYNC_TTS_PROVIDER", "disabled"),
            target_lang=getenv("ECHOSYNC_TARGET_LANG", "zh-CN"),
            funasr_ws_url=getenv("FUNASR_WS_URL", "ws://127.0.0.1:10095"),
            deepseek_api_key=getenv("DEEPSEEK_API_KEY", ""),
            deepseek_base_url=getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
            deepseek_model=getenv("DEEPSEEK_MODEL", "deepseek-chat"),
            edge_tts_voice=getenv("EDGE_TTS_VOICE", "zh-CN-XiaoxiaoNeural"),
        )
