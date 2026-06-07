from __future__ import annotations

from typing import Any, Protocol

from echosync_agent.domain import TranslatedAudioChunk


class TranslatedAudioSink(Protocol):
    """译文语音输出边界，避免字幕输出接口被迫承担音频职责。"""

    async def publish_audio(self, chunk: TranslatedAudioChunk) -> None:
        raise NotImplementedError

    async def publish_error(self, event: dict[str, Any]) -> None:
        raise NotImplementedError
