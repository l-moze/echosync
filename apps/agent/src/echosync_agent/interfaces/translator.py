from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from echosync_agent.domain import CorrectionContext, TranscriptSegment, TranslationSegment


class Translator(Protocol):
    """增量文本翻译边界。"""

    async def translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> TranslationSegment:
        raise NotImplementedError

    def stream_translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> AsyncIterator[TranslationSegment]:
        raise NotImplementedError
