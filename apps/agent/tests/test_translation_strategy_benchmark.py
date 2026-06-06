from __future__ import annotations

import asyncio
from argparse import Namespace
from collections import Counter

import pytest

from echosync_agent.diagnostics.real_agent_translation_benchmark import (
    RealAgentBenchmarkResult,
    TranslationRunResult,
    _validate_benchmark_settings,
    _with_cli_overrides,
    format_benchmark_result,
)
from echosync_agent.diagnostics.translation_strategy_benchmark import (
    format_results,
    run_benchmarks,
)
from echosync_agent.runtime.settings import Settings


def test_translation_strategy_benchmark_quantifies_request_reduction() -> None:
    results = asyncio.run(run_benchmarks(first_token_ms=0.0, total_ms=0.0))
    by_key = {(item.scenario, item.strategy): item for item in results}

    partial_old = by_key[
        ("long_partial_then_committed", "old_like_partial_on_simul_wait_off")
    ]
    partial_current = by_key[
        ("long_partial_then_committed", "current_partial_off_simul_wait_on")
    ]
    tail_old = by_key[
        ("suspended_stable_tail_then_committed", "old_like_partial_on_simul_wait_off")
    ]
    tail_current = by_key[
        ("suspended_stable_tail_then_committed", "current_partial_off_simul_wait_on")
    ]

    assert partial_old.requests == 2
    assert partial_current.requests == 1
    assert partial_current.skipped == 1
    assert partial_current.simul_wait == 0

    assert tail_old.requests == 2
    assert tail_current.requests == 1
    assert tail_current.skipped == 1
    assert tail_current.simul_wait == 1


def test_translation_strategy_benchmark_output_marks_synthetic_scope() -> None:
    results = asyncio.run(run_benchmarks(first_token_ms=0.0, total_ms=0.0))
    output = format_results(results, first_token_ms=0.0, total_ms=0.0)

    assert "synthetic" in output
    assert "not a real DeepSeek/ElevenLabs network latency A/B result" in output
    assert "delta_current_vs_old_like: requests=-1" in output


def test_real_agent_benchmark_rejects_mock_asr_provider() -> None:
    with pytest.raises(ValueError, match="需要 FunASR 或 Voxtral ASR"):
        _validate_benchmark_settings(_settings(asr_provider="mock"))


def test_real_agent_benchmark_cli_overrides_provider_settings() -> None:
    settings = _with_cli_overrides(
        _settings(asr_provider="mock", translator_provider="mock"),
        Namespace(asr_provider="funasr", translator_provider="deepseek"),
    )

    assert settings.asr_provider == "funasr"
    assert settings.translator_provider == "deepseek"


def test_real_agent_benchmark_output_marks_real_scope_and_deltas() -> None:
    output = format_benchmark_result(
        RealAgentBenchmarkResult(
            media="demo.mp4",
            audio_ms=1200,
            asr_provider="funasr",
            translator_provider="mock",
            deepseek_model="deepseek-chat",
            transcript_count=2,
            transcript_statuses=Counter({"committed": 2}),
            asr_elapsed_ms=88.0,
            replay_pacing="fast",
            translation_results=(
                TranslationRunResult(
                    strategy="old_like_partial_on_simul_wait_off",
                    elapsed_ms=20.0,
                    target_events=2,
                    committed_events=1,
                    first_target_ms=4.0,
                    first_committed_target_ms=12.0,
                    log_lines=(
                        "translation_checkpoint_started translation_queue_wait_ms=2.0",
                        "translation_checkpoint_first_token first_token_ms=6.0",
                        "translation_checkpoint_finished final_ms=9.0 first_token_ms=6.0",
                    ),
                ),
                TranslationRunResult(
                    strategy="current_partial_off_simul_wait_on",
                    elapsed_ms=14.0,
                    target_events=1,
                    committed_events=1,
                    first_target_ms=3.0,
                    first_committed_target_ms=8.0,
                    log_lines=(
                        "translation_checkpoint_started translation_queue_wait_ms=1.0",
                        "translation_checkpoint_first_token first_token_ms=4.0",
                        "translation_checkpoint_finished final_ms=7.0 first_token_ms=4.0",
                    ),
                ),
            ),
        )
    )

    assert "EchoSync real Agent translation benchmark" in output
    assert "scope=real ASR transcripts + real Agent cascaded engine" in output
    assert "delta_current_vs_old_like:" in output
    assert "translation_started=+0" in output
    assert "first_committed_target_ms=-4.0" in output


def _settings(**overrides: object) -> Settings:
    values = {
        "asr_provider": "funasr",
        "translator_provider": "mock",
        "tts_provider": "disabled",
        "target_lang": "zh-CN",
        "funasr_model": "paraformer-zh-streaming",
        "funasr_device": "auto",
        "funasr_chunk_ms": 600,
        "asr_server_port": 8765,
        "deepseek_api_key": "",
        "deepseek_base_url": "https://api.deepseek.com/v1",
        "deepseek_model": "deepseek-chat",
        "edge_tts_voice": "zh-CN-XiaoxiaoNeural",
        "elevenlabs_api_key": "",
        "elevenlabs_voice_id": "",
        "elevenlabs_model": "eleven_flash_v2_5",
        "elevenlabs_output_format": "mp3_44100_128",
        "elevenlabs_optimize_streaming_latency": None,
        "mistral_api_key": "",
        "voxtral_model": "voxtral-mini-transcribe-realtime-2602",
        "voxtral_target_delay_ms": 1000,
    }
    values.update(overrides)
    return Settings(**values)
