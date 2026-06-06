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


def test_media_audio_source_yields_frame_before_full_file_is_decoded() -> None:
    first_chunk_delivered = asyncio.Event()
    allow_second_chunk = asyncio.Event()

    async def read_stream(_command: list[str]) -> AsyncIterator[bytes]:
        first_chunk_delivered.set()
        yield b"\x01\x00" * 1600
        await allow_second_chunk.wait()
        yield b"\x02\x00" * 1600

    source = MediaAudioSource(
        path="lecture.mp4",
        session_id="sess_streaming_video",
        source_lang="en",
        chunk_ms=100,
        ffmpeg_path="ffmpeg",
        read_pcm_stream=read_stream,
    )

    async def first_frame() -> AudioFrame:
        stream = source.frames()
        frame = await asyncio.wait_for(anext(stream), timeout=1)
        assert first_chunk_delivered.is_set()
        await stream.aclose()
        return frame

    frame = asyncio.run(first_frame())

    assert frame.seq == 1
    assert frame.start_ms == 0
    assert frame.end_ms == 100
    assert frame.is_final is False
    assert frame.pcm == b"\x01\x00" * 1600


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


def test_funasr_transcriber_aggregates_small_transport_frames_before_inference() -> None:
    calls: list[dict[str, object]] = []

    class FakeModel:
        def generate(self, **kwargs: object) -> list[dict[str, str]]:
            calls.append(kwargs)
            return [{"text": f"chunk-{len(calls)}"}]

    async def frames() -> AsyncIterator[AudioFrame]:
        for seq in range(6):
            yield AudioFrame(
                session_id="sess_small_frames",
                seq=seq + 1,
                pcm=b"\x01\x00" * 1600,
                sample_rate=16_000,
                channels=1,
                start_ms=seq * 100,
                end_ms=(seq + 1) * 100,
                source_lang="zh",
                is_final=False,
            )

    transcriber = FunAsrTranscriber(
        model_factory=lambda: FakeModel(),
        config=FunAsrStreamingConfig(chunk_ms=300),
    )

    segments = asyncio.run(_collect(transcriber.stream(frames())))

    assert len(calls) == 2
    assert [len(call["input"]) for call in calls] == [4800, 4800]
    assert [segment.text for segment in segments] == ["chunk-1", "chunk-2"]
    assert segments[0].start_ms == 0
    assert segments[0].end_ms == 300
    assert segments[1].start_ms == 300
    assert segments[1].end_ms == 600


def test_funasr_transcriber_flushes_final_remainder() -> None:
    calls: list[dict[str, object]] = []

    class FakeModel:
        def generate(self, **kwargs: object) -> list[dict[str, str]]:
            calls.append(kwargs)
            return [{"text": "final-remainder"}]

    async def frames() -> AsyncIterator[AudioFrame]:
        for seq in range(2):
            yield AudioFrame(
                session_id="sess_final_remainder",
                seq=seq + 1,
                pcm=b"\x01\x00" * 1600,
                sample_rate=16_000,
                channels=1,
                start_ms=seq * 100,
                end_ms=(seq + 1) * 100,
                source_lang="zh",
                is_final=seq == 1,
            )

    transcriber = FunAsrTranscriber(
        model_factory=lambda: FakeModel(),
        config=FunAsrStreamingConfig(chunk_ms=300),
    )

    segments = asyncio.run(_collect(transcriber.stream(frames())))

    assert len(calls) == 1
    assert len(calls[0]["input"]) == 3200
    assert calls[0]["is_final"] is True
    assert segments[0].text == "final-remainder"
    assert segments[0].status == SegmentStatus.COMMITTED
    assert segments[0].start_ms == 0
    assert segments[0].end_ms == 200


