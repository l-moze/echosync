# DeepSeek Realtime Prefix Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce DeepSeek realtime translation latency by reusing clients, disabling thinking, enabling usage telemetry, and using prefix completion for append-only current-segment revisions.

**Architecture:** Keep the existing cascaded pipeline and translator interface. `DeepSeekTranslator` owns provider-specific request shaping: normal streaming uses the configured `/v1` base URL, while append-only current segment revisions use DeepSeek `/beta` prefix completion with the previous target text as an assistant prefix. Non-append revisions fall back to normal full streaming translation to avoid locking in stale ASR text.

**Tech Stack:** Python 3.12, pytest, OpenAI-compatible DeepSeek Chat Completion API.

**DeepSeek API Notes:**

- Chat completion requests remain stateless from EchoSync's perspective; repeated context must still be sent by the caller.
- Context caching is provider-side and automatic. EchoSync can only improve hit rate by keeping stable prompt prefixes before dynamic source text and by recording `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`.
- Chat prefix completion requires the DeepSeek beta base URL and a final `assistant` message with `prefix: true`; this is only used for append-only current segment revisions.

---

## Status 2026-06-06

- [x] Added focused DeepSeek translator contract tests.
- [x] Verified RED state: new tests failed because `DeepSeekTranslator` did not accept `client_factory`.
- [x] Implemented reusable OpenAI-compatible client cache per base URL.
- [x] Added `extra_body={"thinking": {"type": "disabled"}}` to batch and streaming translation requests.
- [x] Added `stream_options={"include_usage": True}` to streaming translation requests.
- [x] Captured `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens` into `TranslationSegment.metrics`.
- [x] Added append-only source revision detection and DeepSeek `/beta` prefix completion.
- [x] Kept rewritten source revisions on the normal streaming path.
- [x] Real API smoke test exposed late stream usage chunks; final streaming snapshots now publish updated metrics even when final text is unchanged.

## Status 2026-06-07

- [x] Tightened the system prompt so live captions stay compact without summarizing or dropping semantic head nouns such as tasks, methods, demonstrations, datasets, models, and reasoning types.
- [x] Kept DeepSeek requests stateless from EchoSync's perspective, but strengthened every request with recent committed context, current-segment revisions, and matched terminology.
- [x] Prioritized terminology matches from the current segment before supplementing with the prefix window, so high-priority history terms cannot crowd out terms that appear in the active source text.
- [x] Added zero-extra-request repair for required glossary terms when DeepSeek copies the source term verbatim in the target output. Safe repairs run before streaming publish and before batch return.
- [x] Added glossary metrics: `glossary_required_terms`, `glossary_missing_required_terms`, and `glossary_repaired_required_terms`.
- [x] Aligned batch and streaming glossary telemetry so missing-term logs are based on the repaired final text.
- [x] Fixed current-segment revision patches by letting `RevisionWindowCorrectionEngine` compare against `context.current_segment_revisions`, not only committed history.
- [x] Added a default `120ms` correction timeout so slow revision logic cannot indefinitely block committed subtitles.
- [x] Surfaced DeepSeek cache/stream and glossary metrics through `caption_update` metrics, `caption_event_published` logs, and `realtime_log_summary` distributions/totals.

## Fast vs Slow Path Boundary

Fast path:

- `partial` transcript events continue to publish source hypotheses only; they do not call DeepSeek by default.
- `stable` and `committed` checkpoints call DeepSeek once through the latest-wins queue. Streaming deltas are published according to the local text emission policy.
- Append-only current-segment revisions may use DeepSeek `/beta` prefix completion with the previous target as an assistant prefix. Rewritten source revisions, unchanged revisions, and open-source tails with already closed target translations fall back to normal `/v1` streaming.
- Required glossary source-copy repair is local string repair after DeepSeek output and before publish. It does not add another model request.
- Current-segment terminology is matched first, then recent committed prefix terms supplement the context up to the term cap.

Slow path:

