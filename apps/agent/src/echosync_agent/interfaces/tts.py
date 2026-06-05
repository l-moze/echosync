from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from echosync_agent.domain import TranslationSegment


class TtsSynthesizer(Protocol):
    """Optional translated-audio boundary."""

    def synthesize(self, segment: TranslationSegment) -> AsyncIterator[bytes]:
        raise NotImplementedError
