from __future__ import annotations

import http.client
import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from importlib.util import find_spec
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from echosync_agent.runtime.provider_validation import (
    ProviderProbe,
    ProviderValidationResolver,
    ProviderValidationResult,
    ValidationCache,
    fingerprint_parts,
    secret_fingerprint,
)
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
    validation_mode: str = "none",
    validation_provider_ids: set[str] | None = None,
    validation_cache: ValidationCache | None = None,
    validation_ttl_sec: float = 300.0,
    validation_now: Callable[[], float] | None = None,
    provider_probe: ProviderProbe | None = None,
    source_kind: str = "windows_system",
    device_id: str = "",
) -> dict[str, Any]:
    """返回 Desktop 启动前需要的实时链路能力信息。

    这里只暴露 provider 是否可用和缺失原因，不返回任何 API key 明文。
    """

    has_dependency = dependency_available or _dependency_available
    validate_elevenlabs_voice = elevenlabs_voice_validator or _validate_elevenlabs_voice
    resolver = ProviderValidationResolver(
        mode=validation_mode,
        requested_provider_ids=validation_provider_ids or set(),
        probe=provider_probe or _default_provider_probe(validate_elevenlabs_voice),
        cache=validation_cache,
        ttl_sec=validation_ttl_sec,
        now=validation_now,
    )
    asr_providers = [
        _mock_asr_capability(default=settings.asr_provider == "mock"),
        _funasr_capability(settings, has_dependency),
        _voxtral_capability(settings, has_dependency),
        _deepgram_capability(settings, has_dependency),
        _qwen_asr_capability(settings, has_dependency),
    ]
    translation_providers = [
        _mock_translation_capability(default=settings.translator_provider == "mock"),
        _deepseek_capability(settings, has_dependency),
        _deepl_capability(settings),
        _qwen_livetranslate_capability(settings, has_dependency),
    ]
    tts_providers = [
        _disabled_tts_capability(default=settings.tts_provider == "disabled"),
        _edge_tts_capability(settings, has_dependency),
        _elevenlabs_tts_capability(settings),
    ]
    for provider in [*asr_providers, *translation_providers, *tts_providers]:
        _attach_validation(provider, settings=settings, resolver=resolver)

    preflight = _build_preflight(settings, source_kind=source_kind, device_id=device_id)
    default_chain = _build_default_chain(
        settings,
        asr_providers=asr_providers,
        translation_providers=translation_providers,
        tts_providers=tts_providers,
        preflight=preflight,
    )
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
        "asr_providers": asr_providers,
        "translation_providers": translation_providers,
        "tts_providers": tts_providers,
        "default_chain": default_chain,
        "preflight": preflight,
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
        "kind": "translation",
        "status": status,
        "available": status == "ready",
        "default": settings.translator_provider == "qwen-livetranslate",
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


def _elevenlabs_tts_capability(settings: Settings) -> dict[str, Any]:
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


def _attach_validation(
    provider: dict[str, Any],
    *,
    settings: Settings,
    resolver: ProviderValidationResolver,
) -> None:
    kind = str(provider.get("kind") or "")
    provider_id = str(provider.get("id") or "")
    provider_key = f"{kind}:{provider_id}"
    configured = bool(provider.get("available"))
    provider["configured"] = configured
    provider["configuration_status"] = provider.get("status", "")
    provider["validation_key"] = provider_key
    validation = resolver.resolve(
        settings=settings,
        provider_key=provider_key,
        provider_id=provider_id,
        fingerprint=_provider_fingerprint(settings, provider_key),
        configured=configured,
    )
    provider["validation"] = validation.as_dict()
    if validation.metadata:
        provider.update(validation.metadata)
    if validation.status == "failed":
        provider["status"] = "unavailable"
        provider["available"] = False
        provider["reason"] = validation.reason


def _provider_fingerprint(settings: Settings, provider_key: str) -> str:
    if provider_key == "asr:voxtral":
        return fingerprint_parts(
            provider_key,
            secret_fingerprint(settings.mistral_api_key),
            settings.voxtral_model,
        )
    if provider_key == "asr:deepgram":
        return fingerprint_parts(
            provider_key,
            secret_fingerprint(settings.deepgram_api_key),
            settings.deepgram_model,
            settings.deepgram_language,
        )
    if provider_key == "asr:qwen-asr":
        return fingerprint_parts(
            provider_key,
            secret_fingerprint(settings.qwen_api_key),
            settings.qwen_asr_model,
            settings.qwen_asr_language,
        )
    if provider_key == "translation:deepseek":
        return fingerprint_parts(
            provider_key,
            secret_fingerprint(settings.deepseek_api_key),
            settings.deepseek_base_url,
            settings.deepseek_model,
        )
    if provider_key == "translation:deepl":
        return fingerprint_parts(
            provider_key,
            secret_fingerprint(settings.deepl_api_key),
            settings.deepl_base_url,
            settings.deepl_model_type,
        )
    if provider_key == "translation:qwen-livetranslate":
        return fingerprint_parts(
            provider_key,
            secret_fingerprint(settings.qwen_api_key),
            settings.qwen_realtime_base_url,
            settings.qwen_livetranslate_model,
            settings.qwen_livetranslate_source_lang,
        )
    if provider_key == "tts:elevenlabs":
        return fingerprint_parts(
            provider_key,
            secret_fingerprint(settings.elevenlabs_api_key),
            settings.elevenlabs_voice_id,
            settings.elevenlabs_model,
            settings.elevenlabs_output_format,
        )
    return fingerprint_parts(provider_key)


