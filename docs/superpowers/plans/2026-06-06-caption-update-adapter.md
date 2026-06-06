# Caption Update Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backend `caption_update` payload adapter that projects existing transcript/translation/commit domain events into the target nested protocol without breaking the legacy event stream.

**Architecture:** Keep current event emission unchanged for Desktop compatibility. Add a pure adapter module with deterministic mapping from `TranslationSegment` and `SegmentCommit` into a nested `caption_update` dictionary that includes source/target full/stable/unstable text and timing.

**Tech Stack:** Python 3.11 dataclasses, pytest, TypeScript event contracts.

---

## Task 1: Backend Adapter

**Files:**
- Create: `apps/agent/src/echosync_agent/services/subtitle/caption_update.py`
- Test: `apps/agent/tests/test_caption_update_contracts.py`

- [x] **Step 1: Write failing tests**

Add tests for source-only transcript update, translated update, and final commit projection.

- [x] **Step 2: Run tests and verify failure**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests\test_caption_update_contracts.py -q`
Expected: fail because the adapter module does not exist.

- [x] **Step 3: Implement adapter**

Create `caption_update_from_translation()` and `caption_update_from_commit()` returning nested payloads with `type`, `segment_id`, `revision`, `state`, `source`, optional `target`, and `timing`.

- [x] **Step 4: Verify tests pass**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests\test_caption_update_contracts.py -q`
Expected: all tests pass.

## Task 2: Desktop Type Contract

**Files:**
- Modify: `apps/desktop/src/shared/realtime-events.ts`

- [x] **Step 1: Add `CaptionUpdateEvent` type**

Add a discriminated union member for `type: "caption_update"` without changing store behavior.

- [x] **Step 2: Verify frontend tests/typecheck**

Run: `npm test -- caption-store.test.ts caption-display-buffer.test.ts`
Run: `npm run typecheck`
Expected: all pass.

## Final Verification

- [x] Run backend adapter tests.
- [x] Run Desktop focused tests and typecheck.
- [x] Commit only this adapter slice.

Note: Desktop typecheck was blocked by an already-dirty TTS provider workspace gap. A minimal TTS startup/preflight/playback type fix was verified separately so this adapter slice can be checked without changing caption store behavior.
