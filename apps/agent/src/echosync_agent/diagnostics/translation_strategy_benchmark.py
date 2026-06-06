from __future__ import annotations

import argparse
import asyncio
import logging
import time
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass

from echosync_agent.diagnostics.realtime_log_summary import summarize_log_lines
from echosync_agent.domain import (
    AudioFrame,
    CorrectionContext,
    SegmentStatus,
    TranscriptSegment,
    TranslationSegment,
)
from echosync_agent.interfaces import CorrectionEngine, Transcriber
from echosync_agent.services.engine.cascaded_engine import CascadedInterpretationEngine
from echosync_agent.services.translation.simul_policy import (
    SimulPolicyAction,
    SimulPolicyDecision,
    SimulTranslationPolicy,
)


@dataclass(frozen=True, slots=True)
class StrategyConfig:
    name: str
    translate_partial_checkpoints: bool
    simul_policy: SimulTranslationPolicy


@dataclass(frozen=True, slots=True)
class Scenario:
    name: str
    segments: tuple[TranscriptSegment, ...]


@dataclass(frozen=True, slots=True)
class BenchmarkResult:
    scenario: str
    strategy: str
    requests: int
    skipped: int
    simul_wait: int
    committed_first_target_ms: float | None
    first_target_ms: float | None
    elapsed_ms: float
    estimated_request_work_ms: float

    @property
    def committed_first_target_display(self) -> str:
        if self.committed_first_target_ms is None:
            return "n/a"
        return f"{self.committed_first_target_ms:.1f}"

    @property
    def first_target_display(self) -> str:
        if self.first_target_ms is None:
            return "n/a"
        return f"{self.first_target_ms:.1f}"


async def run_benchmarks(
    *,
    first_token_ms: float = 35.0,
    total_ms: float = 90.0,
) -> list[BenchmarkResult]:
    results: list[BenchmarkResult] = []
    for scenario in _scenarios():
        for strategy in _strategies():
            results.append(
                await _run_one(
                    scenario,
                    strategy,
                    first_token_ms=first_token_ms,
                    total_ms=total_ms,
                )
            )
    return results


def format_results(
    results: Sequence[BenchmarkResult],
    *,
    first_token_ms: float,
    total_ms: float,
) -> str:
    rows = [
        "EchoSync translation strategy benchmark (synthetic)",
        (
            "simulated_translator="
            f"first_token_ms:{first_token_ms:.1f} total_ms:{total_ms:.1f}"
        ),
        (
            "scope=scheduling pressure only; this is not a real DeepSeek/ElevenLabs "
            "network latency A/B result."
        ),
        "",
    ]
    by_scenario: dict[str, list[BenchmarkResult]] = {}
    for result in results:
        by_scenario.setdefault(result.scenario, []).append(result)

    for scenario, items in by_scenario.items():
        rows.append(f"scenario={scenario}")
        for item in items:
            rows.append(
                "  "
                f"{item.strategy}: requests={item.requests} skipped={item.skipped} "
                f"simul_wait={item.simul_wait} "
                f"committed_first_target_ms={item.committed_first_target_display} "
                f"first_target_ms={item.first_target_display} "
                f"elapsed_ms={item.elapsed_ms:.1f} "
                f"estimated_request_work_ms={item.estimated_request_work_ms:.1f}"
            )
        delta = _format_delta(items)
        if delta:
            rows.append(f"  delta_current_vs_old_like: {delta}")
        rows.append("")
    return "\n".join(rows).rstrip()


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="Benchmark EchoSync translation scheduling strategies."
    )
    parser.add_argument("--first-token-ms", type=float, default=35.0)
    parser.add_argument("--total-ms", type=float, default=90.0)
    args = parser.parse_args(argv)
    results = asyncio.run(
        run_benchmarks(
            first_token_ms=args.first_token_ms,
            total_ms=args.total_ms,
        )
    )
    print(
        format_results(
            results,
            first_token_ms=args.first_token_ms,
            total_ms=args.total_ms,
        )
    )


