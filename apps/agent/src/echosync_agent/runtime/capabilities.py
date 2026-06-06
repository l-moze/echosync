from __future__ import annotations

from collections.abc import Callable
from importlib.util import find_spec
from typing import Any

from echosync_agent.runtime.settings import Settings

DependencyAvailable = Callable[[str], bool]

ASR_LATENCY_MODES = ["low_latency", "balanced", "accuracy"]


def build_realtime_capabilities(
    settings: Settings,
    *,
    dependency_available: DependencyAvailable | None = None,
) -> dict[str, Any]:
    """返回 Desktop 启动前需要的实时链路能力信息。

    这里只暴露 provider 是否可用和缺失原因，不返回任何 API key 明文。
    """

    has_dependency = dependency_available or _dependency_available
    return {
        "service": "echosync-agent",
        "defaults": {
            "asr_provider": settings.asr_provider,
            "asr_latency_mode": settings.asr_latency_mode,
            "translation_provider": settings.translator_provider,
            "tts_provider": settings.tts_provider,
            "target_lang": settings.target_lang,
        },
        "asr_latency_modes": ASR_LATENCY_MODES,
        "asr_providers": [
            _mock_asr_capability(default=settings.asr_provider == "mock"),
            _funasr_capability(settings, has_dependency),
            _voxtral_capability(settings, has_dependency),
        ],
        "translation_providers": [
            _mock_translation_capability(default=settings.translator_provider == "mock"),
            _deepseek_capability(settings, has_dependency),
        ],
        "tts_providers": [
            _disabled_tts_capability(default=settings.tts_provider == "disabled"),
            _edge_tts_capability(settings, has_dependency),
            _elevenlabs_tts_capability(settings),
        ],
    }


def _mock_asr_capability(*, default: bool) -> dict[str, Any]:
    return {
        "id": "mock",
        "label": "调试 Mock",
        "kind": "asr",
        "status": "ready",
        "available": True,
        "default": default,
        "real_audio_supported": False,
        "reason": "只用于事件链路演示，不能处理真实 PCM 音频。",
        "model": "mock",
    }


def _funasr_capability(
    settings: Settings,
    dependency_available: DependencyAvailable,
) -> dict[str, Any]:
    has_funasr = dependency_available("funasr")
    has_modelscope = dependency_available("modelscope")
    ready = has_funasr and has_modelscope
    return {
        "id": "funasr",
        "label": "FunASR 本地",
        "kind": "asr",
        "status": "ready" if ready else "missing_dependency",
        "available": ready,
        "default": settings.asr_provider == "funasr",
        "real_audio_supported": True,
        "reason": "" if ready else "缺少 funasr 或 modelscope 依赖。",
        "model": settings.funasr_model,
    }


def _voxtral_capability(
    settings: Settings,
    dependency_available: DependencyAvailable,
) -> dict[str, Any]:
    has_key = bool(settings.mistral_api_key)
    has_sdk = dependency_available("mistralai")
    status = "ready"
    reason = ""
    if not has_key:
        status = "missing_key"
        reason = "缺少 MISTRAL_API_KEY。"
    elif not has_sdk:
        status = "missing_dependency"
        reason = '缺少 Mistral realtime SDK，请安装 pip install "mistralai[realtime]"。'

    return {
        "id": "voxtral",
        "label": "Voxtral Realtime",
        "kind": "asr",
        "status": status,
        "available": status == "ready",
        "default": settings.asr_provider == "voxtral",
        "real_audio_supported": True,
        "reason": reason,
        "model": settings.voxtral_model,
    }


def _mock_translation_capability(*, default: bool) -> dict[str, Any]:
    return {
        "id": "mock",
        "label": "调试 Mock",
        "kind": "translation",
        "status": "ready",
        "available": True,
        "default": default,
        "reason": "只用于事件链路演示。",
        "model": "mock",
    }


def _deepseek_capability(
    settings: Settings,
    dependency_available: DependencyAvailable,
) -> dict[str, Any]:
    has_key = bool(settings.deepseek_api_key)
    has_sdk = dependency_available("openai")
    status = "ready"
    reason = ""
    if not has_key:
        status = "missing_key"
        reason = "缺少 DEEPSEEK_API_KEY。"
    elif not has_sdk:
        status = "missing_dependency"
        reason = "缺少 openai Python SDK。"

    return {
        "id": "deepseek",
        "label": "DeepSeek-V3",
        "kind": "translation",
        "status": status,
        "available": status == "ready",
        "default": settings.translator_provider == "deepseek",
        "reason": reason,
        "model": settings.deepseek_model,
    }


def _disabled_tts_capability(*, default: bool) -> dict[str, Any]:
    return {
        "id": "disabled",
        "label": "关闭",
        "kind": "tts",
        "status": "ready",
        "available": True,
        "default": default,
        "reason": "字幕优先链路默认不启用语音播报。",
        "model": "none",
    }


def _edge_tts_capability(
    settings: Settings,
    dependency_available: DependencyAvailable,
) -> dict[str, Any]:
    has_edge_tts = dependency_available("edge_tts")
    return {
        "id": "edge-tts",
        "label": "Edge TTS",
        "kind": "tts",
        "status": "ready" if has_edge_tts else "missing_dependency",
        "available": has_edge_tts,
        "default": settings.tts_provider == "edge-tts",
        "reason": "" if has_edge_tts else "缺少 edge-tts 依赖。",
        "model": settings.edge_tts_voice,
    }


def _elevenlabs_tts_capability(settings: Settings) -> dict[str, Any]:
    has_key = bool(settings.elevenlabs_api_key)
    has_voice = bool(settings.elevenlabs_voice_id)
    status = "ready"
    reason = ""
    if not has_key:
        status = "missing_key"
        reason = "缺少 ELEVENLABS_API_KEY。"
    elif not has_voice:
        status = "missing_config"
        reason = "缺少 ELEVENLABS_VOICE_ID。"

    return {
        "id": "elevenlabs",
        "label": "ElevenLabs",
        "kind": "tts",
        "status": status,
        "available": status == "ready",
        "default": settings.tts_provider == "elevenlabs",
        "reason": reason,
        "model": settings.elevenlabs_model,
    }


def _dependency_available(module_name: str) -> bool:
    return find_spec(module_name) is not None
