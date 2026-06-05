from __future__ import annotations

from typing import Protocol

from echosync_agent.domain import CorrectionContext, SubtitlePatch, TranslationSegment


class CorrectionEngine(Protocol):
    """修订策略边界。

    新增修正策略时，不需要修改翻译器或字幕输出。
    """

    async def revise(
        self,
        current: TranslationSegment,
        context: CorrectionContext,
    ) -> SubtitlePatch | None:
        raise NotImplementedError
