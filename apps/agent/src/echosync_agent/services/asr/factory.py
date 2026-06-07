from __future__ import annotations

from collections.abc import Callable

from echosync_agent.interfaces import Transcriber
from echosync_agent.runtime.settings import Settings
from echosync_agent.services.asr.deepgram_transcriber import (
    DeepgramStreamingConfig,
    DeepgramStreamingTranscriber,
)
from echosync_agent.services.asr.funasr_transcriber import FunAsrStreamingConfig, FunAsrTranscriber
from echosync_agent.services.asr.mock_transcriber import MockTranscriber
from echosync_agent.services.asr.qwen_realtime_transcriber import (
    QwenRealtimeAsrConfig,
    QwenRealtimeAsrTranscriber,
)
from echosync_agent.services.asr.semantic_chunker import FrameVadDetector
from echosync_agent.services.asr.silero_vad_detector import (
    LiveKitSileroVadConfig,
    build_livekit_silero_vad_detector,
)
from echosync_agent.services.asr.voxtral_transcriber import (
    VoxtralRealtimeConfig,
    VoxtralRealtimeTranscriber,
)

VadDetectorFactory = Callable[[Settings], FrameVadDetector | None]


def build_transcriber_from_settings(
    settings: Settings,
    *,
    vad_detector_factory: VadDetectorFactory | None = None,
) -> Transcriber:
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
                vad_silence_ms=settings.funasr_vad_silence_ms,
            ),
            vad_detector=_build_funasr_vad_detector(
                settings,
                vad_detector_factory=vad_detector_factory,
            ),
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
    if settings.asr_provider == "deepgram":
        if not settings.deepgram_api_key:
            raise ValueError("使用 Deepgram ASR 时必须配置 DEEPGRAM_API_KEY。")
        return DeepgramStreamingTranscriber(
            config=DeepgramStreamingConfig(
                api_key=settings.deepgram_api_key,
                model=settings.deepgram_model,
                language=settings.deepgram_language,
                endpointing_ms=_deepgram_endpointing_ms_for_latency_mode(
                    base_endpointing_ms=settings.deepgram_endpointing_ms,
                    latency_mode=settings.asr_latency_mode,
                ),
            )
        )
    if settings.asr_provider == "qwen-asr":
        if not settings.qwen_api_key:
            raise ValueError("使用 Qwen ASR 时必须配置 DASHSCOPE_API_KEY 或 QWEN_API_KEY。")
        return QwenRealtimeAsrTranscriber(
            config=QwenRealtimeAsrConfig(
                api_key=settings.qwen_api_key,
                model=settings.qwen_asr_model,
                base_url=settings.qwen_realtime_base_url,
                language=settings.qwen_asr_language,
                vad_silence_duration_ms=_qwen_vad_silence_ms_for_latency_mode(
                    base_silence_ms=settings.qwen_asr_vad_silence_ms,
                    latency_mode=settings.asr_latency_mode,
                ),
            )
        )
    if settings.asr_provider == "qwen-livetranslate":
        raise ValueError("Qwen LiveTranslate 是端到端听译引擎，不应通过 ASR 工厂创建。")
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


def _deepgram_endpointing_ms_for_latency_mode(
    *,
    base_endpointing_ms: int,
    latency_mode: str,
) -> int:
    if latency_mode == "low_latency":
        return max(120, min(base_endpointing_ms, 200))
    if latency_mode == "accuracy":
        return max(base_endpointing_ms, 500)
    return base_endpointing_ms


def _qwen_vad_silence_ms_for_latency_mode(*, base_silence_ms: int, latency_mode: str) -> int:
    if latency_mode == "low_latency":
        return max(300, min(base_silence_ms, 500))
    if latency_mode == "accuracy":
        return max(base_silence_ms, 1000)
    return base_silence_ms


def _build_funasr_vad_detector(
    settings: Settings,
    *,
    vad_detector_factory: VadDetectorFactory | None,
) -> FrameVadDetector | None:
    if not settings.funasr_vad_enabled:
        return None
    if vad_detector_factory is not None:
        return vad_detector_factory(settings)
    return build_livekit_silero_vad_detector(
        LiveKitSileroVadConfig(
            activation_threshold=settings.funasr_vad_activation_threshold,
        )
    )
