from __future__ import annotations

from echosync_agent.diagnostics.realtime_log_summary import (
    format_summary,
    summarize_log_lines,
)


def test_realtime_log_summary_counts_translation_policy_and_latency_metrics() -> None:
    summary = summarize_log_lines(
        [
            (
                "translation_checkpoint_started session_id=sess segment_id=seg rev=1 "
                "status=stable translation_queue_wait_ms=12.0 "
                "simul_action=SimulPolicyAction.DRAFT simul_reason=stable_source"
            ),
            (
                "translation_checkpoint_first_token session_id=sess segment_id=seg rev=1 "
                "status=stable first_token_ms=140.0"
            ),
            (
                "translation_checkpoint_finished session_id=sess segment_id=seg rev=1 "
                "status=stable final_ms=210.0 first_token_ms=140.0 "
                "translation_latency_ms=210.0"
            ),
            (
                "translation_checkpoint_skipped session_id=sess segment_id=seg rev=2 "
                "status=stable reason=simul_wait simul_reason=suspended_tail"
            ),
            (
                "translation_checkpoint_dropped session_id=sess segment_id=seg_old rev=3 "
                "status=stable reason=committed_backlog committed_segment_id=seg_new "
                "committed_rev=4 pending_checkpoints=1"
            ),
            (
                "caption_event_published type=caption_update session_id=sess segment_id=seg "
                "translation_queue_wait_ms=12.0 translation_first_token_ms=140.0 "
                "translation_latency_ms=210.0 prompt_cache_hit_tokens=80.0 "
                "prompt_cache_miss_tokens=20.0 deepseek_stream_open_ms=35.0 "
                "deepseek_first_delta_ms=105.0 deepseek_delta_count=4.0 "
                "deepseek_prompt_chars=720.0 deepseek_prefix_chars=18.0 "
                "glossary_required_terms=2.0 glossary_missing_required_terms=1.0 "
                "glossary_repaired_required_terms=1.0 "
                "semantic_revision_latency_ms=860.0 "
                "semantic_revision_changed_chars=12.0 simul_policy_action=1.0"
            ),
            (
                "audio_stream_metrics session_id=sess trace_id=sess frames=12 audio_ms=960 "
                "bytes=30720 avg_transport_ms=4.0 p95_transport_ms=8.0 "
                "avg_asr_queue_wait_ms=2.0 p95_asr_queue_wait_ms=5.0 "
                "max_queue_depth=1 queue_depth=0"
            ),
            (
                "funasr_inference_chunk session_id=sess start_ms=0 end_ms=600 "
                "input_audio_ms=600 transport_frames=7 final=False "
                "semantic_boundary=none latency_ms=93 rtf=0.155 text_chars=12"
            ),
            (
                "tts_synthesis_started session_id=sess segment_id=seg rev=1 "
                "target_chars=8 tts_provider=ElevenLabsTtsSynthesizer "
                "tts_queue_wait_ms=42.0"
            ),
            (
                "tts_synthesis_first_audio session_id=sess segment_id=seg rev=1 "
                "first_audio_ms=180.0 audio_bytes=4096 target_chars=8 "
                "tts_provider=ElevenLabsTtsSynthesizer"
            ),
            (
                "tts_synthesis_finished session_id=sess segment_id=seg rev=1 "
                "total_ms=380.0 first_audio_ms=180.0 audio_chunks=3 "
                "audio_bytes=12288 target_chars=8 tts_provider=ElevenLabsTtsSynthesizer"
            ),
            "tts_synthesis_failed session_id=sess segment_id=seg_err rev=1",
        ]
    )

    assert summary.lines == 12
    assert summary.translation_started == 1
    assert summary.translation_finished == 1
    assert summary.translation_skipped == 1
    assert summary.translation_dropped == 1
    assert summary.translation_skip_ratio == 0.5
    assert summary.simul_wait == 1
    assert summary.skipped_reasons["simul_wait"] == 1
    assert summary.dropped_reasons["committed_backlog"] == 1
    assert summary.simul_actions["SimulPolicyAction.DRAFT"] == 1
    assert summary.caption_events["caption_update"] == 1
    assert summary.queue_wait_ms == [12.0]
    assert summary.first_token_ms == [140.0]
    assert summary.translation_latency_ms == [210.0]
    assert summary.prompt_cache_hit_tokens == [80.0]
    assert summary.prompt_cache_miss_tokens == [20.0]
    assert summary.deepseek_stream_open_ms == [35.0]
    assert summary.deepseek_first_delta_ms == [105.0]
    assert summary.deepseek_delta_count == [4.0]
    assert summary.deepseek_prompt_chars == [720.0]
    assert summary.deepseek_prefix_chars == [18.0]
    assert summary.glossary_required_terms == [2.0]
    assert summary.glossary_missing_required_terms == [1.0]
    assert summary.glossary_repaired_required_terms == [1.0]
    assert summary.semantic_revision_latency_ms == [860.0]
    assert summary.semantic_revision_changed_chars == [12.0]
    assert summary.avg_audio_transport_ms == [4.0]
    assert summary.p95_audio_transport_ms == [8.0]
    assert summary.avg_asr_queue_wait_ms == [2.0]
    assert summary.p95_asr_queue_wait_ms == [5.0]
    assert summary.funasr_latency_ms == [93.0]
    assert summary.funasr_rtf == [0.155]
    assert summary.tts_started == 1
    assert summary.tts_finished == 1
    assert summary.tts_failed == 1
    assert summary.tts_first_audio_ms == [180.0]
    assert summary.tts_queue_wait_ms == [42.0]
    assert summary.tts_total_ms == [380.0]
    assert summary.tts_audio_chunks == [3.0]
    assert summary.tts_audio_bytes == [12288.0]


