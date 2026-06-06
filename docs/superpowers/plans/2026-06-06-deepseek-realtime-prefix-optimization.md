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
- Surface DeepSeek cache metrics through `caption_update`, not only legacy `translation.partial`.
- Compare live logs before and after this change: `translation_first_token_ms`, `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, and segment source length.
- Keep prefix completion conservative: use it for append-only current segment revisions, and continue falling back to full `/v1` translation when ASR rewrites the source prefix.
