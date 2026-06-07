from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import suppress
from pathlib import Path

from echosync_agent.domain import AudioFrame, AudioSourceKind
from echosync_agent.interfaces import AudioSource

ReadPcm = Callable[[list[str]], Awaitable[bytes]]
ReadPcmStream = Callable[[list[str]], AsyncIterator[bytes]]


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
        read_pcm_stream: ReadPcmStream | None = None,
    ) -> None:
        self.path = path
        self.session_id = session_id
        self.source_lang = source_lang
        self.sample_rate = sample_rate
        self.channels = channels
        self.chunk_ms = chunk_ms
        self.ffmpeg_path = ffmpeg_path or resolve_ffmpeg_path()
        self._read_pcm = read_pcm or read_pcm_from_ffmpeg
        self._read_pcm_stream = read_pcm_stream

    async def frames(self) -> AsyncIterator[AudioFrame]:
        command = build_ffmpeg_pcm_command(
            self.path,
            sample_rate=self.sample_rate,
            channels=self.channels,
            ffmpeg_path=self.ffmpeg_path,
        )
        mark_final_full_chunks = (
            self._read_pcm_stream is None and self._read_pcm is not read_pcm_from_ffmpeg
        )
        async for frame in self._frames_from_stream(
            self._open_pcm_stream(command),
            mark_final_full_chunks=mark_final_full_chunks,
        ):
            yield frame

    async def _open_pcm_stream(self, command: list[str]) -> AsyncIterator[bytes]:
        if self._read_pcm_stream is not None:
            async for chunk in self._read_pcm_stream(command):
                yield chunk
            return

        if self._read_pcm is not read_pcm_from_ffmpeg:
            yield await self._read_pcm(command)
            return

        async for chunk in stream_pcm_from_ffmpeg(command):
            yield chunk

    async def _frames_from_stream(
        self,
        pcm_chunks: AsyncIterator[bytes],
        *,
        mark_final_full_chunks: bool = False,
    ) -> AsyncIterator[AudioFrame]:
        bytes_per_sample = 2
        frame_size = int(self.sample_rate * self.channels * bytes_per_sample * self.chunk_ms / 1000)
        if frame_size <= 0:
            raise ValueError("chunk_ms 必须大于 0。")

        pending = bytearray()
        full_chunks: list[bytes] = []
        bytes_per_ms = self.sample_rate * self.channels * bytes_per_sample
        emitted_bytes = 0
        seq = 1

        async for pcm in pcm_chunks:
            if not pcm:
                continue
            if mark_final_full_chunks:
                full_chunks.append(pcm)
                continue
            pending.extend(pcm)
            while len(pending) >= frame_size:
                chunk = bytes(pending[:frame_size])
                del pending[:frame_size]
                yield self._build_frame(
                    chunk=chunk,
                    emitted_bytes=emitted_bytes,
                    bytes_per_ms=bytes_per_ms,
                    seq=seq,
                    is_final=False,
                )
                emitted_bytes += len(chunk)
                seq += 1

        if mark_final_full_chunks:
            pending.extend(b"".join(full_chunks))
            total_frames = (len(pending) + frame_size - 1) // frame_size
            for index in range(total_frames):
                chunk = bytes(pending[:frame_size])
                del pending[:frame_size]
                yield self._build_frame(
                    chunk=chunk,
                    emitted_bytes=emitted_bytes,
                    bytes_per_ms=bytes_per_ms,
                    seq=seq,
                    is_final=index == total_frames - 1,
                )
                emitted_bytes += len(chunk)
                seq += 1
            return

        if pending:
            yield self._build_frame(
                chunk=bytes(pending),
                emitted_bytes=emitted_bytes,
                bytes_per_ms=bytes_per_ms,
                seq=seq,
                is_final=True,
            )
        elif seq > 1:
            # 前一帧已经发出，但直到 ffmpeg stdout 结束才知道它是文件尾。
            # 文件回放复盘不依赖 final 标记触发 ASR flush；实时链路 stop 会单独发 final。
            return

    def _build_frame(
        self,
        *,
        chunk: bytes,
        emitted_bytes: int,
        bytes_per_ms: int,
        seq: int,
        is_final: bool,
    ) -> AudioFrame:
        start_ms = int((emitted_bytes / bytes_per_ms) * 1000)
        duration_ms = int((len(chunk) / bytes_per_ms) * 1000)
        return AudioFrame(
            session_id=self.session_id,
            seq=seq,
            pcm=chunk,
            sample_rate=self.sample_rate,
            channels=self.channels,
            start_ms=start_ms,
            end_ms=start_ms + duration_ms,
            source_lang=self.source_lang,
            source_kind=AudioSourceKind.FILE,
            device_id=str(Path(self.path)),
            is_final=is_final,
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


async def stream_pcm_from_ffmpeg(
    command: list[str],
    *,
    read_size: int = 32_000,
) -> AsyncIterator[bytes]:
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    if process.stdout is None:
        raise RuntimeError("ffmpeg stdout 未打开。")

    stderr_task = asyncio.create_task(process.stderr.read() if process.stderr else _empty_bytes())
    completed = False
    try:
        while True:
            chunk = await process.stdout.read(read_size)
            if not chunk:
                break
            yield chunk
        return_code = await process.wait()
        stderr = await stderr_task
        completed = True
        if return_code != 0:
            message = stderr.decode("utf-8", errors="ignore").strip()
            raise RuntimeError(f"ffmpeg 音频抽取失败：{message}")
    finally:
        if not completed:
            if not stderr_task.done():
                stderr_task.cancel()
                await asyncio.gather(stderr_task, return_exceptions=True)
            if process.returncode is None:
                with suppress(ProcessLookupError):
                    process.kill()
            with suppress(Exception):
                await process.communicate()


async def _empty_bytes() -> bytes:
    return b""


def resolve_ffmpeg_path() -> str:
    try:
        import imageio_ffmpeg
    except ImportError:
        return "ffmpeg"
    return imageio_ffmpeg.get_ffmpeg_exe()
