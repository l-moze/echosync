from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from echosync_agent.domain import AudioFrame
from echosync_agent.runtime import build_demo_pipeline


async def _demo_frames() -> AsyncIterator[AudioFrame]:
    samples = [
        "Today we will talk about vector databases.",
        "CUDA kernels make the pipeline faster.",
    ]
    for seq, text in enumerate(samples, start=1):
        yield AudioFrame(
            session_id="sess_demo",
            seq=seq,
            pcm=text.encode("utf-8"),
            sample_rate=16_000,
            channels=1,
            start_ms=(seq - 1) * 2_000,
            end_ms=seq * 2_000,
            source_lang="en",
        )


async def _main() -> None:
    pipeline, event_bus = build_demo_pipeline()
    await pipeline.run(_demo_frames())
    for event_type, payload in event_bus.events:
        print(event_type, payload)


def run() -> None:
    asyncio.run(_main())


if __name__ == "__main__":
    run()
