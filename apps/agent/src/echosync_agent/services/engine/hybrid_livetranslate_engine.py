from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass, replace

from echosync_agent.domain import (
    AudioFrame,
    InterpretationEvent,
    ModelCapability,
    ModelMode,
    ModelProfile,
    SegmentCommit,
    SegmentStatus,
    TranscriptSegment,
    TranslatedAudioChunk,
    TranslationSegment,
    new_segment_id,
)
from echosync_agent.interfaces import InterpretationEngine, Transcriber


@dataclass(slots=True)
class _HybridSegmentState:
    segment_id: str = ""
    rev: int = 0
    start_ms: int = 0
    end_ms: int = 0
    session_id: str = ""
    source_lang: str = "auto"
    target_lang: str = "zh-CN"
    source_text: str = ""
    target_text: str = ""
    source_done: bool = False
    target_done: bool = False
    committed: bool = False

    def ensure_segment(self, *, session_id: str, start_ms: int, end_ms: int) -> None:
        if self.segment_id:
            self.end_ms = max(self.end_ms, end_ms)
            return
        self.segment_id = new_segment_id()
        self.rev = 0
        self.session_id = session_id
        self.start_ms = start_ms
        self.end_ms = max(end_ms, start_ms + 1)

    def bump_rev(self) -> int:
        self.rev += 1
        return self.rev

    def reset(self) -> None:
        self.segment_id = ""
        self.rev = 0
        self.start_ms = 0
        self.end_ms = 0
        self.session_id = ""
        self.source_lang = "auto"
        self.source_text = ""
        self.target_text = ""
        self.source_done = False
        self.target_done = False
        self.committed = False


