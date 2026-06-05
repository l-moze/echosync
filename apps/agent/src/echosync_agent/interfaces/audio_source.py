from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from echosync_agent.domain import AudioFrame


class AudioSource(Protocol):
    """Minimal audio source interface.

    Principle: interface segregation. The pipeline only needs an async stream of frames,
    not provider-specific transport controls.
    """

    def frames(self) -> AsyncIterator[AudioFrame]:
        raise NotImplementedError
