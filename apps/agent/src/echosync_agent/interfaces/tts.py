from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from echosync_agent.domain import TranslationSegment


class TtsSynthesizer(Protocol):
    """可选译文语音输出边界。"""

    def synthesize(self, segment: TranslationSegment) -> AsyncIterator[bytes]:
        raise NotImplementedError
