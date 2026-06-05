from __future__ import annotations

from collections.abc import AsyncIterator

from echosync_agent.domain import TranslationSegment
from echosync_agent.interfaces import TtsSynthesizer


class EdgeTtsSynthesizer(TtsSynthesizer):
    """可选译文语音适配器。"""

    def __init__(self, voice: str = "zh-CN-XiaoxiaoNeural") -> None:
        self.voice = voice

    async def synthesize(self, segment: TranslationSegment) -> AsyncIterator[bytes]:
        import edge_tts

        communicate = edge_tts.Communicate(text=segment.target_text, voice=self.voice)
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                yield chunk["data"]