def _default_provider_probe(
    elevenlabs_voice_validator: ElevenLabsVoiceValidator,
) -> ProviderProbe:
    def probe(settings: Settings, provider_key: str) -> ProviderValidationResult:
        if provider_key == "translation:deepseek":
            return _probe_deepseek(settings)
        if provider_key == "translation:deepl":
            return _probe_deepl(settings)
        if provider_key == "tts:elevenlabs":
            validation = elevenlabs_voice_validator(settings)
            if validation.available:
                return ProviderValidationResult(
                    status="validated",
                    cost="billable",
                    metadata={"voice_name": validation.voice_name},
                )
            return ProviderValidationResult(
                status="failed",
                reason=validation.reason,
                error_code="provider_unavailable",
                cost="billable",
                metadata={"voice_name": validation.voice_name},
            )
        return ProviderValidationResult(
            status="skipped",
            reason="该 provider 尚未接入真实探针；当前只返回本地配置/依赖状态。",
            error_code="probe_not_implemented",
        )

    return probe


def _probe_deepseek(settings: Settings) -> ProviderValidationResult:
    endpoint = _chat_completions_endpoint(settings.deepseek_base_url)
    body = json.dumps(
        {
            "model": settings.deepseek_model,
            "messages": [
                {"role": "system", "content": "Reply with ok."},
                {"role": "user", "content": "ok"},
            ],
            "temperature": 0,
            "max_tokens": 1,
        }
    ).encode("utf-8")
    request = Request(
        endpoint,
        data=body,
        headers={
            "Authorization": f"Bearer {settings.deepseek_api_key}",
            "Content-Type": "application/json",
            "User-Agent": "EchoSync-Capability-Probe/0.1",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=6.0) as response:  # noqa: S310
            payload = json.loads(response.read().decode("utf-8"))
        choices = payload.get("choices") if isinstance(payload, dict) else None
        if not isinstance(choices, list) or not choices:
            return ProviderValidationResult(
                status="failed",
                reason="DeepSeek 探针响应缺少 choices。",
                error_code="invalid_response",
                cost="billable",
            )
        return ProviderValidationResult(status="validated", cost="billable")
    except HTTPError as exc:
        return _provider_http_failure("DeepSeek", exc)
    except URLError as exc:
        return ProviderValidationResult(
            status="failed",
            reason=f"DeepSeek 探针网络失败：{exc.reason}",
            error_code="network_error",
            cost="billable",
        )
    except Exception as exc:
        return ProviderValidationResult(
            status="failed",
            reason=f"DeepSeek 探针失败：{exc}",
            error_code="probe_failed",
            cost="billable",
        )


def _probe_deepl(settings: Settings) -> ProviderValidationResult:
    try:
        from echosync_agent.domain import CorrectionContext, SegmentStatus, TranscriptSegment
        from echosync_agent.services.translation.deepl_translator import DeepLTranslator

        translator = DeepLTranslator(
            api_key=settings.deepl_api_key,
            base_url=settings.deepl_base_url,
            target_lang=settings.target_lang,
            timeout_sec=6.0,
        )
        response = translator._translate_sync(  # noqa: SLF001
            TranscriptSegment(
                session_id="capability_probe",
                segment_id="deepl_probe",
                rev=1,
                start_ms=0,
                end_ms=1,
                source_lang="en",
                text="hi",
                status=SegmentStatus.STABLE,
                stability=1.0,
            ),
            CorrectionContext(recent_segments=()),
        )
        if not response.text.strip():
            return ProviderValidationResult(
                status="failed",
                reason="DeepL 探针响应为空。",
                error_code="invalid_response",
                cost="billable",
            )
        return ProviderValidationResult(status="validated", cost="billable")
    except Exception as exc:
        return ProviderValidationResult(
            status="failed",
            reason=f"DeepL 探针失败：{_redact_deepl_error(exc, settings)}",
            error_code=_probe_error_code(exc),
            cost="billable",
        )


def _chat_completions_endpoint(base_url: str) -> str:
    normalized = base_url.strip().rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized
    return f"{normalized}/chat/completions"


def _provider_http_failure(provider_name: str, exc: HTTPError) -> ProviderValidationResult:
    detail = exc.read().decode("utf-8", errors="replace")[:512]
    return ProviderValidationResult(
        status="failed",
        reason=f"{provider_name} 探针 HTTP {exc.code}：{detail}",
        error_code=_http_error_code(exc.code),
        cost="billable",
    )


def _redact_deepl_error(exc: Exception, settings: Settings) -> str:
    text = str(exc)
    if settings.deepl_api_key:
        text = text.replace(settings.deepl_api_key, "<redacted>")
    return re.sub(
        r"(api\.deeplx\.org/)[^/\s]+",
        r"\1<redacted>",
        text,
        flags=re.IGNORECASE,
    )


def _http_error_code(status_code: int) -> str:
    if status_code in {401, 403}:
        return "auth_failed"
    if status_code == 402:
        return "quota_exceeded"
    if status_code == 404:
        return "model_not_found"
    if status_code == 429:
        return "rate_limited"
    return "provider_http_error"


def _probe_error_code(exc: Exception) -> str:
    text = str(exc).lower()
    if "http 401" in text or "http 403" in text:
        return "auth_failed"
    if "http 402" in text:
        return "quota_exceeded"
    if "http 404" in text:
        return "model_not_found"
    if "http 429" in text:
        return "rate_limited"
    if "urlopen" in text or "timed out" in text:
        return "network_error"
    return "probe_failed"


def _build_default_chain(
    settings: Settings,
    *,
    asr_providers: list[dict[str, Any]],
    translation_providers: list[dict[str, Any]],
    tts_providers: list[dict[str, Any]],
    preflight: dict[str, Any],
) -> dict[str, Any]:
    asr = _provider_by_id(asr_providers, settings.asr_provider)
    translation = _provider_by_id(translation_providers, settings.translator_provider)
    tts = _provider_by_id(tts_providers, settings.tts_provider)
    providers = {
        "asr": settings.asr_provider,
        "translation": settings.translator_provider,
        "tts": settings.tts_provider,
    }
    missing = [
        item["validation_key"]
        for item in (asr, translation, tts)
        if not item.get("available")
    ]
    warnings = list(preflight.get("warnings", []))
    if missing:
        status = "blocked"
    elif warnings:
        status = "warning"
    else:
        status = "ready"
    return {
        "status": status,
        "providers": providers,
        "blocked_by": missing,
        "warnings": warnings,
    }


def _build_preflight(
    settings: Settings,
    *,
    source_kind: str,
    device_id: str,
) -> dict[str, Any]:
    warnings: list[dict[str, str]] = []
    if _is_system_loopback_tts_conflict(
        source_kind=source_kind,
        device_id=device_id,
        tts_provider=settings.tts_provider,
    ):
        warnings.append(
            {
                "code": "preflight.loopback_tts_guard",
                "message": (
                    "Windows 系统声音采集会包含扬声器输出，不能同时启用语音播报。"
                    "请关闭 TTS，或使用排除 EchoSync 进程树的 WASAPI 设备。"
                ),
            }
        )
    return {
        "status": "warning" if warnings else "ready",
        "source_kind": source_kind,
        "device_id": device_id,
        "warnings": warnings,
    }


def _is_system_loopback_tts_conflict(
    *,
    source_kind: str,
    device_id: str,
    tts_provider: str,
) -> bool:
    if tts_provider == "disabled":
        return False
    normalized_source = source_kind.strip().lower().replace("-", "_")
    if normalized_source not in {"windows_system", "windows-system"}:
        return False
    if device_id.startswith("wasapi:exclude-process-tree:"):
        return False
    return not device_id.startswith("wasapi:include-process-tree:")


def _provider_by_id(
    providers: list[dict[str, Any]],
    provider_id: str,
) -> dict[str, Any]:
    return next(provider for provider in providers if provider["id"] == provider_id)


def _dependency_available(module_name: str) -> bool:
    return find_spec(module_name) is not None


def _validate_elevenlabs_voice(settings: Settings) -> ElevenLabsVoiceValidation:
    return _validate_elevenlabs_voice_cached(
        settings.elevenlabs_api_key,
        settings.elevenlabs_voice_id,
        settings.elevenlabs_model,
        settings.elevenlabs_output_format,
        settings.elevenlabs_similarity_boost,
        settings.elevenlabs_speed,
        settings.elevenlabs_stability,
        settings.elevenlabs_style,
        settings.elevenlabs_use_speaker_boost,
    )


@lru_cache(maxsize=16)
def _validate_elevenlabs_voice_cached(
    api_key: str,
    voice_id: str,
    model: str,
    output_format: str,
    similarity_boost: float,
    speed: float,
    stability: float,
    style: float,
    use_speaker_boost: bool,
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
            similarity_boost=similarity_boost,
            speed=speed,
            stability=stability,
            style=style,
            use_speaker_boost=use_speaker_boost,
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
    similarity_boost: float,
    speed: float,
    stability: float,
    style: float,
    use_speaker_boost: bool,
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
                    "similarity_boost": _clamp_unit(similarity_boost),
                    "speed": min(max(float(speed), 0.7), 1.2),
                    "stability": _clamp_unit(stability),
                    "style": _clamp_unit(style),
                    "use_speaker_boost": use_speaker_boost,
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


def _clamp_unit(value: float) -> float:
    return min(max(float(value), 0.0), 1.0)


def _mask_secret(value: str) -> str:
    if len(value) <= 8:
        return value
    return f"{value[:5]}...{value[-4:]}(len={len(value)})"
