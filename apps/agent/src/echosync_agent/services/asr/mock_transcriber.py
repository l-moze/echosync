from __future__ import annotations

from collections.abc import AsyncIterator

from echosync_agent.domain import AudioFrame, SegmentStatus, TranscriptSegment, new_segment_id
from echosync_agent.interfaces import Transcriber


class MockTranscriber(Transcriber):
    """用于本地管道测试的确定性转写器。

    它把每个音频帧当作 UTF-8 文本处理。真实音频不会进入这个类；
    真实供应商适配器与它并列，并满足同一个 Transcriber 契约。
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
