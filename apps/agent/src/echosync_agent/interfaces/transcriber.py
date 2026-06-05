from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from echosync_agent.domain import AudioFrame, TranscriptSegment


class Transcriber(Protocol):
    """Streaming ASR boundary."""

    def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        raise NotImplementedError