class SourceBackfilledLiveTranslateEngine(InterpretationEngine):
    def __init__(
        self,
        *,
        source_transcriber: Transcriber,
        target_engine: InterpretationEngine,
        target_lang: str = "zh-CN",
        source_timeout_ms: int = 1_200,
    ) -> None:
        self.source_transcriber = source_transcriber
        self.target_engine = target_engine
        self.target_lang = target_lang
        self.source_timeout_ms = source_timeout_ms

    @property
    def profile(self) -> ModelProfile:
        return ModelProfile(
            provider="qwen-livetranslate+asr",
            model=self.target_engine.profile.model,
            mode=ModelMode.END_TO_END,
            capabilities=(
                ModelCapability.ASR,
                ModelCapability.TRANSLATION,
                ModelCapability.SPEECH_TRANSLATION,
            ),
            source_lang=self.target_engine.profile.source_lang,
            target_lang=self.target_lang,
        )

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[InterpretationEvent]:
        source_queue: asyncio.Queue[AudioFrame | None] = asyncio.Queue()
        target_queue: asyncio.Queue[AudioFrame | None] = asyncio.Queue()
        event_queue: asyncio.Queue[tuple[str, object] | BaseException | object] = asyncio.Queue()
        done = object()
        source_done = object()
        target_done = object()
        state = _HybridSegmentState(target_lang=self.target_lang)
        pending_source_commit_task: asyncio.Task[None] | None = None

        async def fanout() -> None:
            try:
                async for frame in frames:
                    await source_queue.put(frame)
                    await target_queue.put(frame)
            except BaseException as exc:
                await event_queue.put(exc)
            finally:
                await source_queue.put(None)
                await target_queue.put(None)

        async def source_frames() -> AsyncIterator[AudioFrame]:
            while True:
                frame = await source_queue.get()
                if frame is None:
                    return
                yield frame

        async def target_frames() -> AsyncIterator[AudioFrame]:
            while True:
                frame = await target_queue.get()
                if frame is None:
                    return
                yield frame

        async def run_source() -> None:
            try:
                async for transcript in self.source_transcriber.stream(source_frames()):
                    await event_queue.put(("source", transcript))
            except BaseException as exc:
                await event_queue.put(exc)
            finally:
                await event_queue.put(source_done)

        async def run_target() -> None:
            try:
                async for event in self.target_engine.stream(target_frames()):
                    await event_queue.put(("target", event))
            except BaseException as exc:
                await event_queue.put(exc)
            finally:
                await event_queue.put(target_done)

        async def delayed_commit(segment_id: str, rev: int) -> None:
            await asyncio.sleep(self.source_timeout_ms / 1000)
            await event_queue.put(("source_timeout", (segment_id, rev)))

        def cancel_source_timeout() -> None:
            nonlocal pending_source_commit_task
            if pending_source_commit_task is not None:
                pending_source_commit_task.cancel()
                pending_source_commit_task = None

        def restart_source_timeout() -> None:
            nonlocal pending_source_commit_task
            if not _should_wait_for_source_timeout(state):
                return
            if pending_source_commit_task is not None:
                pending_source_commit_task.cancel()
            pending_source_commit_task = asyncio.create_task(
                delayed_commit(state.segment_id, state.rev)
            )

        tasks = [
            asyncio.create_task(fanout()),
            asyncio.create_task(run_source()),
            asyncio.create_task(run_target()),
        ]
        finished_lanes = 0
        try:
            while finished_lanes < 2:
                queued = await event_queue.get()
                if queued is done:
                    break
                if queued is source_done:
                    finished_lanes += 1
                    if _ready_to_commit_without_source(state):
                        cancel_source_timeout()
                        yield _commit(state)
                        state.reset()
                    continue
                if queued is target_done:
                    finished_lanes += 1
                    if finished_lanes >= 2 and _ready_to_commit_without_source(state):
                        cancel_source_timeout()
                        yield _commit(state)
                        state.reset()
                    continue
                if isinstance(queued, BaseException):
                    raise queued

                lane, payload = queued
                if lane == "source":
                    assert isinstance(payload, TranscriptSegment)
                    for event in _apply_source(state, payload, self.target_lang):
                        yield event
                    if _ready_to_commit(state):
                        cancel_source_timeout()
                        yield _commit(state)
                        state.reset()
                    else:
                        restart_source_timeout()
                    continue

                if lane == "target":
                    assert isinstance(
                        payload, TranslationSegment | SegmentCommit | TranslatedAudioChunk
                    )
                    if isinstance(payload, TranslatedAudioChunk):
                        yield _retarget_audio(payload, state)
                        continue
                    for event in _apply_target(state, payload, self.target_lang):
                        yield event
                    if _ready_to_commit(state):
                        cancel_source_timeout()
                        yield _commit(state)
                        state.reset()
                    else:
                        restart_source_timeout()
                    continue

                if lane == "source_timeout":
                    segment_id, rev = payload  # type: ignore[misc]
                    if (
                        state.segment_id == segment_id
                        and state.rev == rev
                        and _ready_to_commit_without_source(state)
                    ):
                        yield _commit(state)
                        state.reset()
                    pending_source_commit_task = None
        finally:
            if pending_source_commit_task is not None:
                pending_source_commit_task.cancel()
            for task in tasks:
                if not task.done():
                    task.cancel()
            if pending_source_commit_task is not None:
                await asyncio.gather(pending_source_commit_task, return_exceptions=True)
            await asyncio.gather(*tasks, return_exceptions=True)


def _apply_source(
    state: _HybridSegmentState,
    transcript: TranscriptSegment,
    target_lang: str,
) -> tuple[TranslationSegment, ...]:
    text = transcript.text.strip()
    if not text:
        return ()
    state.ensure_segment(
        session_id=transcript.session_id,
        start_ms=transcript.start_ms,
        end_ms=transcript.end_ms,
    )
    state.source_lang = transcript.source_lang
    state.source_text = text
    state.source_done = transcript.status == SegmentStatus.COMMITTED
    state.end_ms = max(state.end_ms, transcript.end_ms)
    return (
        TranslationSegment(
            session_id=state.session_id,
            segment_id=state.segment_id,
            rev=state.bump_rev(),
            source_rev=transcript.rev,
            start_ms=state.start_ms,
            end_ms=state.end_ms,
            source_lang=state.source_lang,
            target_lang=target_lang,
            source_text=state.source_text,
            target_text=state.target_text,
            status=_merged_status(state, source_status=transcript.status),
            stability=transcript.stability,
            speaker=transcript.speaker,
            metrics={**transcript.metrics, "qwen_livetranslate_source_backfill": 1.0},
            source_stable_text=transcript.stable_text,
            source_unstable_text=transcript.unstable_text,
        ),
    )


