from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path

from echosync_agent.domain import AudioFrame, AudioSourceKind
from echosync_agent.interfaces import AudioSource

ReadPcm = Callable[[list[str]], Awaitable[bytes]]


class MediaAudioSource(AudioSource):
    """基于 ffmpeg 的媒体文件音频源。

    职责只包含媒体解码和 PCM 切片，ASR 模型调用由 Transcriber 负责。
    """

    def __init__(
        self,
        path: str,
        session_id: str,
        source_lang: str = "auto",
        sample_rate: int = 16_000,
        channels: int = 1,
        chunk_ms: int = 600,
        ffmpeg_path: str | None = None,
        read_pcm: ReadPcm | None = None,
    ) -> None:
        self.path = path
        self.session_id = session_id
        self.source_lang = source_lang
        self.sample_rate = sample_rate
        self.channels = channels
        self.chunk_ms = chunk_ms
        self.ffmpeg_path = ffmpeg_path or resolve_ffmpeg_path()
        self._read_pcm = read_pcm or read_pcm_from_ffmpeg

    async def frames(self) -> AsyncIterator[AudioFrame]:
        pcm = await self._read_pcm(
            build_ffmpeg_pcm_command(
                self.path,
                sample_rate=self.sample_rate,
                channels=self.channels,
                ffmpeg_path=self.ffmpeg_path,
            )
        )
        bytes_per_sample = 2
        frame_size = int(self.sample_rate * self.channels * bytes_per_sample * self.chunk_ms / 1000)
        if frame_size <= 0:
            raise ValueError("chunk_ms 必须大于 0。")

        total_frames = (len(pcm) + frame_size - 1) // frame_size
        bytes_per_ms = self.sample_rate * self.channels * bytes_per_sample
        for index, offset in enumerate(range(0, len(pcm), frame_size), start=1):
            chunk = pcm[offset : offset + frame_size]
            if not chunk:
                continue
            start_ms = int((offset / bytes_per_ms) * 1000)
            duration_ms = int((len(chunk) / bytes_per_ms) * 1000)
            yield AudioFrame(
                session_id=self.session_id,
                seq=index,
                pcm=chunk,
                sample_rate=self.sample_rate,
                channels=self.channels,
                start_ms=start_ms,
                end_ms=start_ms + duration_ms,
                source_lang=self.source_lang,
                source_kind=AudioSourceKind.FILE,
                device_id=str(Path(self.path)),
                is_final=index == total_frames,
            )


def build_ffmpeg_pcm_command(
    path: str,
    sample_rate: int,
    channels: int,
    ffmpeg_path: str = "ffmpeg",
) -> list[str]:
    return [
        ffmpeg_path,
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        path,
        "-vn",
        "-ac",
        str(channels),
        "-ar",
        str(sample_rate),
        "-f",
        "s16le",
        "pipe:1",
    ]


async def read_pcm_from_ffmpeg(command: list[str]) -> bytes:
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    if process.returncode != 0:
        message = stderr.decode("utf-8", errors="ignore").strip()
        raise RuntimeError(f"ffmpeg 音频抽取失败：{message}")
    return stdout


def resolve_ffmpeg_path() -> str:
    try:
        import imageio_ffmpeg
    except ImportError:
        return "ffmpeg"
    return imageio_ffmpeg.get_ffmpeg_exe()
