from __future__ import annotations

from typing import Protocol

from echosync_agent.domain import SegmentCommit, SubtitlePatch, TranslationSegment


class SubtitleSink(Protocol):
    """Output boundary for UI data-channel, WebSocket, logs, or tests."""

    async def publish_translation(self, segment: TranslationSegment) -> None:
        raise NotImplementedError

    async def publish_patch(self, patch: SubtitlePatch) -> None:
        raise NotImplementedError

    async def publish_commit(self, commit: SegmentCommit) -> None:
        raise NotImplementedError