def test_realtime_log_summary_formats_empty_counters() -> None:
    output = format_summary(summarize_log_lines([]))

    assert "translation_started=0" in output
    assert "skipped_reasons=-" in output
    assert "dropped_reasons=-" in output
    assert "translation_first_token_ms=n:0" in output
    assert "prompt_cache_hit_tokens=n:0" in output
    assert "glossary_required_total=0" in output
    assert "tts_started=0 tts_finished=0 tts_failed=0" in output


def test_realtime_log_summary_formats_deepseek_and_glossary_metrics() -> None:
    output = format_summary(
        summarize_log_lines(
            [
                (
                    "caption_event_published type=caption_update session_id=sess "
                    "segment_id=seg prompt_cache_hit_tokens=80.0 "
                    "prompt_cache_miss_tokens=20.0 deepseek_stream_open_ms=35.0 "
                    "deepseek_first_delta_ms=105.0 deepseek_delta_count=4.0 "
                    "deepseek_prompt_chars=720.0 deepseek_prefix_chars=18.0 "
                    "glossary_required_terms=2.0 "
                    "glossary_missing_required_terms=1.0 "
                    "glossary_repaired_required_terms=1.0 "
                    "semantic_revision_latency_ms=860.0 "
                    "semantic_revision_changed_chars=12.0"
                ),
                (
                    "caption_event_published type=caption_update session_id=sess "
                    "segment_id=seg2 prompt_cache_hit_tokens=120.0 "
                    "prompt_cache_miss_tokens=8.0 glossary_required_terms=1.0 "
                    "glossary_missing_required_terms=0.0 "
                    "glossary_repaired_required_terms=1.0"
                ),
            ]
        )
    )

    assert "prompt_cache_hit_tokens=n:2 avg:100.0" in output
    assert "deepseek_stream_open_ms=n:1 avg:35.0" in output
    assert "glossary_missing_required_terms=n:2 avg:0.5" in output
    assert "glossary_required_total=3" in output
    assert "glossary_missing_required_total=1" in output
    assert "glossary_repaired_required_total=2" in output
    assert "semantic_revision_latency_ms=n:1 avg:860.0" in output
    assert "semantic_revision_changed_chars=n:1 avg:12.0" in output
