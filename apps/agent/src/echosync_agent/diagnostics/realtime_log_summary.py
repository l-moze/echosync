from __future__ import annotations

import argparse
import re
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

FLOAT_RE = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)"
KEY_VALUE_RE = re.compile(rf"([a-zA-Z_][a-zA-Z0-9_]*)=({FLOAT_RE}|[^\s]+)")


@dataclass(slots=True)
class RealtimeLogSummary:
    lines: int = 0
    translation_started: int = 0
    translation_finished: int = 0
    translation_skipped: int = 0
    translation_dropped: int = 0
    skipped_reasons: Counter[str] = field(default_factory=Counter)
    dropped_reasons: Counter[str] = field(default_factory=Counter)
    simul_wait: int = 0
    simul_actions: Counter[str] = field(default_factory=Counter)
    caption_events: Counter[str] = field(default_factory=Counter)
    avg_audio_transport_ms: list[float] = field(default_factory=list)
    p95_audio_transport_ms: list[float] = field(default_factory=list)
    avg_asr_queue_wait_ms: list[float] = field(default_factory=list)
    p95_asr_queue_wait_ms: list[float] = field(default_factory=list)
    funasr_latency_ms: list[float] = field(default_factory=list)
    funasr_rtf: list[float] = field(default_factory=list)
    queue_wait_ms: list[float] = field(default_factory=list)
    first_token_ms: list[float] = field(default_factory=list)
    translation_latency_ms: list[float] = field(default_factory=list)
    tts_started: int = 0
    tts_finished: int = 0
    tts_failed: int = 0
    tts_first_audio_ms: list[float] = field(default_factory=list)
    tts_total_ms: list[float] = field(default_factory=list)
    tts_audio_chunks: list[float] = field(default_factory=list)
    tts_audio_bytes: list[float] = field(default_factory=list)

    @property
    def translation_skip_ratio(self) -> float:
        denominator = self.translation_started + self.translation_skipped
        if denominator <= 0:
            return 0.0
        return self.translation_skipped / denominator


def summarize_log_lines(lines: Iterable[str]) -> RealtimeLogSummary:
    summary = RealtimeLogSummary()
    for line in lines:
        summary.lines += 1
        fields = _parse_key_values(line)

        if "translation_checkpoint_started" in line:
            summary.translation_started += 1
            action = fields.get("simul_action")
            if action:
                summary.simul_actions[action] += 1
            _append_float(summary.queue_wait_ms, fields.get("translation_queue_wait_ms"))
        if "translation_checkpoint_first_token" in line:
            _append_float(summary.first_token_ms, fields.get("first_token_ms"))
        if "translation_checkpoint_finished" in line:
            summary.translation_finished += 1
            _append_float(summary.translation_latency_ms, fields.get("final_ms"))
        if "translation_checkpoint_skipped" in line:
            summary.translation_skipped += 1
            reason = fields.get("reason", "unknown")
            summary.skipped_reasons[reason] += 1
            if reason == "simul_wait":
                summary.simul_wait += 1
        if "translation_checkpoint_dropped" in line:
            summary.translation_dropped += 1
            reason = fields.get("reason", "unknown")
            summary.dropped_reasons[reason] += 1
        if "caption_event_published" in line:
            event_type = fields.get("type", "unknown")
            summary.caption_events[event_type] += 1
        if "audio_stream_metrics" in line:
            _append_float(summary.avg_audio_transport_ms, fields.get("avg_transport_ms"))
            _append_float(summary.p95_audio_transport_ms, fields.get("p95_transport_ms"))
            _append_float(summary.avg_asr_queue_wait_ms, fields.get("avg_asr_queue_wait_ms"))
            _append_float(summary.p95_asr_queue_wait_ms, fields.get("p95_asr_queue_wait_ms"))
        if "funasr_inference_chunk" in line:
            _append_float(summary.funasr_latency_ms, fields.get("latency_ms"))
            _append_float(summary.funasr_rtf, fields.get("rtf"))
        if "tts_synthesis_started" in line:
            summary.tts_started += 1
        if "tts_synthesis_first_audio" in line:
            _append_float(summary.tts_first_audio_ms, fields.get("first_audio_ms"))
        if "tts_synthesis_finished" in line:
            summary.tts_finished += 1
            _append_float(summary.tts_total_ms, fields.get("total_ms"))
            _append_float(summary.tts_audio_chunks, fields.get("audio_chunks"))
            _append_float(summary.tts_audio_bytes, fields.get("audio_bytes"))
        if "tts_synthesis_failed" in line:
            summary.tts_failed += 1

    return summary


def summarize_log_files(paths: Sequence[Path]) -> RealtimeLogSummary:
    summary = RealtimeLogSummary()
    for path in paths:
        with path.open("r", encoding="utf-8", errors="replace") as file:
            partial = summarize_log_lines(file)
        _merge(summary, partial)
    return summary


