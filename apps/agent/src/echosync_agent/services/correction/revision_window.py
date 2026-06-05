from __future__ import annotations

from difflib import SequenceMatcher

from echosync_agent.domain import (
    CorrectionContext,
    SubtitlePatch,
    SubtitlePatchOperation,
    TranslationSegment,
)
from echosync_agent.interfaces import CorrectionEngine


class RevisionWindowCorrectionEngine(CorrectionEngine):
    """Small-window correction placeholder.

    MVP behavior is intentionally conservative: only emit a patch when the same segment is
    translated again with a newer revision. Contextual LLM correction is an extension point.
    """

    async def revise(
        self,
        current: TranslationSegment,
        context: CorrectionContext,
    ) -> SubtitlePatch | None:
        previous = next(
            (
                item
                for item in reversed(context.recent_segments)
                if item.segment_id == current.segment_id and item.rev < current.rev
            ),
            None,
        )
        if previous is None or previous.target_text == current.target_text:
            return None

        operation = self._single_replace(previous.target_text, current.target_text)
        return SubtitlePatch(
            session_id=current.session_id,
            segment_id=current.segment_id,
            rev=current.rev,
            base_rev=previous.rev,
            target_lang=current.target_lang,
            operations=(operation,),
            reason="revision_window",
            stability=current.stability,
        )

    @staticmethod
    def _single_replace(old: str, new: str) -> SubtitlePatchOperation:
        matcher = SequenceMatcher(a=old, b=new)
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                continue
            return SubtitlePatchOperation(
                op="replace",
                from_char=i1,
                to_char=i2,
                text=new[j1:j2],
            )
        return SubtitlePatchOperation(op="replace", from_char=0, to_char=len(old), text=new)
