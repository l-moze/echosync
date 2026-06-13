from __future__ import annotations

import hashlib
import time
from collections.abc import Callable, Collection, Mapping, MutableMapping
from dataclasses import dataclass
from typing import Any, Literal

ValidationMode = Literal["none", "cached", "probe"]
ValidationStatus = Literal["not_requested", "validated", "failed", "skipped"]
ProviderProbe = Callable[[Any, str], "ProviderValidationResult"]
ValidationCache = MutableMapping[tuple[str, str], tuple[float, "ProviderValidationResult"]]


@dataclass(frozen=True, slots=True)
class ProviderValidationResult:
    status: ValidationStatus
    reason: str = ""
    error_code: str = ""
    cost: str = "none"
    checked_at_ms: int | None = None
    cache_hit: bool = False
    metadata: Mapping[str, object] | None = None

    def as_dict(self) -> dict[str, object]:
        result: dict[str, object] = {
            "status": self.status,
            "reason": self.reason,
            "error_code": self.error_code,
            "cost": self.cost,
            "cache_hit": self.cache_hit,
        }
        if self.checked_at_ms is not None:
            result["checked_at_ms"] = self.checked_at_ms
        if self.metadata:
            result["metadata"] = dict(self.metadata)
        return result

    def with_cache_hit(self, *, now: float) -> ProviderValidationResult:
        return ProviderValidationResult(
            status=self.status,
            reason=self.reason,
            error_code=self.error_code,
            cost=self.cost,
            checked_at_ms=int(now * 1000),
            cache_hit=True,
            metadata=self.metadata,
        )

    def stamped(self, *, now: float) -> ProviderValidationResult:
        return ProviderValidationResult(
            status=self.status,
            reason=self.reason,
            error_code=self.error_code,
            cost=self.cost,
            checked_at_ms=int(now * 1000),
            cache_hit=False,
            metadata=self.metadata,
        )


class ProviderValidationResolver:
    def __init__(
        self,
        *,
        mode: str = "none",
        requested_provider_ids: Collection[str] = (),
        probe: ProviderProbe | None = None,
        cache: ValidationCache | None = None,
        ttl_sec: float = 300.0,
        now: Callable[[], float] | None = None,
    ) -> None:
        self.mode = _validation_mode(mode)
        self.requested_provider_ids = {
            item.strip().lower()
            for item in requested_provider_ids
            if item.strip()
        }
        self.probe = probe
        self.cache = cache if cache is not None else {}
        self.ttl_sec = max(float(ttl_sec), 0.0)
        self.now = now or time.time

    def resolve(
        self,
        *,
        settings: Any,
        provider_key: str,
        provider_id: str,
        fingerprint: str,
        configured: bool,
    ) -> ProviderValidationResult:
        key = provider_key.lower()
        provider = provider_id.lower()
        now = self.now()
        if not configured:
            return ProviderValidationResult(
                status="skipped",
                reason="本地配置或依赖尚未满足，跳过供应商探针。",
                error_code="provider_not_configured",
            )

        cached = self._cached_result(key=key, fingerprint=fingerprint, now=now)
        if self.mode == "cached":
            if cached is not None:
                return cached
            return ProviderValidationResult(
                status="not_requested",
                reason="没有可复用的缓存探针结果；未发起供应商请求。",
                error_code="no_cached_validation",
            )

        if self.mode == "none":
            return ProviderValidationResult(
                status="not_requested",
                reason="未请求真实供应商探针，避免产生供应商费用。",
            )

        if not self._is_requested(provider_key=key, provider_id=provider):
            return ProviderValidationResult(
                status="not_requested",
                reason="未显式请求该 provider 的真实探针，避免产生供应商费用。",
            )

        if cached is not None:
            return cached

        if self.probe is None:
            return ProviderValidationResult(
                status="skipped",
                reason="没有注册该 provider 的真实探针。",
                error_code="probe_not_implemented",
            )

        result = self.probe(settings, key).stamped(now=now)
        self.cache[(key, fingerprint)] = (now, result)
        return result

    def _cached_result(
        self,
        *,
        key: str,
        fingerprint: str,
        now: float,
    ) -> ProviderValidationResult | None:
        item = self.cache.get((key, fingerprint))
        if item is None:
            return None
        checked_at, result = item
        if now - checked_at > self.ttl_sec:
            return None
        return result.with_cache_hit(now=now)

    def _is_requested(self, *, provider_key: str, provider_id: str) -> bool:
        return (
            provider_key in self.requested_provider_ids
            or provider_id in self.requested_provider_ids
        )


def fingerprint_parts(*parts: object) -> str:
    text = "\x1f".join(_fingerprint_part(part) for part in parts)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def secret_fingerprint(value: str) -> str:
    if not value:
        return ""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def _fingerprint_part(value: object) -> str:
    if value is None:
        return ""
    return str(value)


def _validation_mode(value: str) -> ValidationMode:
    normalized = value.strip().lower()
    if normalized in {"none", "cached", "probe"}:
        return normalized  # type: ignore[return-value]
    return "none"
