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
                chunk_ms=_funasr_chunk_ms_for_latency_mode(
                    base_chunk_ms=settings.funasr_chunk_ms,
                    latency_mode=settings.asr_latency_mode,
                ),
            )
        )
    if settings.asr_provider == "voxtral":
        if not settings.mistral_api_key:
            raise ValueError("使用 Voxtral ASR 时必须配置 MISTRAL_API_KEY。")
        return VoxtralRealtimeTranscriber(
            config=VoxtralRealtimeConfig(
                api_key=settings.mistral_api_key,
                model=settings.voxtral_model,
                target_streaming_delay_ms=_voxtral_target_delay_ms_for_latency_mode(
                    base_delay_ms=settings.voxtral_target_delay_ms,
                    latency_mode=settings.asr_latency_mode,
                ),
            )
        )
    raise ValueError(f"不支持的 ASR 供应商：{settings.asr_provider}")


def _funasr_chunk_ms_for_latency_mode(*, base_chunk_ms: int, latency_mode: str) -> int:
    if latency_mode == "low_latency":
        return max(240, min(base_chunk_ms, 320))
    if latency_mode == "accuracy":
        return max(base_chunk_ms, int(base_chunk_ms * 1.5))
    return base_chunk_ms


def _voxtral_target_delay_ms_for_latency_mode(*, base_delay_ms: int, latency_mode: str) -> int:
    if latency_mode == "low_latency":
        return max(240, min(base_delay_ms, 480))
    if latency_mode == "accuracy":
        return max(base_delay_ms, 1600)
    return base_delay_ms
