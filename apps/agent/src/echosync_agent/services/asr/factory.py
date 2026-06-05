from __future__ import annotations

from echosync_agent.interfaces import Transcriber
from echosync_agent.runtime.settings import Settings
from echosync_agent.services.asr.funasr_transcriber import FunAsrStreamingConfig, FunAsrTranscriber
from echosync_agent.services.asr.mock_transcriber import MockTranscriber
from echosync_agent.services.asr.voxtral_transcriber import (
    VoxtralRealtimeConfig,
    VoxtralRealtimeTranscriber,
)


def build_transcriber_from_settings(settings: Settings) -> Transcriber:
    """按配置创建 ASR 适配器。

    装配层集中处理供应商选择，管道只依赖 Transcriber 抽象。
    """

    if settings.asr_provider == "mock":
        return MockTranscriber()
    if settings.asr_provider == "funasr":
        return FunAsrTranscriber(
            config=FunAsrStreamingConfig(
                model=settings.funasr_model,
                device=settings.funasr_device,
                chunk_ms=settings.funasr_chunk_ms,
            )
        )
    if settings.asr_provider == "voxtral":
        if not settings.mistral_api_key:
            raise ValueError("使用 Voxtral ASR 时必须配置 MISTRAL_API_KEY。")
        return VoxtralRealtimeTranscriber(
            config=VoxtralRealtimeConfig(
                api_key=settings.mistral_api_key,
                model=settings.voxtral_model,
                target_streaming_delay_ms=settings.voxtral_target_delay_ms,
            )
        )
    raise ValueError(f"不支持的 ASR 供应商：{settings.asr_provider}")
