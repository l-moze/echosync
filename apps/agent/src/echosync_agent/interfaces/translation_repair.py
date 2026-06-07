from __future__ import annotations

from typing import Protocol

from echosync_agent.domain import CorrectionContext, TranslationSegment


class TranslationRepairEngine(Protocol):
    """Committed subtitle semantic repair boundary.

    This lane is intentionally separate from the real-time correction slot so
    slow LLM repair never blocks first-token translation or segment commit.
    """

    async def repair(
        self,
        segment: TranslationSegment,
        context: CorrectionContext,
        *,
        reason: str = "",
    ) -> TranslationSegment | None:
        raise NotImplementedError
