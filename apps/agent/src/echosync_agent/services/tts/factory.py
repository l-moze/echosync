from __future__ import annotations

from echosync_agent.interfaces import TtsSynthesizer
from echosync_agent.runtime.settings import Settings
from echosync_agent.services.tts.edge_tts_synthesizer import EdgeTtsSynthesizer
from echosync_agent.services.tts.elevenlabs_synthesizer import ElevenLabsTtsSynthesizer


def build_tts_synthesizer_from_settings(settings: Settings) -> TtsSynthesizer | None:
    provider = settings.tts_provider.strip().lower()
    if provider == "disabled":
        return None

    if provider == "edge-tts":
        return EdgeTtsSynthesizer(
            voice=settings.edge_tts_voice,
            rate=settings.edge_tts_rate,
        )

    if provider == "elevenlabs":
        if not settings.elevenlabs_api_key:
            raise ValueError("使用 ElevenLabs TTS 时必须配置 ELEVENLABS_API_KEY。")
        if not settings.elevenlabs_voice_id:
            raise ValueError("使用 ElevenLabs TTS 时必须配置 ELEVENLABS_VOICE_ID。")
        return ElevenLabsTtsSynthesizer(
            api_key=settings.elevenlabs_api_key,
            voice_id=settings.elevenlabs_voice_id,
            model=settings.elevenlabs_model,
            output_format=settings.elevenlabs_output_format,
            optimize_streaming_latency=settings.elevenlabs_optimize_streaming_latency,
            similarity_boost=settings.elevenlabs_similarity_boost,
            speed=settings.elevenlabs_speed,
            stability=settings.elevenlabs_stability,
            style=settings.elevenlabs_style,
            use_speaker_boost=settings.elevenlabs_use_speaker_boost,
        )

    raise ValueError(f"不支持的 TTS provider：{provider}")
