# Realtime Telemetry Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a consistent realtime telemetry chain to caption events, including the new `caption_update` protocol.

**Architecture:** Backend metrics remain attached to domain events and websocket payloads. `caption_update` becomes telemetry-equivalent to legacy events, while Desktop only extends telemetry extraction and event typing; rendering behavior remains unchanged.

**Tech Stack:** Python 3.11 dataclasses and pytest for Agent contracts; TypeScript/Vitest for Desktop telemetry types.

---

## File Structure

- Modify `apps/agent/src/echosync_agent/domain/events.py` so `SegmentCommit` can carry `metrics`.
- Modify `apps/agent/src/echosync_agent/services/subtitle/caption_update.py` so `caption_update` includes optional `metrics`.
- Modify `apps/agent/src/echosync_agent/services/asr/transcript_assembler.py` so transcript metrics include `asr_first_delta_ms` and `checkpoint_created_at_ms`.
- Modify `apps/agent/src/echosync_agent/services/engine/cascaded_engine.py` so final commits preserve translation metrics.
- Modify `apps/desktop/src/shared/realtime-events.ts` so `CaptionUpdateEvent` and `SubtitleCommitEvent` can carry metrics.
- Modify `apps/desktop/src/shared/realtime-telemetry.ts` so telemetry extraction includes new metric names.
- Add/extend focused tests in existing Agent and Desktop test files.

## Task 1: Caption Update Metrics Parity

**Files:**
- Modify: `apps/agent/src/echosync_agent/domain/events.py`
- Modify: `apps/agent/src/echosync_agent/services/subtitle/caption_update.py`
- Test: `apps/agent/tests/test_caption_update_contracts.py`

- [ ] **Step 1: Write failing tests**

Add assertions to `test_caption_update_from_translated_segment_includes_target_regions()`:

```python
event = caption_update_from_translation(
    TranslationSegment(
        ...,
        metrics={
            "asr_latency_ms": 84.0,
            "merge_wait_ms": 12.0,
            "translation_first_token_ms": 140.0,
        },
    )
)

assert event["metrics"] == {
    "asr_latency_ms": 84.0,
    "merge_wait_ms": 12.0,
    "translation_first_token_ms": 140.0,
}
```

Add a commit projection assertion:

```python
event = caption_update_from_commit(
    SegmentCommit(
        ...,
        metrics={"translation_latency_ms": 220.0},
    )
)

assert event["metrics"]["translation_latency_ms"] == 220.0
```

- [ ] **Step 2: Verify RED**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests\test_caption_update_contracts.py -q`

Expected: fail because `SegmentCommit` has no `metrics` field and `caption_update` omits metrics.

- [ ] **Step 3: Implement metrics passthrough**

Add `metrics: dict[str, float] = field(default_factory=dict)` to `SegmentCommit`.

In `caption_update_from_translation()`:

```python
if segment.metrics:
    event["metrics"] = dict(segment.metrics)
```

In `caption_update_from_commit()`:

```python
if commit.metrics:
    event["metrics"] = dict(commit.metrics)
```

- [ ] **Step 4: Verify GREEN**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests\test_caption_update_contracts.py -q`

Expected: all caption update contract tests pass.

## Task 2: ASR and Checkpoint Metric Normalization

**Files:**
- Modify: `apps/agent/src/echosync_agent/services/asr/transcript_assembler.py`
- Modify: `apps/agent/src/echosync_agent/services/engine/cascaded_engine.py`
- Test: `apps/agent/tests/test_transcript_assembler_contracts.py`
- Test: `apps/agent/tests/test_cascaded_latency_contracts.py`

- [ ] **Step 1: Write failing tests**

In `apps/agent/tests/test_transcript_assembler_contracts.py`, add a test proving assembled checkpoints include normalized metrics:

```python
async def source():
    yield TranscriptSegment(
        session_id="sess_metrics",
        segment_id="raw_1",
        rev=1,
        start_ms=0,
        end_ms=500,
        source_lang="en",
        text="Hello",
        status=SegmentStatus.PARTIAL,
        stability=0.5,
        metrics={"asr_latency_ms": 70.0},
    )
    yield TranscriptSegment(
        session_id="sess_metrics",
        segment_id="raw_1",
        rev=2,
        start_ms=500,
        end_ms=1000,
        source_lang="en",
        text=" world.",
        status=SegmentStatus.COMMITTED,
        stability=1.0,
        metrics={"asr_latency_ms": 110.0, "asr_endpoint_final": 1.0},
    )

segments = [segment async for segment in TranscriptAssembler().stream(source())]
committed = segments[-1]

assert committed.metrics["asr_first_delta_ms"] == 70.0
assert committed.metrics["merge_wait_ms"] >= 0
assert committed.metrics["checkpoint_created_at_ms"] > 0
```

