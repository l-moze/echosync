from __future__ import annotations

import time
from collections.abc import AsyncIterator
from dataclasses import replace

from echosync_agent.domain import SegmentStatus, TranscriptSegment, new_segment_id


class TranscriptAssembler:
    """把碎片 ASR delta 合并成可显示、可翻译的实时假设。

    行业常见体验是持续吐字，同时短周期修订尾部。这里用三种状态表达：
    partial 只用于源文实时显示；stable 是约 1 秒的翻译 checkpoint；committed 是最终锁定段。
    """

    def __init__(
        self,
        commit_punctuation: str = ".!?。！？",
        checkpoint_audio_ms: int = 1000,
    ) -> None:
        self.commit_punctuation = commit_punctuation
        self.checkpoint_audio_ms = checkpoint_audio_ms

    async def stream(
        self,
        segments: AsyncIterator[TranscriptSegment],
    ) -> AsyncIterator[TranscriptSegment]:
        buffer: list[str] = []
        first: TranscriptSegment | None = None
        last: TranscriptSegment | None = None
        last_delta_at = time.perf_counter()
        checkpoint_start_ms: int | None = None
        segment_id = new_segment_id()
        rev = 1

        async for segment in segments:
            if not segment.text:
                continue
            if first is None:
                first = segment
                checkpoint_start_ms = segment.start_ms
            last = segment
            last_delta_at = time.perf_counter()
            buffer.append(segment.text)

            should_commit = (
                segment.status == SegmentStatus.COMMITTED or self._should_commit(segment.text)
            )
            should_checkpoint = (
                not should_commit
                and checkpoint_start_ms is not None
                and segment.end_ms - checkpoint_start_ms >= self.checkpoint_audio_ms
            )

            status = SegmentStatus.PARTIAL
            if should_commit:
                status = SegmentStatus.COMMITTED
            elif should_checkpoint:
                status = SegmentStatus.STABLE

            yield self._build_segment(buffer, first, last, last_delta_at, segment_id, rev, status)
            rev += 1

            if should_commit:
                buffer = []
                first = None
                last = None
                checkpoint_start_ms = None
                segment_id = new_segment_id()
                rev = 1
            elif should_checkpoint:
                checkpoint_start_ms = segment.end_ms

        if buffer and first is not None and last is not None:
            yield self._build_segment(
                buffer,
                first,
                last,
                last_delta_at,
                segment_id,
                rev,
                SegmentStatus.COMMITTED,
            )

    def _should_commit(self, text: str) -> bool:
        return text.rstrip().endswith(tuple(self.commit_punctuation))

    @staticmethod
    def _build_segment(
        buffer: list[str],
        first: TranscriptSegment,
        last: TranscriptSegment,
        last_delta_at: float,
        segment_id: str,
        rev: int,
        status: SegmentStatus,
    ) -> TranscriptSegment:
        metrics = dict(last.metrics)
        metrics["merge_wait_ms"] = max((time.perf_counter() - last_delta_at) * 1000, 0.0)
        return replace(
            last,
            segment_id=segment_id,
            rev=rev,
            start_ms=first.start_ms,
            text="".join(buffer).strip(),
            status=status,
            stability=1.0 if status == SegmentStatus.COMMITTED else last.stability,
            metrics=metrics,
        )
