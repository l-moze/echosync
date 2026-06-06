# Backend Caption Lifecycle Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backend-owned caption lifecycle metadata while keeping frontend visual diff/typewriter behavior separate.

**Architecture:** The Agent will compute stable/unstable text regions on full source/target snapshots and keep existing event names for compatibility. The ASR assembler will treat explicit endpoint final metrics as segment commit evidence, while translation prompts receive current-segment revision history without moving animation diffing to Python.

**Tech Stack:** Python 3.11 dataclasses and pytest for Agent behavior; TypeScript event types for Desktop contract alignment.

---

## File Structure

- Create `apps/agent/src/echosync_agent/services/realtime/text_regions.py` for stable/unstable text splitting.
- Create `apps/agent/tests/test_caption_text_regions.py` for region helper contracts.
- Modify `apps/agent/src/echosync_agent/domain/events.py` to add optional region fields and current-segment revision context.
- Modify `apps/agent/src/echosync_agent/services/asr/transcript_assembler.py` to populate source regions and commit on endpoint-final evidence.
- Modify `apps/agent/src/echosync_agent/services/engine/cascaded_engine.py` to pass current-segment revision context and populate source-only region fields.
- Modify `apps/agent/src/echosync_agent/services/translation/deepseek_translator.py` so DeepSeek prompt includes current-segment revision context; target region fields are normalized centrally by the engine.
- Modify `apps/desktop/src/shared/realtime-events.ts` to expose optional stable/unstable event fields.
- Add focused tests in existing Agent test files only where the behavior belongs.

## Task 1: Stable/Unstable Text Regions

**Files:**
- Create: `apps/agent/src/echosync_agent/services/realtime/text_regions.py`
- Test: `apps/agent/tests/test_caption_text_regions.py`

- [x] **Step 1: Write failing tests**

Add tests for committed text, English provisional tail splitting, CJK provisional tail splitting, and punctuation-boundary stability.

- [x] **Step 2: Run tests and verify failure**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests\test_caption_text_regions.py -q`
Expected: fail because `text_regions.py` does not exist.

- [x] **Step 3: Implement text region helper**

Create `TextRegions` and `split_realtime_text(text, status, language)` with deterministic MVP rules:
committed or punctuation-ended text is fully stable; CJK provisional text keeps the last six characters unstable; Latin provisional text keeps the last three tokens unstable.

- [x] **Step 4: Verify tests pass**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests\test_caption_text_regions.py -q`
Expected: all tests pass.

## Task 2: Domain Events and ASR Lifecycle

**Files:**
- Modify: `apps/agent/src/echosync_agent/domain/events.py`
- Modify: `apps/agent/src/echosync_agent/services/asr/transcript_assembler.py`
- Test: `apps/agent/tests/test_transcript_assembler_contracts.py`

- [x] **Step 1: Write failing tests**

Add tests that assembled transcript segments expose `stable_text`/`unstable_text`, and that an ASR `COMMITTED` segment with metric `asr_endpoint_final=1.0` commits the current EchoSync segment even without sentence punctuation.

- [x] **Step 2: Run tests and verify failure**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests\test_transcript_assembler_contracts.py -q`
Expected: fail because fields and endpoint-final commit behavior are missing.

- [x] **Step 3: Implement domain fields and assembler wiring**

Add default region fields to `TranscriptSegment`, `TranslationSegment`, and `SegmentCommit`. Use `split_realtime_text()` inside `_build_segment()`. Add `_should_endpoint_commit()` that only returns true when the upstream segment is `COMMITTED` and `metrics["asr_endpoint_final"] >= 1.0`.

- [x] **Step 4: Verify tests pass**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests\test_transcript_assembler_contracts.py -q`
Expected: all tests pass.

## Task 3: Translation Regions and Current-Segment Context

**Files:**
- Modify: `apps/agent/src/echosync_agent/services/engine/cascaded_engine.py`
- Modify: `apps/agent/src/echosync_agent/services/translation/deepseek_translator.py`
- Test: `apps/agent/tests/test_deepseek_translator_contracts.py`
- Test: `apps/agent/tests/test_cascaded_latency_contracts.py`

- [x] **Step 1: Write failing tests**

Add tests that DeepSeek prompt construction includes current-segment previous source/target context, and that translation events include source/target stable/unstable fields.

- [x] **Step 2: Run tests and verify failure**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests\test_deepseek_translator_contracts.py tests\test_cascaded_latency_contracts.py -q`
Expected: fail because current-segment context and target region fields are missing.

- [x] **Step 3: Implement context and translation region fields**

Add `current_segment_revisions` to `CorrectionContext`. Keep a small per-segment revision history in `CascadedInterpretationEngine`, pass it into context, and append stable/committed final translations after each checkpoint. Populate source and target region fields centrally in engine-normalized translation segments.

- [x] **Step 4: Verify tests pass**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests\test_deepseek_translator_contracts.py tests\test_cascaded_latency_contracts.py -q`
Expected: all tests pass.

## Task 4: Desktop Type Alignment and Documentation Status

**Files:**
- Modify: `apps/desktop/src/shared/realtime-events.ts`
- Modify: `docs/superpowers/plans/2026-06-06-backend-caption-lifecycle-protocol.md`

- [x] **Step 1: Add TypeScript optional fields**

Add optional stable/unstable source and target fields to `CaptionTextEvent` and `SubtitleCommitEvent`.

- [x] **Step 2: Run focused frontend type/test check**

Run: `npm test -- caption-store.test.ts caption-display-buffer.test.ts`
Expected: existing frontend behavior remains unchanged.

- [x] **Step 3: Mark plan tasks complete as implementation lands**

Update this plan’s checkboxes to match the actual completed state.

## Final Verification

- [x] Run Agent focused tests:
  `..\..\.venv\Scripts\python.exe -m pytest tests\test_caption_text_regions.py tests\test_transcript_assembler_contracts.py tests\test_deepseek_translator_contracts.py tests\test_cascaded_latency_contracts.py -q`
- [x] Run Desktop focused tests:
  `npm test -- caption-store.test.ts caption-display-buffer.test.ts`
- [x] Review scoped `git diff --stat`; this turn's tracked edits are limited to backend lifecycle, translation context, event typing, tests, and docs. The overall worktree still contains pre-existing unrelated local changes.