def test_funasr_transcriber_resets_cache_after_endpoint_final_and_records_window_metrics(
) -> None:
    calls: list[dict[str, object]] = []

    class FakeModel:
        def generate(self, **kwargs: object) -> list[dict[str, str]]:
            calls.append(kwargs)
            return [{"text": f"chunk-{len(calls)}"}]

    async def frames() -> AsyncIterator[AudioFrame]:
        for seq in range(3):
            yield AudioFrame(
                session_id="sess_endpoint_reset",
                seq=seq + 1,
                pcm=b"\x01\x00" * 4800,
                sample_rate=16_000,
                channels=1,
                start_ms=seq * 300,
                end_ms=(seq + 1) * 300,
                source_lang="zh",
                is_final=seq == 1,
            )

    transcriber = FunAsrTranscriber(
        model_factory=lambda: FakeModel(),
        config=FunAsrStreamingConfig(chunk_ms=300),
    )

    segments = asyncio.run(_collect(transcriber.stream(frames())))

    assert len(calls) == 3
    assert calls[0]["cache"] is calls[1]["cache"]
    assert calls[2]["cache"] is not calls[1]["cache"]
    assert calls[1]["is_final"] is True
    assert calls[2]["is_final"] is False
    assert [segment.status for segment in segments] == [
        SegmentStatus.PARTIAL,
        SegmentStatus.COMMITTED,
        SegmentStatus.PARTIAL,
    ]
    assert segments[0].metrics["asr_input_audio_ms"] == 300.0
    assert segments[0].metrics["asr_transport_frames"] == 1.0
    assert segments[1].metrics["asr_endpoint_final"] == 1.0
    assert segments[2].metrics["asr_endpoint_final"] == 0.0


def test_funasr_transcriber_forces_hard_semantic_endpoint_and_resets_cache() -> None:
    calls: list[dict[str, object]] = []

    class FakeModel:
        def generate(self, **kwargs: object) -> list[dict[str, str]]:
            calls.append(kwargs)
            return [{"text": f"chunk-{len(calls)}"}]

    async def frames() -> AsyncIterator[AudioFrame]:
        for seq in range(3):
            yield AudioFrame(
                session_id="sess_hard_endpoint",
                seq=seq + 1,
                pcm=b"\x01\x00" * 4800,
                sample_rate=16_000,
                channels=1,
                start_ms=seq * 300,
                end_ms=(seq + 1) * 300,
                source_lang="zh",
                is_final=False,
            )

    transcriber = FunAsrTranscriber(
        model_factory=lambda: FakeModel(),
        config=FunAsrStreamingConfig(
            chunk_ms=300,
            semantic_max_chunk_ms=600,
        ),
    )

    segments = asyncio.run(_collect(transcriber.stream(frames())))

    assert len(calls) == 3
    assert calls[1]["is_final"] is True
    assert calls[2]["cache"] is not calls[1]["cache"]
    assert [segment.status for segment in segments] == [
        SegmentStatus.PARTIAL,
        SegmentStatus.COMMITTED,
        SegmentStatus.PARTIAL,
    ]
    assert segments[1].metrics["asr_semantic_boundary"] == 2.0
    assert segments[1].metrics["asr_endpoint_final"] == 1.0


def test_funasr_transcriber_uses_frame_sample_rate_for_aggregation_window() -> None:
    calls: list[dict[str, object]] = []

    class FakeModel:
        def generate(self, **kwargs: object) -> list[dict[str, str]]:
            calls.append(kwargs)
            return [{"text": "eight-k-window"}]

    async def frames() -> AsyncIterator[AudioFrame]:
        for seq in range(6):
            yield AudioFrame(
                session_id="sess_8k",
                seq=seq + 1,
                pcm=b"\x01\x00" * 800,
                sample_rate=8_000,
                channels=1,
                start_ms=seq * 100,
                end_ms=(seq + 1) * 100,
                source_lang="en",
                is_final=False,
            )

    transcriber = FunAsrTranscriber(
        model_factory=lambda: FakeModel(),
        config=FunAsrStreamingConfig(chunk_ms=300),
    )

    segments = asyncio.run(_collect(transcriber.stream(frames())))

    assert len(calls) == 2
    assert [len(call["input"]) for call in calls] == [2400, 2400]
    assert segments[0].start_ms == 0
    assert segments[0].end_ms == 300
    assert segments[1].start_ms == 300
    assert segments[1].end_ms == 600


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
