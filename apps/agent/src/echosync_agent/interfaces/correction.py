from __future__ import annotations

from typing import Protocol

from echosync_agent.domain import CorrectionContext, SubtitlePatch, TranslationSegment


class CorrectionEngine(Protocol):
    """Revision policy boundary.

    New strategies can be added without changing translators or subtitle sinks.
    """

    async def revise(
        self,
        current: TranslationSegment,
        context: CorrectionContext,
    ) -> SubtitlePatch | None:
        raise NotImplementedError
