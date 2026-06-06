from __future__ import annotations

import argparse
import asyncio
import logging
import time
from collections import Counter
from collections.abc import AsyncIterator, Sequence
from contextlib import suppress
from dataclasses import dataclass, replace
from pathlib import Path

from echosync_agent.diagnostics.realtime_log_summary import summarize_log_lines
from echosync_agent.domain import (
    AudioFrame,
    SegmentStatus,
    TranscriptSegment,
    TranslationSegment,
)
from echosync_agent.interfaces import Transcriber
from echosync_agent.runtime.assembly import _load_glossary
from echosync_agent.runtime.env import load_project_dotenv
from echosync_agent.runtime.settings import Settings
from echosync_agent.services.asr.factory import build_transcriber_from_settings
from echosync_agent.services.asr.transcript_assembler import TranscriptAssembler
from echosync_agent.services.correction.revision_window import RevisionWindowCorrectionEngine
from echosync_agent.services.engine.cascaded_engine import CascadedInterpretationEngine
from echosync_agent.services.media import MediaAudioSource
from echosync_agent.services.translation.deepseek_translator import DeepSeekTranslator
from echosync_agent.services.translation.mock_translator import MockTranslator
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
class TimedTranscript:
    transcript: TranscriptSegment
    emitted_at_ms: float


@dataclass(frozen=True, slots=True)
class TranslationRunResult:
    strategy: str
    elapsed_ms: float
    target_events: int
    committed_events: int
    first_target_ms: float | None
    first_committed_target_ms: float | None
    log_lines: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RealAgentBenchmarkResult:
    media: str
    audio_ms: int
    asr_provider: str
    translator_provider: str
    deepseek_model: str
    transcript_count: int
    transcript_statuses: Counter[str]
    asr_elapsed_ms: float
    replay_pacing: str
    translation_results: tuple[TranslationRunResult, ...]


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run a real EchoSync Agent ASR + DeepSeek translation A/B benchmark."
    )
    parser.add_argument("media", help="视频或音频文件路径。")
    parser.add_argument("--duration-ms", type=int, default=30_000)
    parser.add_argument("--chunk-ms", type=int, default=80)
    parser.add_argument("--source-lang", default="en")
    parser.add_argument("--asr-provider", choices=["funasr", "voxtral"], default=None)
    parser.add_argument(
        "--translator-provider",
        choices=["deepseek", "mock"],
        default=None,
        help="默认读取 .env；真实翻译延迟请使用 deepseek。",
    )
    parser.add_argument(
        "--log-file",
        type=Path,
        default=None,
        help="可选：保存本次 benchmark 的 Agent 请求级日志。",
    )
    parser.add_argument(
        "--order",
        choices=["old-current", "current-old"],
        default="old-current",
        help="翻译策略执行顺序；用于排查网络波动或 provider cache 带来的顺序偏差。",
    )
    parser.add_argument(
        "--fast-audio",
        action="store_true",
        help="不按音频时间 sleep，快速解码媒体；默认按真实音频时间推进。",
    )
    parser.add_argument(
        "--fast-replay",
        action="store_true",
        help="翻译 A/B 阶段不按 ASR 到达时间 sleep；默认保留 ASR 到达节奏。",
    )
    return parser


async def run_benchmark(args: argparse.Namespace) -> RealAgentBenchmarkResult:
    load_project_dotenv()
    settings = Settings.from_env()
    settings = _with_cli_overrides(settings, args)
    _validate_benchmark_settings(settings)
    transcripts, asr_elapsed_ms = await _collect_real_agent_transcripts(args, settings)
    if not transcripts:
        raise RuntimeError("真实 ASR 没有产出 assembled transcript，无法进行翻译 A/B。")

    results: list[TranslationRunResult] = []
    for strategy in _strategies(order=args.order):
        results.append(
            await _run_translation_strategy(
                transcripts,
                settings,
                strategy,
                paced=not args.fast_replay,
            )
        )

    if args.log_file is not None:
        _write_log_file(args.log_file, transcripts, results)

    return RealAgentBenchmarkResult(
        media=str(args.media),
        audio_ms=min(
            args.duration_ms,
            max(item.transcript.end_ms for item in transcripts),
        ),
        asr_provider=settings.asr_provider,
        translator_provider=settings.translator_provider,
        deepseek_model=settings.deepseek_model,
        transcript_count=len(transcripts),
        transcript_statuses=Counter(str(item.transcript.status) for item in transcripts),
        asr_elapsed_ms=asr_elapsed_ms,
        replay_pacing="fast" if args.fast_replay else "asr_arrival_time",
        translation_results=tuple(results),
    )


