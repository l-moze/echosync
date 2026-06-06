# Caption Update Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish backend-owned `caption_update` events alongside the existing legacy caption stream.

**Architecture:** Keep `transcript.partial`, `translation.partial`, `translation.patch`, and `segment.commit` unchanged for Desktop compatibility. `EventSubtitleSink` will publish a derived `caption_update` immediately after every transcript/translation snapshot and final commit, and runtime assembly will subscribe websocket forwarding to the new event type.

**Tech Stack:** Python 3.11, pytest, in-memory event bus, FastAPI websocket contract tests.

---

## Task 1: Event Sink Publication

**Files:**
- Modify: `apps/agent/src/echosync_agent/services/subtitle/event_sink.py`
- Test: `apps/agent/tests/test_pipeline_contracts.py`

- [x] **Step 1: Write failing pipeline event-order test**

Update `test_pipeline_emits_translation_and_commit_events()` so the expected event sequence keeps every legacy event and includes `caption_update` immediately after each snapshot/commit:

```python
assert event_types == [
    "transcript.partial",
    "caption_update",
    "translation.partial",
    "caption_update",
    "translation.partial",
    "caption_update",
    "segment.commit",
    "caption_update",
]
```

Assert the first `caption_update` has no `target` and nested `source.full_text`. For mock pipeline snapshots it may be `stable`, because `TranslationSegment(status=committed)` intentionally stays non-final until the separate `SegmentCommit` arrives. Assert the last update has `state == "final"` and nested target text.

- [x] **Step 2: Verify RED**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests\test_pipeline_contracts.py::test_pipeline_emits_translation_and_commit_events -q`

Expected: fail because `caption_update` is not published by the event sink yet.

- [x] **Step 3: Implement event sink publication**

Import `caption_update_from_translation` and `caption_update_from_commit`. In `publish_translation()`, publish the legacy event first, then publish `"caption_update"` with the adapter payload. In `publish_commit()`, publish `"segment.commit"` first, then publish `"caption_update"`.

- [x] **Step 4: Verify GREEN**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests\test_pipeline_contracts.py::test_pipeline_emits_translation_and_commit_events -q`

Expected: pass.

## Task 2: WebSocket Forwarding

**Files:**
- Modify: `apps/agent/src/echosync_agent/runtime/assembly.py`
- Test: `apps/agent/tests/test_realtime_caption_websocket_contracts.py`

- [x] **Step 1: Write failing websocket contract**

Update `test_realtime_websocket_publishes_translated_captions_to_caption_clients()` to read through the final `caption_update` instead of assuming a fixed four-event legacy stream. Assert `caption_update` is present, that the first update uses the same `segment_id` as the first transcript partial, and that the final update is `state == "final"`.

- [x] **Step 2: Verify RED**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests\test_realtime_caption_websocket_contracts.py::test_realtime_websocket_publishes_translated_captions_to_caption_clients -q`

Expected: fail because `_subscribe_caption_pusher()` is not subscribed to `caption_update`.

- [x] **Step 3: Subscribe forwarding**

Add `"caption_update"` to `_subscribe_caption_pusher()` after `"translation.partial"` and before `"translation.patch"`.

- [x] **Step 4: Verify GREEN**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests\test_realtime_caption_websocket_contracts.py::test_realtime_websocket_publishes_translated_captions_to_caption_clients -q`

Expected: pass.

## Final Verification

- [x] Run `..\..\.venv\Scripts\python.exe -m pytest tests\test_caption_update_contracts.py tests\test_pipeline_contracts.py tests\test_realtime_caption_websocket_contracts.py -q`
- [x] Run `npm test -- caption-store.test.ts caption-display-buffer.test.ts`
- [x] Run `npm run typecheck`
- [x] Commit only this publication slice.

Note: `TranslationSegment(status=committed)` is intentionally mapped to `caption_update.state = "stable"`; only `SegmentCommit` produces `state = "final"` so frontend renderers do not lock a segment before the backend commit event.
