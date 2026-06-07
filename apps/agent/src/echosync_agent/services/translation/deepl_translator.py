from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from echosync_agent.domain import CorrectionContext, TranscriptSegment, TranslationSegment
from echosync_agent.interfaces import Translator

DEFAULT_DEEPL_BASE_URL = "https://api-free.deepl.com/v2/translate"
DEFAULT_DEEPL_MODEL_TYPE = "latency_optimized"


@dataclass(frozen=True, slots=True)
class DeepLResponse:
    text: str
    detected_source_language: str
    model_type_used: str
    billed_characters: float | None = None


class DeepLTranslator(Translator):
    """Official DeepL text translation adapter using the batch-only translate API."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_DEEPL_BASE_URL,
        target_lang: str = "ZH",
        source_lang: str = "",
        context_chars: int = 1_200,
        glossary_id: str = "",
        model_type: str = DEFAULT_DEEPL_MODEL_TYPE,
        timeout_sec: float = 12.0,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url
        self.target_lang = _target_lang_code(target_lang)
        self.source_lang = _source_lang_code(source_lang)
        self.context_chars = max(context_chars, 0)
        self.glossary_id = glossary_id.strip()
        self.model_type = model_type.strip()
        self.timeout_sec = timeout_sec
        self._endpoint_candidates = self._build_endpoint_candidates()

    def _build_endpoint_candidates(self) -> list[tuple[str, dict[str, str], str]]:
        """Build list of (endpoint_url, headers, mode) candidates to try.

        Returns candidates in priority order based on Doti's logic.
        Each candidate is (url, headers, mode) where mode is "official" or "free".
        """
        from urllib.parse import urlparse

        normalized = self.base_url.strip().rstrip("/")
        candidates: list[tuple[str, dict[str, str], str]] = []

        # If base_url already contains /translate, use as-is with official mode first
        if "/translate" in normalized.lower():
            is_official = "/v2/translate" in normalized.lower()
            mode = "official" if is_official else "free"
            headers = (
                {"Authorization": f"DeepL-Auth-Key {self.api_key}"}
                if is_official
                else {}
            )
            candidates.append((normalized, headers, mode))
            return candidates

        try:
            parsed = urlparse(normalized)

            # DeepLX api.deeplx.org: try official first, then free
            if parsed.hostname == "api.deeplx.org" and self.api_key:
                # Official mode: /{api_key}/v2/translate
                candidates.append(
                    (
                        f"{normalized}/{self.api_key}/v2/translate",
                        {},
                        "official",
                    )
                )
                # Free mode: /{api_key}/translate
                candidates.append(
                    (
                        f"{normalized}/{self.api_key}/translate",
                        {},
                        "free",
                    )
                )
                return candidates

            # Official DeepL API
            official_endpoint = _translate_endpoint(normalized)
            candidates.append(
                (
                    official_endpoint,
                    {"Authorization": f"DeepL-Auth-Key {self.api_key}"},
                    "official",
                )
            )

        except Exception:
            # Fallback to official endpoint
            official_endpoint = _translate_endpoint(normalized)
            candidates.append(
                (
                    official_endpoint,
                    {"Authorization": f"DeepL-Auth-Key {self.api_key}"},
                    "official",
                )
            )

        return candidates

    async def translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> TranslationSegment:
        started_at = time.perf_counter()
        response = await asyncio.to_thread(self._translate_sync, segment, context)
        latency_ms = max((time.perf_counter() - started_at) * 1000, 0.0)
        metrics: dict[str, float] = {
            "deepl_request_ms": latency_ms,
            "deepl_text_chars": float(len(segment.text)),
        }
        if response.billed_characters is not None:
            metrics["deepl_billed_characters"] = response.billed_characters
        if response.model_type_used:
            metrics["deepl_model_type_used"] = _stable_text_metric(response.model_type_used)
        return TranslationSegment(
            session_id=segment.session_id,
            segment_id=segment.segment_id,
            rev=segment.rev,
            source_rev=segment.rev,
            start_ms=segment.start_ms,
            end_ms=segment.end_ms,
            source_lang=segment.source_lang,
            target_lang=self.target_lang,
            source_text=segment.text,
            target_text=response.text.strip(),
            status=segment.status,
            stability=segment.stability,
            speaker=segment.speaker,
            metrics=metrics,
        )

    def _translate_sync(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> DeepLResponse:
        last_error: Exception | None = None

        for endpoint_url, auth_headers, mode in self._endpoint_candidates:
            try:
                body = self._request_body(segment, context, mode)
                headers = {
                    "Content-Type": "application/json",
                    "User-Agent": "EchoSync/0.1",
                }
                headers.update(auth_headers)

                request = Request(
                    endpoint_url,
                    data=json.dumps(body).encode("utf-8"),
                    headers=headers,
                    method="POST",
                )
                with urlopen(request, timeout=self.timeout_sec) as response:  # noqa: S310
                    payload = json.loads(response.read().decode("utf-8"))
                return _parse_response(payload)

            except HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                last_error = RuntimeError(
                    f"DeepL translate failed with HTTP {exc.code} at {endpoint_url}: {detail}"
                )
            except URLError as exc:
                last_error = RuntimeError(
                    f"DeepL translate request failed at {endpoint_url}: {exc.reason}"
                )
            except Exception as exc:
                last_error = exc

        if last_error:
            raise last_error
        raise RuntimeError("DeepL translate failed: no candidates available")

    def _request_body(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
        mode: str,
    ) -> dict[str, Any]:
        source_lang = self.source_lang or _source_lang_code(segment.source_lang)

        if mode == "free":
            # DeepLX free mode: {text: string, source_lang: "AUTO", target_lang: string}
            return {
                "text": segment.text,
                "source_lang": "AUTO",
                "target_lang": self.target_lang,
            }

        # Official mode: {text: [string], target_lang: string, ...}
        body: dict[str, Any] = {
            "text": [segment.text],
            "target_lang": self.target_lang,
        }
        if source_lang:
            body["source_lang"] = source_lang
        context_text = _context_text(context, max_chars=self.context_chars)
        if context_text:
            body["context"] = context_text
        if self.glossary_id:
            if not source_lang:
                raise ValueError("DeepL glossary_id requires source_lang.")
            body["glossary_id"] = self.glossary_id
        if self.model_type:
            body["model_type"] = self.model_type

        return body


def _translate_endpoint(base_url: str) -> str:
    text = base_url.strip().rstrip("/")
    if not text:
        return DEFAULT_DEEPL_BASE_URL
    if text.lower().endswith("/v2/translate"):
        return text
    if text.lower().endswith("/v2"):
        return f"{text}/translate"
    return f"{text}/v2/translate"


def _target_lang_code(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return "ZH"
    lowered = normalized.lower().replace("_", "-")
    return {
        "zh": "ZH",
        "zh-cn": "ZH",
        "zh-hans": "ZH",
        "en": "EN-US",
        "en-us": "EN-US",
        "en-gb": "EN-GB",
        "pt": "PT-PT",
        "pt-br": "PT-BR",
        "pt-pt": "PT-PT",
    }.get(lowered, normalized.upper())


def _source_lang_code(value: str) -> str:
    normalized = value.strip()
    if not normalized or normalized.lower() in {"auto", "unknown"}:
        return ""
    lowered = normalized.lower().replace("_", "-")
    return {
        "zh": "ZH",
        "zh-cn": "ZH",
        "zh-hans": "ZH",
        "en-us": "EN",
        "en-gb": "EN",
    }.get(lowered, normalized.split("-", maxsplit=1)[0].upper())


def _context_text(context: CorrectionContext, *, max_chars: int) -> str:
    if max_chars <= 0:
        return ""
    parts = [
        item.source_text.strip()
        for item in context.recent_segments[-context.max_revision_segments :]
        if item.source_text.strip()
    ]
    parts.extend(
        item.source_text.strip()
        for item in context.current_segment_revisions[-context.max_revision_segments :]
        if item.source_text.strip()
    )
    text = "\n".join(parts).strip()
    if len(text) <= max_chars:
        return text
    return text[-max_chars:].lstrip()


def _parse_response(payload: object) -> DeepLResponse:
    if not isinstance(payload, dict):
        raise RuntimeError("DeepL response must be a JSON object.")

    # DeepLX free mode: {data: string} or {translation: string}
    direct_text = payload.get("data")
    if isinstance(direct_text, str) and direct_text.strip():
        return DeepLResponse(
            text=direct_text,
            detected_source_language="",
            model_type_used="",
        )

    translation = payload.get("translation")
    if isinstance(translation, str) and translation.strip():
        return DeepLResponse(
            text=translation,
            detected_source_language="",
            model_type_used="",
        )

    # Official DeepL: {translations: [{text: string, detected_source_language: string}]}
    translations = payload.get("translations")
    if not isinstance(translations, list) or not translations:
        raise RuntimeError("DeepL response did not contain translations.")
    first = translations[0]
    if not isinstance(first, dict):
        raise RuntimeError("DeepL translation item must be an object.")
    text = first.get("text")
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError("DeepL response did not contain translated text.")
    detected = first.get("detected_source_language")
    model_type_used = payload.get("model_type_used")
    billed = payload.get("billed_characters")
    return DeepLResponse(
        text=text,
        detected_source_language=detected if isinstance(detected, str) else "",
        model_type_used=model_type_used if isinstance(model_type_used, str) else "",
        billed_characters=float(billed) if isinstance(billed, int | float) else None,
    )


def _stable_text_metric(value: str) -> float:
    return float(sum(ord(char) for char in value) % 10_000)
