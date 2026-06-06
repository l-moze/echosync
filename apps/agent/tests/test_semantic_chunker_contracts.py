from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from echosync_agent.domain import AudioFrame
from echosync_agent.services.asr.semantic_chunker import (
    FrameVadDetector,
    SemanticAudioChunker,
    SemanticChunkingConfig,
    SemanticEndpointTracker,
)


def test_semantic_chunker_flushes_soft_boundary_from_endpoint_final() -> None:
    chunker = SemanticAudioChunker(
        SemanticChunkingConfig(
            min_chunk_ms=300,
            max_chunk_ms=1_000,
            overlap_ms=200,
        )
    )

    chunks = asyncio.run(
        _collect(
            chunker.stream(
                _frames(
                    [
                        (0, 100, False),
                        (100, 200, False),
                        (200, 300, True),
                    ]
                )
            )
        )
    )

    assert len(chunks) == 1
    assert chunks[0].boundary == "soft"
    assert chunks[0].frame.start_ms == 0
    assert chunks[0].frame.end_ms == 300
    assert chunks[0].frame.is_final is True
    assert chunks[0].source_frames == 3


def test_semantic_chunker_keeps_overlap_after_hard_cut() -> None:
    chunker = SemanticAudioChunker(
        SemanticChunkingConfig(
            min_chunk_ms=1_000,
            max_chunk_ms=400,
            overlap_ms=200,
        )
    )

    chunks = asyncio.run(
        _collect(
            chunker.stream(
                _frames(
                    [
                        (0, 100, False),
                        (100, 200, False),
                        (200, 300, False),
                        (300, 400, False),
                        (400, 500, False),
                    ]
                )
            )
        )
    )

    assert [(chunk.boundary, chunk.frame.start_ms, chunk.frame.end_ms) for chunk in chunks] == [
        ("hard", 0, 400),
        ("stream_end", 200, 500),
    ]
    assert chunks[0].frame.is_final is False
    assert chunks[0].source_frames == 4
    assert chunks[0].overlap_ms == 200
    assert chunks[1].frame.is_final is True
    assert chunks[1].source_frames == 2


def test_semantic_endpoint_tracker_marks_soft_boundary_from_vad_silence() -> None:
    tracker = SemanticEndpointTracker(
        SemanticChunkingConfig(
            min_chunk_ms=200,
            max_chunk_ms=1_000,
            overlap_ms=200,
            vad_silence_ms=200,
        ),
        vad_detector=StartMsVadDetector(silence_from_ms=200),
    )

    marks = [
        tracker.mark(frame)
        for frame in asyncio.run(
            _collect(
                _frames(
                    [
                        (0, 100, False),
                        (100, 200, False),
                        (200, 300, False),
                        (300, 400, False),
                    ]
                )
            )
        )
    ]

    assert [mark.boundary for mark in marks] == ["none", "none", "none", "soft"]
    assert marks[-1].frame.is_final is True
    assert marks[-1].active_audio_ms == 400


class StartMsVadDetector(FrameVadDetector):
    def __init__(self, *, silence_from_ms: int) -> None:
        self.silence_from_ms = silence_from_ms

    def is_speech(self, frame: AudioFrame) -> bool:
        return frame.start_ms < self.silence_from_ms


async def _frames(items: list[tuple[int, int, bool]]) -> AsyncIterator[AudioFrame]:
    for seq, (start_ms, end_ms, is_final) in enumerate(items, start=1):
        yield AudioFrame(
            session_id="sess_semantic",
            seq=seq,
            pcm=bytes([seq]) * int((end_ms - start_ms) * 32),
            sample_rate=16_000,
            channels=1,
            start_ms=start_ms,
            end_ms=end_ms,
            source_lang="en",
            is_final=is_final,
        )


async def _collect(items: AsyncIterator[object]) -> list[object]:
    return [item async for item in items]
