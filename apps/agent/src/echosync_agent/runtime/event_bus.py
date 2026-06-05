from __future__ import annotations

from collections import defaultdict
from typing import Any

from echosync_agent.interfaces import EventBus, EventHandler


class InMemoryEventBus(EventBus):
    """Tiny observer bus for MVP and tests."""

    def __init__(self) -> None:
        self._handlers: dict[str, list[EventHandler]] = defaultdict(list)
        self.events: list[tuple[str, Any]] = []

    def subscribe(self, event_type: str, handler: EventHandler) -> None:
        self._handlers[event_type].append(handler)

    async def publish(self, event_type: str, payload: Any) -> None:
        self.events.append((event_type, payload))
        for handler in self._handlers[event_type]:
            await handler(event_type, payload)