async def _run_one(
    scenario: Scenario,
    strategy: StrategyConfig,
    *,
    first_token_ms: float,
    total_ms: float,
) -> BenchmarkResult:
    translator = _FixedDelayStreamingTranslator(
        first_token_ms=first_token_ms,
        total_ms=total_ms,
    )
    engine = CascadedInterpretationEngine(
        transcriber=_ScenarioTranscriber(scenario.segments),
        translator=translator,
        correction_engine=_NoopCorrectionEngine(),
        transcript_assembler=_PassThroughAssembler(),
        translate_partial_checkpoints=strategy.translate_partial_checkpoints,
        simul_policy=strategy.simul_policy,
    )
    handler = _MemoryLogHandler()
    logger = logging.getLogger("echosync_agent.services.engine.cascaded_engine")
    previous_level = logger.level
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    started_at = time.perf_counter()
    first_target_ms: float | None = None
    committed_first_target_ms: float | None = None
    try:
        async for event in engine.stream(_frames()):
            if not isinstance(event, TranslationSegment) or not event.target_text:
                continue
            elapsed_ms = (time.perf_counter() - started_at) * 1000
            if first_target_ms is None:
                first_target_ms = elapsed_ms
            if (
                committed_first_target_ms is None
                and event.status == SegmentStatus.COMMITTED
            ):
                committed_first_target_ms = elapsed_ms
    finally:
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        logger.removeHandler(handler)
        logger.setLevel(previous_level)

    summary = summarize_log_lines(handler.messages)
    return BenchmarkResult(
        scenario=scenario.name,
        strategy=strategy.name,
        requests=len(translator.seen_segments),
        skipped=summary.translation_skipped,
        simul_wait=summary.simul_wait,
        committed_first_target_ms=committed_first_target_ms,
        first_target_ms=first_target_ms,
        elapsed_ms=elapsed_ms,
        estimated_request_work_ms=len(translator.seen_segments) * total_ms,
    )


def _strategies() -> tuple[StrategyConfig, ...]:
    return (
        StrategyConfig(
            name="old_like_partial_on_simul_wait_off",
            translate_partial_checkpoints=True,
            simul_policy=_NoWaitSimulPolicy(),
        ),
        StrategyConfig(
            name="current_partial_off_simul_wait_on",
            translate_partial_checkpoints=False,
            simul_policy=SimulTranslationPolicy(),
        ),
    )


def _scenarios() -> tuple[Scenario, ...]:
    return (
        Scenario(
            name="long_partial_then_committed",
            segments=(
                _segment(
                    segment_id="seg_partial",
                    rev=1,
                    text="Today we discuss realtime translation",
                    status=SegmentStatus.PARTIAL,
                    end_ms=1_200,
                ),
                _segment(
                    segment_id="seg_partial",
                    rev=2,
                    text="Today we discuss realtime translation.",
                    status=SegmentStatus.COMMITTED,
                    end_ms=1_700,
                    stability=1.0,
                ),
            ),
        ),
        Scenario(
            name="suspended_stable_tail_then_committed",
            segments=(
                _segment(
                    segment_id="seg_tail",
                    rev=1,
                    text="We need to talk about the",
                    status=SegmentStatus.STABLE,
                    end_ms=1_200,
                    stability=0.9,
                ),
                _segment(
                    segment_id="seg_tail",
                    rev=2,
                    text="We need to talk about the model.",
                    status=SegmentStatus.COMMITTED,
                    end_ms=1_800,
                    stability=1.0,
                ),
            ),
        ),
    )


def _segment(
    *,
    segment_id: str,
    rev: int,
    text: str,
    status: SegmentStatus,
    end_ms: int,
    stability: float = 0.72,
) -> TranscriptSegment:
    return TranscriptSegment(
        session_id="sess_strategy_benchmark",
        segment_id=segment_id,
        rev=rev,
        start_ms=0,
        end_ms=end_ms,
        source_lang="en",
        text=text,
        status=status,
        stability=stability,
        metrics={"asr_latency_ms": 10.0},
    )


