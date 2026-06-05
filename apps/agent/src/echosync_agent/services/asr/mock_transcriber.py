from __future__ import annotations

from collections.abc import AsyncIterator

from echosync_agent.domain import AudioFrame, SegmentStatus, TranscriptSegment, new_segment_id
from echosync_agent.interfaces import Transcriber


class MockTranscriber(Transcriber):
    """Deterministic transcriber for local pipeline tests.

    It treats each frame as UTF-8 text. Real audio never enters this class; provider adapters
    live beside it and satisfy the same Transcriber contract.
    """

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        async for frame in frames:
            text = frame.pcm.decode("utf-8", errors="ignore").strip()
            if not text:
                continue

            yield TranscriptSegment(
                session_id=frame.session_id,
                segment_id=new_segment_id(),
                rev=1,
                start_ms=frame.start_ms,
                end_ms=frame.end_ms,
                source_lang=frame.source_lang if frame.source_lang != "auto" else "en",
                text=text,
                status=SegmentStatus.COMMITTED,
                stability=1.0,
            )
