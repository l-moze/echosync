from __future__ import annotations

from typing import Protocol

from echosync_agent.domain import CorrectionContext, TranscriptSegment, TranslationSegment


class Translator(Protocol):
    """Incremental text translation boundary."""

    async def translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> TranslationSegment:
        raise NotImplementedError