def _apply_target(
    state: _HybridSegmentState,
    payload: TranslationSegment | SegmentCommit,
    target_lang: str,
) -> tuple[TranslationSegment, ...]:
    target_text = payload.target_text.strip()
    if not target_text and not payload.source_text.strip():
        return ()
    state.ensure_segment(
        session_id=payload.session_id,
        start_ms=payload.start_ms,
        end_ms=payload.end_ms,
    )
    if payload.source_text.strip() and not state.source_text:
        state.source_text = payload.source_text.strip()
        state.source_done = (
            payload.status == SegmentStatus.COMMITTED
            if isinstance(payload, TranslationSegment)
            else True
        )
    state.target_text = target_text or state.target_text
    state.target_done = (
        payload.status == SegmentStatus.COMMITTED
        if isinstance(payload, TranslationSegment)
        else True
    )
    state.end_ms = max(state.end_ms, payload.end_ms)
    status = payload.status if isinstance(payload, TranslationSegment) else SegmentStatus.COMMITTED
    return (
        TranslationSegment(
            session_id=state.session_id,
            segment_id=state.segment_id,
            rev=state.bump_rev(),
            source_rev=state.rev,
            start_ms=state.start_ms,
            end_ms=state.end_ms,
            source_lang=state.source_lang,
            target_lang=target_lang,
            source_text=state.source_text,
            target_text=state.target_text,
            status=status,
            stability=payload.stability if isinstance(payload, TranslationSegment) else 1.0,
            speaker=payload.speaker,
            metrics={**payload.metrics, "qwen_livetranslate_hybrid_target": 1.0},
            source_stable_text=getattr(payload, "source_stable_text", ""),
            source_unstable_text=getattr(payload, "source_unstable_text", ""),
            target_stable_text=getattr(payload, "target_stable_text", ""),
            target_unstable_text=getattr(payload, "target_unstable_text", ""),
        ),
    )


def _merged_status(
    state: _HybridSegmentState,
    *,
    source_status: SegmentStatus,
) -> SegmentStatus:
    if state.target_done and source_status == SegmentStatus.COMMITTED:
        return SegmentStatus.COMMITTED
    if state.target_done:
        return SegmentStatus.STABLE
    return SegmentStatus.PARTIAL


def _ready_to_commit(state: _HybridSegmentState) -> bool:
    return bool(state.segment_id and state.target_done and state.source_done and state.target_text)


def _ready_to_commit_without_source(state: _HybridSegmentState) -> bool:
    return bool(
        state.segment_id
        and state.target_done
        and state.target_text
        and not state.committed
    )


def _should_wait_for_source_timeout(state: _HybridSegmentState) -> bool:
    return bool(
        state.segment_id
        and state.target_done
        and state.target_text
        and not state.source_done
        and not state.committed
    )


def _commit(state: _HybridSegmentState) -> SegmentCommit:
    state.committed = True
    return SegmentCommit(
        session_id=state.session_id,
        segment_id=state.segment_id,
        rev=max(state.rev, 1),
        start_ms=state.start_ms,
        end_ms=max(state.end_ms, state.start_ms + 1),
        source_lang=state.source_lang,
        target_lang=state.target_lang,
        source_text=state.source_text,
        target_text=state.target_text,
        metrics={"qwen_livetranslate_hybrid_commit": 1.0},
    )


def _retarget_audio(
    audio: TranslatedAudioChunk, state: _HybridSegmentState
) -> TranslatedAudioChunk:
    if not state.segment_id:
        return audio
    return replace(audio, segment_id=state.segment_id, rev=max(state.rev, 1))