- `RevisionWindowCorrectionEngine` can emit `SubtitlePatch` for current-segment translation revisions after a final stable/committed translation snapshot.
- Correction is timeout-bounded by `correction_timeout_ms` (`120ms` by default). If it times out, the pipeline logs `translation_revision_timeout` and proceeds without a patch.
- Required glossary omissions that are not safely repairable are reported through metrics instead of triggering an extra LLM retry on the hot path.
- A full LLM structured revision manager remains future work and must stay off the first-token path unless it is bounded or asynchronous.

## Verification

Focused translator contracts:

```powershell
python -m pytest apps/agent/tests/test_deepseek_translator_contracts.py -q
```

Result:

```text
8 passed in 0.10s
```

Related backend regression:

```powershell
python -m pytest apps/agent/tests/test_deepseek_translator_contracts.py apps/agent/tests/test_cascaded_latency_contracts.py apps/agent/tests/test_pipeline_contracts.py apps/agent/tests/test_caption_update_contracts.py apps/agent/tests/test_terminology.py -q
```

Result:

```text
68 passed in 0.76s
```

2026-06-07 focused regression after context/terminology/revision changes:

```powershell
python -m pytest apps/agent/tests/test_deepseek_translator_contracts.py apps/agent/tests/test_cascaded_latency_contracts.py apps/agent/tests/test_terminology.py apps/agent/tests/test_pipeline_contracts.py apps/agent/tests/test_caption_update_contracts.py -q
```

Result:

```text
81 passed in 0.59s
```

Full Agent test suite:

```powershell
$env:PYTHONPATH='apps/agent/src'; pytest apps/agent/tests -q
```

Result:

```text
186 passed in 1.43s
```

Audit verification before commit also covered Desktop and Web integration:

```powershell
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop test -- --run
npm --prefix apps/desktop run build
npm --prefix apps/web run build
```

Result: all passed.

## Real API Smoke Test 2026-06-06

Environment: local `.env`, `DEEPSEEK_BASE_URL=https://api.deepseek.com/v1`, `DEEPSEEK_MODEL=deepseek-v4-flash`.

Results from direct `DeepSeekTranslator.stream_translate()` calls against the real DeepSeek API:

| Case | Route | First publish | Total | Cache metrics | Result |
| --- | --- | ---: | ---: | --- | --- |
| Normal stable meeting caption | `/v1` | 2015.7ms | 2152.8ms | hit=128, miss=66 | Good meeting-caption translation; required glossary terms preserved. |
| Clean append-only revision | `/beta` prefix completion | 1111.9ms | 1288.1ms | hit=128, miss=87 | Good continuation: `先保持功能开关关闭，直到演示结束。` |
| Same clean text without prefix | `/v1` | 1281.4ms | 1380.3ms | hit=128, miss=41 | Also correct, but first publish was slower than prefix completion in this run. |
| Rewritten source revision | `/v1` fallback | 1488.9ms | 1691.2ms | hit=128, miss=60 | Correctly avoided prefix completion and translated the rewritten source. |
| Ambiguous append-only sentence | `/beta` and `/v1` A/B | 1699.5ms vs 1311.5ms | 1912.2ms vs 1435.3ms | hit=0 in isolated A/B | Both routes inherited the English ambiguity around `after ... before ...`; not a prefix-only failure. |

Finding: DeepSeek returns stream usage in a final chunk with empty `choices`. The translator now emits a final metrics-only snapshot when usage arrives after the last text snapshot, so `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` are visible to downstream telemetry.

## Remaining Follow-Up

- Fix Voxtral segment timing so realtime text deltas do not carry session-long `start_ms` / `end_ms` windows.
- Compare live logs before and after this change: `translation_first_token_ms`, `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, and segment source length.
- Keep prefix completion conservative: use it for append-only current segment revisions, and continue falling back to full `/v1` translation when ASR rewrites the source prefix.
- Implement real TermQuickAdd backend sync; the current runtime glossary injection works, but the frontend quick-add panel still does not update the Agent glossary live.
- Decide whether non-repairable required glossary misses should feed a slow diagnostics/review lane. They must not add an automatic retry to the realtime first-token path.
- Persist per-session diagnostics JSONL so the new log-summary metrics are attached to saved meeting records.
