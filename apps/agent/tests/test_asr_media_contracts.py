from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import TypeVar

import numpy as np

from echosync_agent.domain import AudioFrame, SegmentStatus
from echosync_agent.runtime.assembly import _build_transcriber
from echosync_agent.runtime.settings import Settings
from echosync_agent.services.asr.funasr_transcriber import (
    FunAsrStreamingConfig,
    FunAsrTranscriber,
    resolve_funasr_device,
)
from echosync_agent.services.media.ffmpeg_audio_source import (
    MediaAudioSource,
    build_ffmpeg_pcm_command,
)

T = TypeVar("T")


def test_ffmpeg_command_extracts_16k_mono_pcm() -> None:
    command = build_ffmpeg_pcm_command("lecture.mp4", sample_rate=16_000, channels=1)

    assert command[-7:] == [
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "s16le",
        "pipe:1",
    ]
    assert "lecture.mp4" in command


def test_media_audio_source_splits_pcm_into_timed_frames() -> None:
    pcm = b"\x01\x00" * 1600

    async def read_exactly(_command: list[str]) -> bytes:
        return pcm

    source = MediaAudioSource(
        path="lecture.mp4",
        session_id="sess_video",
        source_lang="zh",
        chunk_ms=100,
        ffmpeg_path="ffmpeg",
        read_pcm=read_exactly,
    )

    frames = asyncio.run(_collect(source.frames()))

    assert [frame.seq for frame in frames] == [1]
    assert frames[0].pcm == pcm
    assert frames[0].sample_rate == 16_000
    assert frames[0].channels == 1
    assert frames[0].start_ms == 0
    assert frames[0].end_ms == 100
    assert frames[0].source_lang == "zh"
    assert frames[0].is_final is True


def test_funasr_streaming_transcriber_reuses_cache_and_marks_final_chunk() -> None:
    calls: list[dict[str, object]] = []

    class FakeModel:
        def generate(self, **kwargs: object) -> list[dict[str, str]]:
            calls.append(kwargs)
            return [{"text": "第一段"}] if kwargs["is_final"] else [{"text": ""}]

    async def frames() -> AsyncIterator[AudioFrame]:
        for seq in range(2):
            yield AudioFrame(
                session_id="sess_asr",
                seq=seq + 1,
                pcm=b"\x01\x00" * 9600,
                sample_rate=16_000,
                channels=1,
                start_ms=seq * 600,
                end_ms=(seq + 1) * 600,
                source_lang="zh",
                is_final=seq == 1,
            )

    transcriber = FunAsrTranscriber(
        model_factory=lambda: FakeModel(),
        config=FunAsrStreamingConfig(chunk_ms=600),
    )

    segments = asyncio.run(_collect(transcriber.stream(frames())))

    assert len(calls) == 2
    assert calls[0]["cache"] is calls[1]["cache"]
    assert calls[0]["is_final"] is False
    assert calls[1]["is_final"] is True
    assert isinstance(calls[0]["input"], np.ndarray)
    assert calls[0]["input"].dtype == np.float32
    assert calls[0]["encoder_chunk_look_back"] == 4
    assert calls[0]["decoder_chunk_look_back"] == 1
    assert calls[0]["disable_pbar"] is True
    assert segments[0].text == "第一段"
    assert segments[0].status == SegmentStatus.COMMITTED
    assert segments[0].start_ms == 600
    assert segments[0].end_ms == 1200


def test_funasr_streaming_transcriber_recognizes_frame_before_requesting_next() -> None:
    call_count = 0

    class FakeModel:
        def generate(self, **_kwargs: object) -> list[dict[str, str]]:
            nonlocal call_count
            call_count += 1
            return [{"text": f"第{call_count}段"}]

    async def frames() -> AsyncIterator[AudioFrame]:
        yield AudioFrame(
            session_id="sess_asr",
            seq=1,
            pcm=b"\x01\x00" * 9600,
            sample_rate=16_000,
            channels=1,
            start_ms=0,
            end_ms=600,
            source_lang="zh",
        )
        assert call_count == 1
        yield AudioFrame(
            session_id="sess_asr",
            seq=2,
            pcm=b"\x01\x00" * 9600,
            sample_rate=16_000,
            channels=1,
            start_ms=600,
            end_ms=1200,
            source_lang="zh",
            is_final=True,
        )

    transcriber = FunAsrTranscriber(
        model_factory=lambda: FakeModel(),
        config=FunAsrStreamingConfig(chunk_ms=600),
    )

    segments = asyncio.run(_collect(transcriber.stream(frames())))

    assert [segment.text for segment in segments] == ["第1段", "第2段"]
    assert segments[0].start_ms == 0
    assert segments[0].status == SegmentStatus.PARTIAL
    assert segments[1].status == SegmentStatus.COMMITTED


def test_funasr_device_auto_prefers_cuda_when_available() -> None:
    assert resolve_funasr_device("auto", cuda_is_available=lambda: True) == "cuda"


def test_funasr_device_auto_falls_back_to_cpu_without_cuda() -> None:
    assert resolve_funasr_device("auto", cuda_is_available=lambda: False) == "cpu"


def test_funasr_device_keeps_explicit_cpu() -> None:
    assert resolve_funasr_device("cpu", cuda_is_available=lambda: True) == "cpu"


def test_funasr_device_cuda_falls_back_to_cpu_without_cuda() -> None:
    assert resolve_funasr_device("cuda", cuda_is_available=lambda: False) == "cpu"
    assert resolve_funasr_device("cuda", cuda_is_available=lambda: True) == "cuda"


def test_runtime_assembly_builds_local_funasr_transcriber() -> None:
    transcriber = _build_transcriber(
        Settings(
            asr_provider="funasr",
            translator_provider="mock",
            tts_provider="disabled",
            target_lang="zh-CN",
            funasr_model="paraformer-zh-streaming",
            funasr_device="cpu",
            funasr_chunk_ms=600,
            asr_server_port=8765,
            deepseek_api_key="",
            deepseek_base_url="https://api.deepseek.com/v1",
            deepseek_model="deepseek-chat",
            edge_tts_voice="zh-CN-XiaoxiaoNeural",
            mistral_api_key="",
            voxtral_model="voxtral-mini-transcribe-realtime-2602",
            voxtral_target_delay_ms=1000,
        )
    )

    assert isinstance(transcriber, FunAsrTranscriber)
    assert transcriber.config.model == "paraformer-zh-streaming"
    assert transcriber.config.chunk_ms == 600


async def _collect(items: AsyncIterator[T]) -> list[T]:
    return [item async for item in items]
