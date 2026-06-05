from __future__ import annotations

from collections.abc import AsyncIterator

from echosync_agent.domain import AudioFrame, TranscriptSegment
from echosync_agent.interfaces import Transcriber


class FunAsrTranscriber(Transcriber):
    """FunASR streaming adapter placeholder.

    Principle: open/closed. The pipeline already depends on Transcriber, so this adapter can
    become real without modifying translation, correction, or subtitle code.
    """

    def __init__(self, websocket_url: str, chunk_size: str = "5,10,5") -> None:
        self.websocket_url = websocket_url
        self.chunk_size = chunk_size

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        raise NotImplementedError(
            "FunASR WebSocket integration is reserved for MVP Day 2. "
            "Use MockTranscriber until FUNASR_WS_URL is available."
        )