In `apps/agent/tests/test_cascaded_latency_contracts.py`, extend the final commit assertion:

```python
commit = next(event for event in events if isinstance(event, SegmentCommit))
assert commit.metrics["translation_latency_ms"] >= 0
assert commit.metrics["translation_first_token_ms"] >= 0
```

- [ ] **Step 2: Verify RED**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests\test_transcript_assembler_contracts.py tests\test_cascaded_latency_contracts.py -q`

Expected: fail because `asr_first_delta_ms`, `checkpoint_created_at_ms`, and commit metrics are missing.

- [ ] **Step 3: Implement normalized metrics**

In `TranscriptAssembler.stream()`, keep `first_delta_metrics: dict[str, float] | None` for the current segment. Set it when `first is None`.

In `_build_segment()`, add:

```python
metrics.setdefault("asr_first_delta_ms", float(first.metrics.get("asr_latency_ms", 0.0)))
metrics["checkpoint_created_at_ms"] = float(int(time.time() * 1000))
```

In `CascadedInterpretationEngine`, when building `SegmentCommit`, pass `metrics=dict(final_translation.metrics)`.

- [ ] **Step 4: Verify GREEN**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests\test_transcript_assembler_contracts.py tests\test_cascaded_latency_contracts.py -q`

Expected: all tests pass.

## Task 3: Desktop Telemetry Type Alignment

**Files:**
- Modify: `apps/desktop/src/shared/realtime-events.ts`
- Modify: `apps/desktop/src/shared/realtime-telemetry.ts`
- Test: `apps/desktop/tests/realtime-telemetry.test.ts`

- [ ] **Step 1: Write failing telemetry tests**

Add a `caption_update` telemetry test:

```ts
const telemetry = buildRealtimeEventTelemetry(
  {
    type: "caption_update",
    session_id: "sess_trace",
    segment_id: "seg_trace",
    revision: 4,
    state: "stable",
    source: { full_text: "Hello world", language: "en" },
    target: { full_text: "你好世界", language: "zh-CN" },
    timing: { start_ms: 0, end_ms: 1200 },
    published_at_ms: 2000,
    metrics: {
      asr_first_delta_ms: 70,
      checkpoint_created_at_ms: 1800,
      translation_delta_count: 3
    }
  },
  2075
);

expect(telemetry).toMatchObject({
  type: "caption_update",
  agentToRendererMs: 75,
  asrFirstDeltaMs: 70,
  checkpointCreatedAtMs: 1800,
  translationDeltaCount: 3,
  sourcePreview: "Hello world",
  targetPreview: "你好世界"
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- realtime-telemetry.test.ts`
Run: `npm run typecheck`

Expected: fail because `CaptionUpdateEvent` has no `metrics` field and telemetry extraction does not expose the new derived names.

- [ ] **Step 3: Implement TypeScript alignment**

Add a reusable metrics type in `apps/desktop/src/shared/realtime-events.ts`:

```ts
export type RealtimeEventMetrics = {
  asr_latency_ms?: number;
  asr_first_delta_ms?: number;
  asr_rtf?: number;
  merge_wait_ms?: number;
  checkpoint_created_at_ms?: number;
  translation_request_started_ms?: number;
  translation_first_token_ms?: number;
  translation_latency_ms?: number;
  translation_delta_count?: number;
};
```

Use it on `CaptionTextEvent`, `SubtitleCommitEvent`, and `CaptionUpdateEvent`.

Extend `RealtimeEventTelemetry` and `buildRealtimeEventTelemetry()` with:

```ts
asrFirstDeltaMs: metrics?.asr_first_delta_ms,
checkpointCreatedAtMs: metrics?.checkpoint_created_at_ms,
translationRequestStartedMs: metrics?.translation_request_started_ms,
translationDeltaCount: metrics?.translation_delta_count
```

Use `caption_update.source.full_text`, `target.full_text`, and `timing` for previews and time windows.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- realtime-telemetry.test.ts`
Run: `npm run typecheck`

Expected: telemetry tests and Desktop typecheck pass.

## Final Verification

- [ ] Run `..\..\.venv\Scripts\python.exe -m pytest tests\test_caption_update_contracts.py tests\test_transcript_assembler_contracts.py tests\test_cascaded_latency_contracts.py tests\test_pipeline_contracts.py tests\test_realtime_caption_websocket_contracts.py -q`
- [ ] Run `npm test -- realtime-telemetry.test.ts caption-store.test.ts caption-display-buffer.test.ts`
- [ ] Run `npm run typecheck`
- [ ] Commit only this telemetry slice.
