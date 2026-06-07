from __future__ import annotations

import asyncio
import http.client
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from urllib.parse import quote, urlencode, urlparse

from echosync_agent.domain import TranslationSegment
from echosync_agent.interfaces import TtsSynthesizer


class ElevenLabsStreamingClient:
    """Small stdlib client for ElevenLabs streaming TTS."""

    def __init__(
        self,
        base_url: str = "https://api.elevenlabs.io",
        chunk_size: int = 8192,
        timeout_sec: float = 30.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.chunk_size = chunk_size
        self.timeout_sec = timeout_sec

    async def stream_text_to_speech(
        self,
        *,
        api_key: str,
        voice_id: str,
        model: str,
        output_format: str,
        optimize_streaming_latency: int | None,
        similarity_boost: float,
        speed: float,
        stability: float,
        style: float,
        text: str,
        use_speaker_boost: bool,
    ) -> AsyncIterator[bytes]:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[bytes | BaseException | None] = asyncio.Queue()

        def run_request() -> None:
            try:
                for chunk in self._request_chunks(
                    api_key=api_key,
                    voice_id=voice_id,
                    model=model,
                    output_format=output_format,
                    optimize_streaming_latency=optimize_streaming_latency,
                    similarity_boost=similarity_boost,
                    speed=speed,
                    stability=stability,
                    style=style,
                    text=text,
                    use_speaker_boost=use_speaker_boost,
                ):
                    loop.call_soon_threadsafe(queue.put_nowait, chunk)
            except BaseException as exc:
                loop.call_soon_threadsafe(queue.put_nowait, exc)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        task = asyncio.create_task(asyncio.to_thread(run_request))
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                if isinstance(item, BaseException):
                    raise item
                yield item
        finally:
            await task

    def _request_chunks(
        self,
        *,
        api_key: str,
        voice_id: str,
        model: str,
        output_format: str,
        optimize_streaming_latency: int | None,
        similarity_boost: float,
        speed: float,
        stability: float,
        style: float,
        text: str,
        use_speaker_boost: bool,
    ) -> AsyncIterator[bytes]:
        parsed = urlparse(self.base_url)
        if parsed.scheme != "https":
            raise ValueError("ElevenLabs base_url must use https")
        query = {"output_format": output_format}
        if optimize_streaming_latency is not None:
            query["optimize_streaming_latency"] = str(optimize_streaming_latency)
        path = (
            f"/v1/text-to-speech/{quote(voice_id, safe='')}/stream?"
            f"{urlencode(query)}"
        )
        body = json.dumps(
            {
                "text": text,
                "model_id": model,
                "voice_settings": {
                    "similarity_boost": _clamp_unit(similarity_boost),
                    "speed": _clamp_speed(speed),
                    "stability": _clamp_unit(stability),
                    "style": _clamp_unit(style),
                    "use_speaker_boost": use_speaker_boost,
                },
            }
        ).encode("utf-8")
        headers = {
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }

        connection = http.client.HTTPSConnection(
            parsed.netloc,
            timeout=self.timeout_sec,
        )
        try:
            connection.request("POST", path, body=body, headers=headers)
            response = connection.getresponse()
            if response.status >= 400:
                detail = response.read(2048).decode("utf-8", errors="replace")
                raise RuntimeError(f"ElevenLabs TTS failed: HTTP {response.status} {detail}")
            while True:
                chunk = response.read(self.chunk_size)
                if not chunk:
                    break
                yield chunk
        finally:
            connection.close()


@dataclass(frozen=True, slots=True)
class ElevenLabsTtsSynthesizer(TtsSynthesizer):
    api_key: str
    voice_id: str
    model: str = "eleven_flash_v2_5"
    output_format: str = "mp3_44100_128"
    optimize_streaming_latency: int | None = None
    similarity_boost: float = 0.75
    speed: float = 1.15
    stability: float = 0.85
    style: float = 0.0
    use_speaker_boost: bool = False
    client: ElevenLabsStreamingClient | None = None

    async def synthesize(self, segment: TranslationSegment) -> AsyncIterator[bytes]:
        client = self.client or ElevenLabsStreamingClient()
        async for chunk in client.stream_text_to_speech(
            api_key=self.api_key,
            voice_id=self.voice_id,
            model=self.model,
            output_format=self.output_format,
            optimize_streaming_latency=self.optimize_streaming_latency,
            similarity_boost=self.similarity_boost,
            speed=self.speed,
            stability=self.stability,
            style=self.style,
            text=segment.target_text,
            use_speaker_boost=self.use_speaker_boost,
        ):
            yield chunk


def _clamp_speed(speed: float) -> float:
    return min(max(float(speed), 0.7), 1.2)


def _clamp_unit(value: float) -> float:
    return min(max(float(value), 0.0), 1.0)
