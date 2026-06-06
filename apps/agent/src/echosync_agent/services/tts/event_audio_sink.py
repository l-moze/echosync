from __future__ import annotations

import base64

from echosync_agent.domain import TranslatedAudioChunk
from echosync_agent.interfaces import EventBus, TranslatedAudioSink


class EventTranslatedAudioSink(TranslatedAudioSink):
    """Publishes synthesized translated audio into the shared event bus."""

    def __init__(self, event_bus: EventBus) -> None:
        self.event_bus = event_bus

    async def publish_audio(self, chunk: TranslatedAudioChunk) -> None:
        await self.event_bus.publish(
            "tts.audio",
            {
                "type": "tts.audio",
                "session_id": chunk.session_id,
                "segment_id": chunk.segment_id,
                "rev": chunk.rev,
                "start_ms": chunk.start_ms,
                "end_ms": chunk.end_ms,
                "target_lang": chunk.target_lang,
                "audio_base64": base64.b64encode(chunk.audio).decode("ascii"),
                "mime_type": chunk.mime_type,
                "sample_rate": chunk.sample_rate,
                "final": chunk.final,
            },
        )
