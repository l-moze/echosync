from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from collections.abc import AsyncIterator
from dataclasses import replace

from echosync_agent.domain import (
    AudioFrame,
    CorrectionContext,
    InterpretationEvent,
    ModelCapability,
    ModelMode,
    ModelProfile,
    SegmentCommit,
    SegmentStatus,
    TranscriptSegment,
    TranslationSegment,
)
from echosync_agent.interfaces import (
    CorrectionEngine,
    InterpretationEngine,
    Transcriber,
    Translator,
)
from echosync_agent.services.asr.transcript_assembler import TranscriptAssembler
from echosync_agent.services.translation.terminology import Glossary

logger = logging.getLogger(__name__)


class CascadedInterpretationEngine(InterpretationEngine):
    """把 ASR、翻译和修正组件组合成统一听译引擎。"""

    def __init__(
        self,
        transcriber: Transcriber,
        translator: Translator,
        correction_engine: CorrectionEngine,
        transcript_assembler: TranscriptAssembler | None = None,
        target_lang: str = "zh-CN",
        revision_window_segments: int = 2,
        glossary: Glossary | dict[str, str] | None = None,
    ) -> None:
        self.transcriber = transcriber
        self.translator = translator
        self.correction_engine = correction_engine
        self.transcript_assembler = transcript_assembler or TranscriptAssembler()
        self.target_lang = target_lang
        self.revision_window_segments = revision_window_segments
        # 统一转为 Glossary 对象
        if isinstance(glossary, dict):
            self._glossary = Glossary.from_dict(glossary)
        elif glossary is None:
            self._glossary = Glossary()
        else:
            self._glossary = glossary
        self._history: deque[TranslationSegment] = deque(maxlen=revision_window_segments + 4)

    @property
    def profile(self) -> ModelProfile:
        return ModelProfile(
            provider="echosync",
            model="cascaded-asr-translation-correction",
            mode=ModelMode.CASCADED,
            capabilities=(
                ModelCapability.ASR,
                ModelCapability.TRANSLATION,
                ModelCapability.CORRECTION,
            ),
            target_lang=self.target_lang,
        )

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[InterpretationEvent]:
        event_queue: asyncio.Queue[InterpretationEvent | BaseException | object] = asyncio.Queue()
        done = object()
        pending_checkpoints: dict[tuple[str, SegmentStatus], TranscriptSegment] = {}
        pending_order: deque[tuple[str, SegmentStatus]] = deque()
        stable_checkpoint_seen: set[str] = set()
        checkpoint_available = asyncio.Event()
        producer_done = False
        assembled_transcripts = self.transcript_assembler.stream(self.transcriber.stream(frames))

        async def produce_transcripts() -> None:
            nonlocal producer_done
            try:
                async for transcript in assembled_transcripts:
                    await event_queue.put(self._source_only_translation(transcript))
                    if transcript.status != SegmentStatus.PARTIAL:
                        checkpoint_key = self._checkpoint_key(transcript)
                        if transcript.status == SegmentStatus.STABLE:
                            if transcript.segment_id in stable_checkpoint_seen:
                                continue
                            stable_checkpoint_seen.add(transcript.segment_id)

                        if checkpoint_key not in pending_checkpoints:
                            pending_order.append(checkpoint_key)

                        if transcript.status == SegmentStatus.STABLE:
                            pending_checkpoints.setdefault(checkpoint_key, transcript)
                        else:
                            pending_checkpoints[checkpoint_key] = transcript
                        checkpoint_available.set()
            except BaseException as exc:
                await event_queue.put(exc)
            finally:
                producer_done = True
                checkpoint_available.set()

        async def translate_checkpoints() -> None:
            try:
                while True:
                    await checkpoint_available.wait()
                    while pending_order:
                        checkpoint_key = pending_order.popleft()
                        item = pending_checkpoints.pop(checkpoint_key, None)
                        if item is None:
                            continue
                        async for event in self._translate_checkpoint(item):
                            await event_queue.put(event)
                    if producer_done:
                        break
                    checkpoint_available.clear()
            except BaseException as exc:
                await event_queue.put(exc)
            finally:
                await event_queue.put(done)

        producer_task = asyncio.create_task(produce_transcripts())
        translator_task = asyncio.create_task(translate_checkpoints())

        try:
            while True:
                event = await event_queue.get()
                if event is done:
                    break
                if isinstance(event, BaseException):
                    raise event
                yield event
        finally:
            for task in (producer_task, translator_task):
                if not task.done():
                    task.cancel()
            await asyncio.gather(producer_task, translator_task, return_exceptions=True)

    async def _translate_checkpoint(
        self,
        transcript: TranscriptSegment,
    ) -> AsyncIterator[InterpretationEvent]:
        context = self._context(transcript.text)
        translation_started_at = time.perf_counter()
        final_translation: TranslationSegment | None = None
        async for translation in self._stream_translation(transcript, context):
            translation_latency_ms = (time.perf_counter() - translation_started_at) * 1000
            translation = replace(
                translation,
                metrics={
                    **transcript.metrics,
                    **translation.metrics,
                    "translation_latency_ms": translation_latency_ms,
                },
            )
            final_translation = translation
            yield translation

        if final_translation is None:
            return

        patch = await self.correction_engine.revise(final_translation, context)
        if patch is not None:
            yield patch

        if final_translation.status == SegmentStatus.COMMITTED:
            self._history.append(final_translation)

        if transcript.status == SegmentStatus.COMMITTED:
            yield SegmentCommit(
                session_id=final_translation.session_id,
                segment_id=final_translation.segment_id,
                rev=final_translation.rev,
                start_ms=final_translation.start_ms,
                end_ms=final_translation.end_ms,
                source_lang=final_translation.source_lang,
                target_lang=final_translation.target_lang,
                source_text=final_translation.source_text,
                target_text=final_translation.target_text,
                speaker=final_translation.speaker,
            )

    @staticmethod
    def _checkpoint_key(transcript: TranscriptSegment) -> tuple[str, SegmentStatus]:
        if transcript.status == SegmentStatus.STABLE:
            return (transcript.segment_id, SegmentStatus.STABLE)
        return (transcript.segment_id, SegmentStatus.COMMITTED)

    def _source_only_translation(self, transcript: TranscriptSegment) -> TranslationSegment:
        return TranslationSegment(
            session_id=transcript.session_id,
            segment_id=transcript.segment_id,
            rev=transcript.rev,
            source_rev=transcript.rev,
            start_ms=transcript.start_ms,
            end_ms=transcript.end_ms,
            source_lang=transcript.source_lang,
            target_lang=self.target_lang,
            source_text=transcript.text,
            target_text="",
            status=transcript.status,
            stability=transcript.stability,
            speaker=transcript.speaker,
            metrics=dict(transcript.metrics),
        )

    async def _stream_translation(
        self,
        transcript: TranscriptSegment,
        context: CorrectionContext,
    ) -> AsyncIterator[TranslationSegment]:
        stream_translate = getattr(self.translator, "stream_translate", None)
        has_stream_translate = "stream_translate" in type(self.translator).__dict__
        if stream_translate is not None and has_stream_translate:
            async for translation in stream_translate(transcript, context):
                yield translation
            return

        yield await self.translator.translate(transcript, context)

    def _context(self, current_source_text: str) -> CorrectionContext:
        """构建翻译上下文，包含基于流式窗口的术语匹配。

        窗口 = 最近 1-2 个 final/committed 段 + 当前段。
        只保留 span 与当前段重叠的术语，避免上一段术语污染当前段。
        """
        context_glossary: dict[str, str] = {}
        context_constraints: dict[str, str] = {}

        if current_source_text.strip():
            prefix = " ".join(
                seg.source_text
                for seg in self._history
                if seg.status == SegmentStatus.COMMITTED
            )
            prefix = " ".join(prefix.split()[-50:])  # 截断前缀，控制窗口大小
            source_window = f"{prefix} {current_source_text}".strip()
            current_start = len(prefix) + 1 if prefix else 0

            matched_terms = self._glossary.match_terms(source_window, max_terms=12)
            # 只保留 span 与当前段重叠的术语
            matched_terms = [m for m in matched_terms if m.end > current_start]

            context_glossary = {m.source_for_prompt: m.entry.target for m in matched_terms}
            context_constraints = {m.source_for_prompt: m.entry.constraint for m in matched_terms}

            if context_glossary:
                logger.debug("glossary_match", extra={
                    "matched_terms": list(context_glossary.keys()),
                    "matched_count": len(context_glossary),
                })

        return CorrectionContext(
            recent_segments=tuple(self._history),
            glossary=context_glossary,
            glossary_constraints=context_constraints,
            max_revision_segments=self.revision_window_segments,
        )
