from __future__ import annotations

import http.client
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from importlib.util import find_spec
from typing import Any
from urllib.parse import quote

from echosync_agent.runtime.settings import Settings

DependencyAvailable = Callable[[str], bool]
ElevenLabsVoiceValidator = Callable[[Settings], "ElevenLabsVoiceValidation"]

ASR_LATENCY_MODES = ["low_latency", "balanced", "accuracy"]
ELEVENLABS_API_HOST = "api.elevenlabs.io"
ELEVENLABS_VOICE_VALIDATION_TIMEOUT_SEC = 4.0
ELEVENLABS_TTS_VALIDATION_TIMEOUT_SEC = 8.0

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ElevenLabsVoiceValidation:
    status: str
    available: bool
    reason: str = ""
    voice_name: str = ""


def build_realtime_capabilities(
    settings: Settings,
    *,
    dependency_available: DependencyAvailable | None = None,
    elevenlabs_voice_validator: ElevenLabsVoiceValidator | None = None,
) -> dict[str, Any]:
    """返回 Desktop 启动前需要的实时链路能力信息。

    这里只暴露 provider 是否可用和缺失原因，不返回任何 API key 明文。
    """

    has_dependency = dependency_available or _dependency_available
    validate_elevenlabs_voice = elevenlabs_voice_validator or _validate_elevenlabs_voice
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
            _deepgram_capability(settings, has_dependency),
            _qwen_asr_capability(settings, has_dependency),
            _qwen_livetranslate_capability(settings, has_dependency),
        ],
        "translation_providers": [
            _mock_translation_capability(default=settings.translator_provider == "mock"),
            _deepseek_capability(settings, has_dependency),
            _deepl_capability(settings),
        ],
        "tts_providers": [
            _disabled_tts_capability(default=settings.tts_provider == "disabled"),
            _edge_tts_capability(settings, has_dependency),
            _elevenlabs_tts_capability(settings, validate_elevenlabs_voice),
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
    dependencies = {
        "funasr": dependency_available("funasr"),
        "modelscope": dependency_available("modelscope"),
        "torch": dependency_available("torch"),
    }
    missing_dependencies = [name for name, available in dependencies.items() if not available]
    ready = not missing_dependencies
    return {
        "id": "funasr",
        "label": "FunASR 本地",
        "kind": "asr",
        "status": "ready" if ready else "missing_dependency",
        "available": ready,
        "default": settings.asr_provider == "funasr",
        "real_audio_supported": True,
        "reason": "" if ready else f"缺少 {'、'.join(missing_dependencies)} 依赖。",
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


def _deepgram_capability(
    settings: Settings,
    dependency_available: DependencyAvailable,
) -> dict[str, Any]:
    has_key = bool(settings.deepgram_api_key)
    has_websockets = dependency_available("websockets")
    status = "ready"
    reason = ""
    if not has_key:
        status = "missing_key"
        reason = "缺少 DEEPGRAM_API_KEY。"
    elif not has_websockets:
        status = "missing_dependency"
        reason = "缺少 websockets 依赖，请安装 pip install -e .[deepgram]。"

    return {
        "id": "deepgram",
        "label": "Deepgram",
        "kind": "asr",
        "status": status,
        "available": status == "ready",
        "default": settings.asr_provider == "deepgram",
        "real_audio_supported": True,
        "reason": reason,
        "model": settings.deepgram_model,
    }


def _qwen_asr_capability(
    settings: Settings,
    dependency_available: DependencyAvailable,
) -> dict[str, Any]:
    has_key = bool(settings.qwen_api_key)
    has_websockets = dependency_available("websockets")
    status = "ready"
    reason = ""
    if not has_key:
        status = "missing_key"
        reason = "缺少 DASHSCOPE_API_KEY 或 QWEN_API_KEY。"
    elif not has_websockets:
        status = "missing_dependency"
        reason = "缺少 websockets 依赖，请安装 pip install -e .[qwen]。"

    return {
        "id": "qwen-asr",
        "label": "Qwen ASR Realtime",
        "kind": "asr",
        "status": status,
        "available": status == "ready",
        "default": settings.asr_provider == "qwen-asr",
        "real_audio_supported": True,
        "reason": reason,
        "model": settings.qwen_asr_model,
    }


def _qwen_livetranslate_capability(
    settings: Settings,
    dependency_available: DependencyAvailable,
) -> dict[str, Any]:
    has_key = bool(settings.qwen_api_key)
    has_websockets = dependency_available("websockets")
    status = "ready"
    reason = ""
    if not has_key:
        status = "missing_key"
        reason = "缺少 DASHSCOPE_API_KEY 或 QWEN_API_KEY。"
    elif not has_websockets:
        status = "missing_dependency"
        reason = "缺少 websockets 依赖，请安装 pip install -e .[qwen]。"

    return {
        "id": "qwen-livetranslate",
        "label": "Qwen LiveTranslate",
        "kind": "asr",
        "status": status,
        "available": status == "ready",
        "default": settings.asr_provider == "qwen-livetranslate",
        "real_audio_supported": True,
        "reason": reason,
        "model": settings.qwen_livetranslate_model,
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


def _deepl_capability(settings: Settings) -> dict[str, Any]:
    has_key = bool(settings.deepl_api_key)
    status = "ready"
    reason = ""
    if not has_key:
        status = "missing_key"
        reason = "缺少 DEEPL_API_KEY。"

    return {
        "id": "deepl",
        "label": "DeepL",
        "kind": "translation",
        "status": status,
        "available": status == "ready",
        "default": settings.translator_provider == "deepl",
        "reason": reason,
        "model": settings.deepl_model_type,
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


def _elevenlabs_tts_capability(
    settings: Settings,
    voice_validator: ElevenLabsVoiceValidator,
) -> dict[str, Any]:
    has_key = bool(settings.elevenlabs_api_key)
    has_voice = bool(settings.elevenlabs_voice_id)
    status = "ready"
    reason = ""
    voice_name = ""
    if not has_key:
        status = "missing_key"
        reason = "缺少 ELEVENLABS_API_KEY。"
    elif not has_voice:
        status = "missing_config"
        reason = "缺少 ELEVENLABS_VOICE_ID。"
    else:
        validation = voice_validator(settings)
        status = validation.status
        reason = validation.reason
        voice_name = validation.voice_name

    return {
        "id": "elevenlabs",
        "label": "ElevenLabs",
        "kind": "tts",
        "status": status,
        "available": status == "ready",
        "default": settings.tts_provider == "elevenlabs",
        "reason": reason,
        "model": settings.elevenlabs_model,
        "voice_id": _mask_secret(settings.elevenlabs_voice_id),
        "voice_name": voice_name,
    }


def _dependency_available(module_name: str) -> bool:
    return find_spec(module_name) is not None


def _validate_elevenlabs_voice(settings: Settings) -> ElevenLabsVoiceValidation:
    return _validate_elevenlabs_voice_cached(
        settings.elevenlabs_api_key,
        settings.elevenlabs_voice_id,
        settings.elevenlabs_model,
        settings.elevenlabs_output_format,
        settings.elevenlabs_speed,
    )


@lru_cache(maxsize=16)
def _validate_elevenlabs_voice_cached(
    api_key: str,
    voice_id: str,
    model: str,
    output_format: str,
    speed: float,
) -> ElevenLabsVoiceValidation:
    try:
        status, payload = _get_elevenlabs_voice(api_key=api_key, voice_id=voice_id)
    except Exception as exc:
        logger.warning(
            "elevenlabs_voice_validation_failed voice_id=%s error=%s",
            _mask_secret(voice_id),
            exc,
        )
        return ElevenLabsVoiceValidation(
            status="unavailable",
            available=False,
            reason=(
                "无法校验 ELEVENLABS_VOICE_ID，请确认 ElevenLabs 网络连接和 API 权限。"
            ),
        )

    if status < 400:
        voice_name = str(payload.get("name") or "")
        tts_status, tts_payload = _probe_elevenlabs_tts(
            api_key=api_key,
            voice_id=voice_id,
            model=model,
            output_format=output_format,
            speed=speed,
        )
        if tts_status < 400:
            return ElevenLabsVoiceValidation(
                status="ready",
                available=True,
                voice_name=voice_name,
            )
        return _elevenlabs_tts_probe_failure(
            status=tts_status,
            payload=tts_payload,
            voice_name=voice_name,
        )

    code = _elevenlabs_error_code(payload)
    if code == "voice_not_found":
        return ElevenLabsVoiceValidation(
            status="unavailable",
            available=False,
            reason=(
                "ELEVENLABS_VOICE_ID 不属于当前 ElevenLabs API key，或该声音已被删除。"
                "请从 ElevenLabs Voices 页面或 /v1/voices 复制可用 voice_id。"
            ),
        )

    if status in (401, 403):
        return ElevenLabsVoiceValidation(
            status="unavailable",
            available=False,
            reason="ElevenLabs API key 无权访问当前 voice_id。",
        )

    return ElevenLabsVoiceValidation(
        status="unavailable",
        available=False,
        reason=(
            f"ElevenLabs voice 校验失败：HTTP {status} "
            f"{code or 'unknown_error'}。"
        ),
    )


def _get_elevenlabs_voice(*, api_key: str, voice_id: str) -> tuple[int, dict[str, Any]]:
    connection = http.client.HTTPSConnection(
        ELEVENLABS_API_HOST,
        timeout=ELEVENLABS_VOICE_VALIDATION_TIMEOUT_SEC,
    )
    try:
        connection.request(
            "GET",
            f"/v1/voices/{quote(voice_id, safe='')}",
            headers={
                "xi-api-key": api_key,
                "Accept": "application/json",
            },
        )
        response = connection.getresponse()
        body = response.read(4096).decode("utf-8", errors="replace")
        try:
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError:
            payload = {}
        return response.status, payload
    finally:
        connection.close()


def _probe_elevenlabs_tts(
    *,
    api_key: str,
    voice_id: str,
    model: str,
    output_format: str,
    speed: float,
) -> tuple[int, dict[str, Any]]:
    connection = http.client.HTTPSConnection(
        ELEVENLABS_API_HOST,
        timeout=ELEVENLABS_TTS_VALIDATION_TIMEOUT_SEC,
    )
    try:
        body = json.dumps(
            {
                "text": ".",
                "model_id": model,
                "voice_settings": {
                    "speed": min(max(float(speed), 0.7), 1.2),
                },
            }
        ).encode("utf-8")
        connection.request(
            "POST",
            f"/v1/text-to-speech/{quote(voice_id, safe='')}/stream?"
            f"output_format={quote(output_format, safe='')}",
            body=body,
            headers={
                "xi-api-key": api_key,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
        )
        response = connection.getresponse()
        if response.status < 400:
            response.read(64)
            return response.status, {}
        body_text = response.read(4096).decode("utf-8", errors="replace")
        try:
            payload = json.loads(body_text) if body_text else {}
        except json.JSONDecodeError:
            payload = {}
        return response.status, payload
    finally:
        connection.close()


def _elevenlabs_tts_probe_failure(
    *,
    status: int,
    payload: dict[str, Any],
    voice_name: str,
) -> ElevenLabsVoiceValidation:
    code = _elevenlabs_error_code(payload)
    if status == 402 or code == "paid_plan_required":
        return ElevenLabsVoiceValidation(
            status="unavailable",
            available=False,
            reason=(
                "当前 ElevenLabs 账号或 voice 不允许通过 API 合成语音："
                "paid_plan_required。请升级套餐，或换成当前套餐/API 可用的 voice。"
            ),
            voice_name=voice_name,
        )
    if status in (401, 403):
        return ElevenLabsVoiceValidation(
            status="unavailable",
            available=False,
            reason="ElevenLabs API key 无权使用当前 voice 进行 TTS 合成。",
            voice_name=voice_name,
        )
    if status == 429:
        return ElevenLabsVoiceValidation(
            status="unavailable",
            available=False,
            reason="ElevenLabs TTS 当前被限流，请稍后重试或调整套餐额度。",
            voice_name=voice_name,
        )
    return ElevenLabsVoiceValidation(
        status="unavailable",
        available=False,
        reason=(
            f"ElevenLabs TTS 校验失败：HTTP {status} "
            f"{code or 'unknown_error'}。"
        ),
        voice_name=voice_name,
    )


def _elevenlabs_error_code(payload: dict[str, Any]) -> str:
    detail = payload.get("detail")
    if isinstance(detail, dict):
        code = detail.get("code") or detail.get("status") or detail.get("type")
        return str(code or "")
    return ""


def _mask_secret(value: str) -> str:
    if len(value) <= 8:
        return value
    return f"{value[:5]}...{value[-4:]}(len={len(value)})"
