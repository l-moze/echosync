from __future__ import annotations

from typing import Any, Protocol


class EventHandler(Protocol):
    async def __call__(self, event_type: str, payload: Any) -> None:
        raise NotImplementedError


class EventBus(Protocol):
    """Small observer interface for event-sourced subtitle state."""

    def subscribe(self, event_type: str, handler: EventHandler) -> None:
        raise NotImplementedError

    async def publish(self, event_type: str, payload: Any) -> None:
        raise NotImplementedError