def format_benchmark_result(result: RealAgentBenchmarkResult) -> str:
    rows = [
        "EchoSync real Agent translation benchmark",
        (
            f"media={result.media} audio_ms={result.audio_ms} "
            f"asr_provider={result.asr_provider} "
            f"translator_provider={result.translator_provider} "
            f"deepseek_model={result.deepseek_model}"
        ),
        (
            f"asr_elapsed_ms={result.asr_elapsed_ms:.1f} "
            f"transcripts={result.transcript_count} "
            f"statuses={_format_counter(result.transcript_statuses)} "
            f"replay_pacing={result.replay_pacing}"
        ),
        "scope=real ASR transcripts + real Agent cascaded engine + configured translator.",
        "",
    ]
    for item in result.translation_results:
        summary = summarize_log_lines(item.log_lines)
        rows.extend(
            [
                f"strategy={item.strategy}",
                (
                    f"  elapsed_ms={item.elapsed_ms:.1f} "
                    f"target_events={item.target_events} "
                    f"committed_events={item.committed_events} "
                    f"first_target_ms={_format_optional_ms(item.first_target_ms)} "
                    "first_committed_target_ms="
                    f"{_format_optional_ms(item.first_committed_target_ms)}"
                ),
                (
                    f"  translation_started={summary.translation_started} "
                    f"translation_finished={summary.translation_finished} "
                    f"translation_skipped={summary.translation_skipped} "
                    f"skip_ratio={summary.translation_skip_ratio:.3f} "
                    f"simul_wait={summary.simul_wait}"
                ),
                f"  skipped_reasons={_format_counter(summary.skipped_reasons)}",
                f"  queue_wait_ms={_format_distribution(summary.queue_wait_ms)}",
                f"  first_token_ms={_format_distribution(summary.first_token_ms)}",
                f"  translation_latency_ms={_format_distribution(summary.translation_latency_ms)}",
                "",
            ]
        )
    rows.extend(_format_deltas(result.translation_results))
    return "\n".join(rows).rstrip()


def main(argv: Sequence[str] | None = None) -> None:
    args = build_arg_parser().parse_args(argv)
    result = asyncio.run(run_benchmark(args))
    print(format_benchmark_result(result))


async def _collect_real_agent_transcripts(
    args: argparse.Namespace,
    settings: Settings,
) -> tuple[tuple[TimedTranscript, ...], float]:
    source = MediaAudioSource(
        path=args.media,
        session_id="sess_real_agent_benchmark",
        source_lang=args.source_lang,
        chunk_ms=args.chunk_ms,
    )
    transcriber = build_transcriber_from_settings(settings)
    assembler = TranscriptAssembler()
    started_at = time.perf_counter()
    transcripts: list[TimedTranscript] = []
    frames: AsyncIterator[AudioFrame] = _limit_frames(
        source.frames(),
        max_audio_ms=args.duration_ms,
    )
    if not args.fast_audio:
        frames = _pace_frames(frames)
    async for segment in assembler.stream(transcriber.stream(frames)):
        transcripts.append(
            TimedTranscript(
                transcript=segment,
                emitted_at_ms=max((time.perf_counter() - started_at) * 1000, 0.0),
            )
        )
    return tuple(transcripts), max((time.perf_counter() - started_at) * 1000, 0.0)