def _format_delta(items: Sequence[BenchmarkResult]) -> str:
    old = next(
        (item for item in items if item.strategy == "old_like_partial_on_simul_wait_off"),
        None,
    )
    current = next(
        (item for item in items if item.strategy == "current_partial_off_simul_wait_on"),
        None,
    )
    if old is None or current is None:
        return ""
    request_delta = current.requests - old.requests
    work_delta = current.estimated_request_work_ms - old.estimated_request_work_ms
    parts = [
        f"requests={request_delta:+d}",
        f"estimated_request_work_ms={work_delta:+.1f}",
    ]
    if (
        old.committed_first_target_ms is not None
        and current.committed_first_target_ms is not None
    ):
        parts.append(
            "committed_first_target_ms="
            f"{current.committed_first_target_ms - old.committed_first_target_ms:+.1f}"
        )
    return " ".join(parts)


class _NoWaitSimulPolicy(SimulTranslationPolicy):
    def should_translate(
        self,
        transcript: TranscriptSegment,
        *,
        previous_revision: TranslationSegment | None = None,
    ) -> SimulPolicyDecision:
        if transcript.status == SegmentStatus.COMMITTED:
            return SimulPolicyDecision(
                action=SimulPolicyAction.COMMIT,
                reason="source_committed",
                confidence=1.0,
                source_span_end=len(transcript.text.strip()),
            )
        return SimulPolicyDecision(
            action=SimulPolicyAction.DRAFT,
            reason="old_like_no_wait",
            confidence=0.5,
            source_span_end=len(transcript.text.strip()),
        )


class _ScenarioTranscriber(Transcriber):
    def __init__(self, segments: Sequence[TranscriptSegment]) -> None:
        self.segments = tuple(segments)

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        async for _frame in frames:
            for segment in self.segments:
                yield segment
            return


class _FixedDelayStreamingTranslator:
    def __init__(self, *, first_token_ms: float, total_ms: float) -> None:
        self.first_token_ms = first_token_ms
        self.total_ms = max(total_ms, first_token_ms)
        self.seen_segments: list[TranscriptSegment] = []

    async def translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> TranslationSegment:
        final: TranslationSegment | None = None
        async for translation in self.stream_translate(segment, context):
            final = translation
        if final is None:
            raise RuntimeError("translator produced no result")
        return final

    async def stream_translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> AsyncIterator[TranslationSegment]:
        self.seen_segments.append(segment)
        await asyncio.sleep(self.first_token_ms / 1000)
        yield _translation(segment, "[zh]")
        await asyncio.sleep((self.total_ms - self.first_token_ms) / 1000)
        yield _translation(segment, f"[zh] {segment.text}")


class _NoopCorrectionEngine(CorrectionEngine):
    async def revise(
        self,
        current: TranslationSegment,
        context: CorrectionContext,
    ):
        return None


class _PassThroughAssembler:
    async def stream(
        self,
        segments: AsyncIterator[TranscriptSegment],
    ) -> AsyncIterator[TranscriptSegment]:
        async for segment in segments:
            yield segment


class _MemoryLogHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.INFO)
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


def _translation(segment: TranscriptSegment, target_text: str) -> TranslationSegment:
    return TranslationSegment(
        session_id=segment.session_id,
        segment_id=segment.segment_id,
        rev=segment.rev,
        source_rev=segment.rev,
        start_ms=segment.start_ms,
        end_ms=segment.end_ms,
        source_lang=segment.source_lang,
        target_lang="zh-CN",
        source_text=segment.text,
        target_text=target_text,
        status=segment.status,
        stability=segment.stability,
        metrics=dict(segment.metrics),
    )


async def _frames() -> AsyncIterator[AudioFrame]:
    yield AudioFrame(
        session_id="sess_strategy_benchmark",
        seq=1,
        pcm=b"ignored",
        sample_rate=16_000,
        channels=1,
        start_ms=0,
        end_ms=2_000,
        source_lang="en",
    )


if __name__ == "__main__":
    main()
