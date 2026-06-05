from __future__ import annotations

from typing import Protocol

from echosync_agent.domain import SegmentCommit, SubtitlePatch, TranslationSegment


class SubtitleSink(Protocol):
    """面向 UI 数据通道、WebSocket、日志或测试的字幕输出边界。"""

    async def publish_translation(self, segment: TranslationSegment) -> None:
        raise NotImplementedError

    async def publish_patch(self, patch: SubtitlePatch) -> None:
        raise NotImplementedError

    async def publish_commit(self, commit: SegmentCommit) -> None:
        raise NotImplementedError