async def _run_translation_strategy(
    transcripts: Sequence[TimedTranscript],
    settings: Settings,
    strategy: StrategyConfig,
    *,
    paced: bool,
) -> TranslationRunResult:
    engine = CascadedInterpretationEngine(
        transcriber=_ReplayTranscriber(transcripts, paced=paced),
        translator=_build_translator(settings),
        correction_engine=RevisionWindowCorrectionEngine(),
        transcript_assembler=_PassThroughAssembler(),
        target_lang=settings.target_lang,
        glossary=_load_glossary(settings),
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
    first_committed_target_ms: float | None = None
    target_events = 0
    committed_events = 0
    try:
        async for event in engine.stream(_single_frame()):
            if not isinstance(event, TranslationSegment) or not event.target_text.strip():
                continue
            target_events += 1
            elapsed_ms = max((time.perf_counter() - started_at) * 1000, 0.0)
            if first_target_ms is None:
                first_target_ms = elapsed_ms
            if event.status == SegmentStatus.COMMITTED:
                committed_events += 1
                if first_committed_target_ms is None:
                    first_committed_target_ms = elapsed_ms
    finally:
        elapsed_ms = max((time.perf_counter() - started_at) * 1000, 0.0)
        logger.removeHandler(handler)
        logger.setLevel(previous_level)

    return TranslationRunResult(
        strategy=strategy.name,
        elapsed_ms=elapsed_ms,
        target_events=target_events,
        committed_events=committed_events,
        first_target_ms=first_target_ms,
        first_committed_target_ms=first_committed_target_ms,
        log_lines=tuple(handler.messages),
    )


def _with_cli_overrides(settings: Settings, args: argparse.Namespace) -> Settings:
    updates: dict[str, str] = {}
    if args.asr_provider:
        updates["asr_provider"] = args.asr_provider
    if args.translator_provider:
        updates["translator_provider"] = args.translator_provider
    if not updates:
        return settings
    return replace(settings, **updates)


def _validate_benchmark_settings(settings: Settings) -> None:
    if settings.asr_provider == "mock":
        raise ValueError(
            "真实 Agent benchmark 需要 FunASR 或 Voxtral ASR；请配置 "
            "ECHOSYNC_ASR_PROVIDER=funasr/voxtral，或传入 --asr-provider。"
        )
    if settings.asr_provider not in {"funasr", "voxtral"}:
        raise ValueError(f"不支持的 benchmark ASR provider：{settings.asr_provider}")
    if settings.translator_provider not in {"deepseek", "mock"}:
        raise ValueError(f"不支持的 benchmark 翻译 provider：{settings.translator_provider}")


def _build_translator(settings: Settings):
    if settings.translator_provider == "mock":
        return MockTranslator(target_lang=settings.target_lang)
    if settings.translator_provider != "deepseek":
        raise ValueError(f"不支持的翻译 provider：{settings.translator_provider}")
    if not settings.deepseek_api_key:
        raise ValueError("真实 DeepSeek 测评需要配置 DEEPSEEK_API_KEY。")
    return DeepSeekTranslator(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
        model=settings.deepseek_model,
        target_lang=settings.target_lang,
    )


def _strategies(*, order: str) -> tuple[StrategyConfig, ...]:
    strategies = (
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
    if order == "current-old":
        return tuple(reversed(strategies))
    return strategies


class _NoWaitSimulPolicy(SimulTranslationPolicy):
    def should_translate(
        self,
        transcript: TranscriptSegment,
        *,
        previous_revision: TranslationSegment | None = None,
    ) -> SimulPolicyDecision:
        if transcript.status == SegmentStatus.COMMITTED:
            action = SimulPolicyAction.COMMIT
            reason = "source_committed"
            confidence = 1.0
        else:
            action = SimulPolicyAction.DRAFT
            reason = "old_like_no_wait"
            confidence = 0.5
        return SimulPolicyDecision(
            action=action,
            reason=reason,
            confidence=confidence,
            source_span_end=len(transcript.text.strip()),
        )


class _ReplayTranscriber(Transcriber):
    def __init__(self, transcripts: Sequence[TimedTranscript], *, paced: bool) -> None:
        self.transcripts = tuple(transcripts)
        self.paced = paced

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        async for _frame in frames:
            started_at = time.perf_counter()
            for item in self.transcripts:
                if self.paced:
                    elapsed_ms = (time.perf_counter() - started_at) * 1000
                    wait_ms = item.emitted_at_ms - elapsed_ms
                    if wait_ms > 0:
                        await asyncio.sleep(wait_ms / 1000)
                yield item.transcript
            return


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


async def _limit_frames(
    frames: AsyncIterator[AudioFrame],
    *,
    max_audio_ms: int,
) -> AsyncIterator[AudioFrame]:
    iterator = aiter(frames)
    try:
        async for frame in iterator:
            if frame.end_ms >= max_audio_ms:
                yield replace(frame, is_final=True)
                return
            yield frame
    finally:
        aclose = getattr(iterator, "aclose", None)
        if aclose is not None:
            with suppress(Exception):
                await aclose()


async def _pace_frames(frames: AsyncIterator[AudioFrame]) -> AsyncIterator[AudioFrame]:
    started_at = time.perf_counter()
    async for frame in frames:
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        wait_ms = frame.end_ms - elapsed_ms
        if wait_ms > 0:
            await asyncio.sleep(wait_ms / 1000)
        yield frame


async def _single_frame() -> AsyncIterator[AudioFrame]:
    yield AudioFrame(
        session_id="sess_real_agent_benchmark",
        seq=1,
        pcm=b"ignored",
        sample_rate=16_000,
        channels=1,
        start_ms=0,
        end_ms=1,
        source_lang="en",
    )


def _write_log_file(
    path: Path,
    transcripts: Sequence[TimedTranscript],
    results: Sequence[TranslationRunResult],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"real_agent_benchmark transcripts={len(transcripts)}",
        *(
            "real_agent_benchmark_transcript "
            f"segment_id={item.transcript.segment_id} rev={item.transcript.rev} "
            f"status={item.transcript.status} "
            f"start_ms={item.transcript.start_ms} end_ms={item.transcript.end_ms} "
            f"emitted_at_ms={item.emitted_at_ms:.1f} "
            f"source_chars={len(item.transcript.text)}"
            for item in transcripts
        ),
    ]
    for result in results:
        lines.append(f"real_agent_benchmark_strategy strategy={result.strategy}")
        lines.extend(result.log_lines)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _format_deltas(results: Sequence[TranslationRunResult]) -> list[str]:
    old = next((item for item in results if item.strategy.startswith("old_like")), None)
    current = next((item for item in results if item.strategy.startswith("current")), None)
    if old is None or current is None:
        return []
    old_summary = summarize_log_lines(old.log_lines)
    current_summary = summarize_log_lines(current.log_lines)
    started_delta = current_summary.translation_started - old_summary.translation_started
    skipped_delta = current_summary.translation_skipped - old_summary.translation_skipped
    first_token_delta = _format_delta_float(
        _avg(current_summary.first_token_ms),
        _avg(old_summary.first_token_ms),
    )
    latency_delta = _format_delta_float(
        _avg(current_summary.translation_latency_ms),
        _avg(old_summary.translation_latency_ms),
    )
    rows = ["delta_current_vs_old_like:"]
    rows.append(f"  translation_started={started_delta:+d}")
    rows.append(f"  translation_skipped={skipped_delta:+d}")
    rows.append(
        "  first_committed_target_ms="
        f"{_format_delta_ms(current.first_committed_target_ms, old.first_committed_target_ms)}"
    )
    rows.append(f"  avg_first_token_ms={first_token_delta}")
    rows.append(f"  avg_translation_latency_ms={latency_delta}")
    return rows


def _format_counter(counter: Counter[str]) -> str:
    if not counter:
        return "-"
    return ",".join(f"{key}:{value}" for key, value in sorted(counter.items()))


def _format_distribution(values: Sequence[float]) -> str:
    if not values:
        return "n:0"
    ordered = sorted(values)
    return (
        f"n:{len(ordered)} "
        f"avg:{sum(ordered) / len(ordered):.1f} "
        f"p50:{_percentile(ordered, 0.50):.1f} "
        f"p95:{_percentile(ordered, 0.95):.1f} "
        f"max:{ordered[-1]:.1f}"
    )


def _percentile(ordered_values: Sequence[float], percentile: float) -> float:
    if not ordered_values:
        return 0.0
    index = round((len(ordered_values) - 1) * percentile)
    return ordered_values[index]


def _format_optional_ms(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:.1f}"


def _format_delta_ms(current: float | None, old: float | None) -> str:
    if current is None or old is None:
        return "n/a"
    return f"{current - old:+.1f}"


def _avg(values: Sequence[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def _format_delta_float(current: float | None, old: float | None) -> str:
    if current is None or old is None:
        return "n/a"
    return f"{current - old:+.1f}"


if __name__ == "__main__":
    main()