def format_summary(summary: RealtimeLogSummary) -> str:
    rows = [
        "EchoSync realtime log summary",
        f"lines={summary.lines}",
        (
            "translation_started="
            f"{summary.translation_started} translation_finished={summary.translation_finished} "
            f"translation_skipped={summary.translation_skipped} "
            f"translation_dropped={summary.translation_dropped} "
            f"skip_ratio={summary.translation_skip_ratio:.3f}"
        ),
        f"simul_wait={summary.simul_wait}",
        f"skipped_reasons={_format_counter(summary.skipped_reasons)}",
        f"dropped_reasons={_format_counter(summary.dropped_reasons)}",
        f"simul_actions={_format_counter(summary.simul_actions)}",
        f"caption_events={_format_counter(summary.caption_events)}",
        _format_distribution("avg_audio_transport_ms", summary.avg_audio_transport_ms),
        _format_distribution("p95_audio_transport_ms", summary.p95_audio_transport_ms),
        _format_distribution("avg_asr_queue_wait_ms", summary.avg_asr_queue_wait_ms),
        _format_distribution("p95_asr_queue_wait_ms", summary.p95_asr_queue_wait_ms),
        _format_distribution("funasr_latency_ms", summary.funasr_latency_ms),
        _format_distribution("funasr_rtf", summary.funasr_rtf),
        _format_distribution("translation_queue_wait_ms", summary.queue_wait_ms),
        _format_distribution("translation_first_token_ms", summary.first_token_ms),
        _format_distribution("translation_latency_ms", summary.translation_latency_ms),
        (
            f"tts_started={summary.tts_started} "
            f"tts_finished={summary.tts_finished} tts_failed={summary.tts_failed}"
        ),
        _format_distribution("tts_first_audio_ms", summary.tts_first_audio_ms),
        _format_distribution("tts_total_ms", summary.tts_total_ms),
        _format_distribution("tts_audio_chunks", summary.tts_audio_chunks),
        _format_distribution("tts_audio_bytes", summary.tts_audio_bytes),
    ]
    return "\n".join(rows)


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Summarize EchoSync realtime log metrics.")
    parser.add_argument("logs", nargs="+", type=Path, help="Log file paths to summarize.")
    args = parser.parse_args(argv)
    print(format_summary(summarize_log_files(args.logs)))


def _parse_key_values(line: str) -> dict[str, str]:
    return {match.group(1): match.group(2) for match in KEY_VALUE_RE.finditer(line)}


def _append_float(values: list[float], raw: str | None) -> None:
    if raw is None:
        return
    try:
        value = float(raw)
    except ValueError:
        return
    if value >= 0:
        values.append(value)


def _merge(target: RealtimeLogSummary, source: RealtimeLogSummary) -> None:
    target.lines += source.lines
    target.translation_started += source.translation_started
    target.translation_finished += source.translation_finished
    target.translation_skipped += source.translation_skipped
    target.translation_dropped += source.translation_dropped
    target.skipped_reasons.update(source.skipped_reasons)
    target.dropped_reasons.update(source.dropped_reasons)
    target.simul_wait += source.simul_wait
    target.simul_actions.update(source.simul_actions)
    target.caption_events.update(source.caption_events)
    target.avg_audio_transport_ms.extend(source.avg_audio_transport_ms)
    target.p95_audio_transport_ms.extend(source.p95_audio_transport_ms)
    target.avg_asr_queue_wait_ms.extend(source.avg_asr_queue_wait_ms)
    target.p95_asr_queue_wait_ms.extend(source.p95_asr_queue_wait_ms)
    target.funasr_latency_ms.extend(source.funasr_latency_ms)
    target.funasr_rtf.extend(source.funasr_rtf)
    target.queue_wait_ms.extend(source.queue_wait_ms)
    target.first_token_ms.extend(source.first_token_ms)
    target.translation_latency_ms.extend(source.translation_latency_ms)
    target.tts_started += source.tts_started
    target.tts_finished += source.tts_finished
    target.tts_failed += source.tts_failed
    target.tts_first_audio_ms.extend(source.tts_first_audio_ms)
    target.tts_total_ms.extend(source.tts_total_ms)
    target.tts_audio_chunks.extend(source.tts_audio_chunks)
    target.tts_audio_bytes.extend(source.tts_audio_bytes)


def _format_counter(counter: Counter[str]) -> str:
    if not counter:
        return "-"
    return ",".join(f"{key}:{value}" for key, value in sorted(counter.items()))


def _format_distribution(name: str, values: Sequence[float]) -> str:
    if not values:
        return f"{name}=n:0"
    ordered = sorted(values)
    return (
        f"{name}=n:{len(ordered)} "
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


if __name__ == "__main__":
    main()
