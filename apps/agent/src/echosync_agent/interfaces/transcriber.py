from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from echosync_agent.domain import AudioFrame, TranscriptSegment


class Transcriber(Protocol):
    """流式 ASR 边界。"""

    def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        raise NotImplementedError
