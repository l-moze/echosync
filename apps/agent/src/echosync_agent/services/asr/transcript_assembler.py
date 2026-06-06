from __future__ import annotations

import time
from collections.abc import AsyncIterator
from dataclasses import replace

from echosync_agent.domain import SegmentStatus, TranscriptSegment, new_segment_id
from echosync_agent.services.realtime.hypothesis_update_policy import (
    DEFAULT_HYPOTHESIS_UPDATE_POLICY,
    HypothesisUpdatePolicy,
)
from echosync_agent.services.realtime.text_emission_policy import (
    DEFAULT_TEXT_EMISSION_POLICY,
    TextEmissionPolicy,
)
from echosync_agent.services.realtime.text_regions import split_realtime_text


class TranscriptAssembler:
    """把碎片 ASR delta 合并成可显示、可翻译的实时假设。

    行业常见体验是持续吐字，同时短周期修订尾部。这里用三种状态表达：
    partial 只用于源文实时显示；stable 是约 1 秒的翻译 checkpoint；committed 是最终锁定段。
    """

    def __init__(
        self,
        commit_punctuation: str = ".!?。！？",
        checkpoint_audio_ms: int = 1000,
        max_segment_audio_ms: int = 3800,
        max_segment_chars: int = 90,
        emission_policy: TextEmissionPolicy | None = None,
        hypothesis_policy: HypothesisUpdatePolicy | None = None,
    ) -> None:
        self.commit_punctuation = commit_punctuation
        self.checkpoint_audio_ms = checkpoint_audio_ms
        self.max_segment_audio_ms = max_segment_audio_ms
        self.max_segment_chars = max_segment_chars
        self.emission_policy = emission_policy or DEFAULT_TEXT_EMISSION_POLICY
        self.hypothesis_policy = hypothesis_policy or DEFAULT_HYPOTHESIS_UPDATE_POLICY

    async def stream(
        self,
        segments: AsyncIterator[TranscriptSegment],
    ) -> AsyncIterator[TranscriptSegment]:
        buffer: list[str] = []
        current_text = ""
        first: TranscriptSegment | None = None
        last: TranscriptSegment | None = None
        last_delta_at = time.perf_counter()
        checkpoint_start_ms: int | None = None
        force_checkpointed = False
        segment_id = new_segment_id()
        rev = 1
        last_emitted_text = ""

        async for segment in segments:
            if not segment.text:
                continue
            if first is None:
                first = segment
                checkpoint_start_ms = segment.start_ms
            last = segment
            last_delta_at = time.perf_counter()
            buffer.append(segment.text)
            current_text = self.hypothesis_policy.apply(
                current_text=current_text,
                incoming_text=segment.text,
            ).text

            should_force_checkpoint = (
                not force_checkpointed
                and self._should_force_checkpoint(current_text, first, last)
            )
            should_commit = self._should_commit(current_text) or self._should_endpoint_commit(
                current_text,
                segment,
            )
            should_checkpoint = (
                not should_commit
                and (
                    should_force_checkpoint
                    or self._should_weak_boundary(current_text)
                    or
                    (
                        checkpoint_start_ms is not None
                        and segment.end_ms - checkpoint_start_ms >= self.checkpoint_audio_ms
                    )
                    or segment.status == SegmentStatus.COMMITTED
                )
                and (should_force_checkpoint or self._should_checkpoint(current_text))
            )

            status = SegmentStatus.PARTIAL
            if should_commit:
                status = SegmentStatus.COMMITTED
            elif should_checkpoint:
                status = SegmentStatus.STABLE

            if status == SegmentStatus.PARTIAL and self.emission_policy.should_hold_source_partial(
                current_text=current_text,
                last_emitted_text=last_emitted_text,
            ):
                continue

            yield self._build_segment(
                current_text,
                first,
                last,
                last_delta_at,
                segment_id,
                rev,
                status,
            )
            last_emitted_text = current_text
            rev += 1

            if should_commit:
                buffer = []
                current_text = ""
                first = None
                last = None
                checkpoint_start_ms = None
                segment_id = new_segment_id()
                rev = 1
                last_emitted_text = ""
                force_checkpointed = False
            elif should_checkpoint:
                checkpoint_start_ms = segment.end_ms
                if should_force_checkpoint:
                    force_checkpointed = True

        if buffer and first is not None and last is not None:
            yield self._build_segment(
                current_text,
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
    def _should_endpoint_commit(text: str, segment: TranscriptSegment) -> bool:
        if not text.strip() or segment.status != SegmentStatus.COMMITTED:
            return False
        return float(segment.metrics.get("asr_endpoint_final", 0.0)) >= 1.0

    def _should_weak_boundary(self, text: str) -> bool:
        return text.rstrip().endswith((",", "，", ";", "；", ":", "："))

    def _should_checkpoint(self, text: str) -> bool:
        text = text.strip()
        if not text:
            return False
        if self._should_weak_boundary(text):
            return True
        if _contains_cjk(text):
            return len(_visible_chars(text)) >= 8
        return _word_count(text) >= 3 and len(_visible_chars(text)) >= 10

    def _should_force_checkpoint(
        self,
        text: str,
        first: TranscriptSegment,
        last: TranscriptSegment,
    ) -> bool:
        if len(text) >= self.max_segment_chars:
            return True
        if last.end_ms - first.start_ms < self.max_segment_audio_ms:
            return False

        # Some realtime providers attach cumulative audio-window timestamps to
        # every short text delta. CJK meaning units should stay revisable until
        # sentence punctuation or stream end locks the segment.
        if _contains_cjk(text):
            return False
        return len(text) >= max(24, self.max_segment_chars // 3)

    @staticmethod
    def _build_segment(
        text: str,
        first: TranscriptSegment,
        last: TranscriptSegment,
        last_delta_at: float,
        segment_id: str,
        rev: int,
        status: SegmentStatus,
    ) -> TranscriptSegment:
        metrics = dict(last.metrics)
        metrics["merge_wait_ms"] = max((time.perf_counter() - last_delta_at) * 1000, 0.0)
        regions = split_realtime_text(text, status=status, language=last.source_lang)
        return replace(
            last,
            segment_id=segment_id,
            rev=rev,
            start_ms=first.start_ms,
            text=text,
            status=status,
            stability=1.0 if status == SegmentStatus.COMMITTED else last.stability,
            metrics=metrics,
            stable_text=regions.stable_text,
            unstable_text=regions.unstable_text,
        )


def _contains_cjk(text: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in text)


def _visible_chars(text: str) -> str:
    return "".join(char for char in text if not char.isspace())


def _word_count(text: str) -> int:
    return len([part for part in text.replace("-", " ").split() if part.strip()])
