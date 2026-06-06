# Realtime Translation Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first maintainable layer for low-latency readable streaming subtitles: source hypotheses update the current caption line immediately, translation output is coalesced at the Agent side, and the frontend renders received snapshots without extra semantic buffering.

**Architecture:** Keep EchoSync's cascaded pipeline. `TranscriptAssembler` owns source hypothesis assembly and stable/commit checkpoints; `TextEmissionPolicy` owns target translation flush decisions; `CascadedInterpretationEngine` schedules stable and committed translation checkpoints separately; desktop store/display buffer preserve and render received events immediately. This task does not change the event protocol.

**Tech Stack:** Python 3.11, pytest, existing EchoSync Agent dataclasses and async stream contracts.

---

## Status 2026-06-06

- Agent Tasks 1-4 已完成并通过全量 Agent 测试：`128 passed, 1 warning`。
- Desktop Task 5 已完成“即时 snapshot 显示”“过期 patch / locked late partial 防护”和“committed partial 不提前锁行”，并通过 focused Vitest 与 typecheck。
- P0 语义缺口已修复：`translation.partial(status=committed)` 不再映射为 `locked`；真正锁定只由 `segment.commit` 触发，因此 `segment.commit` 前的合法 `translation.patch` 仍可生效。
- LocalAgreement buffer 和完整 LLM revision manager 仍是后续阶段，不属于本轮已完成范围。

### Task 1: Central Text Emission Policy

**Files:**
- Create: `apps/agent/src/echosync_agent/services/realtime/__init__.py`
- Create: `apps/agent/src/echosync_agent/services/realtime/text_emission_policy.py`
- Test: `apps/agent/tests/test_text_emission_policy.py`

- [x] **Step 1: Write failing tests**

```python
from echosync_agent.services.realtime.text_emission_policy import TextEmissionPolicy


def test_policy_does_not_hold_cjk_source_partial() -> None:
    policy = TextEmissionPolicy(source_cjk_min_chars=4)

    assert policy.should_hold_source_partial(current_text="你", last_emitted_text="") is False
    assert policy.should_hold_source_partial(current_text="你好世", last_emitted_text="") is False
    assert policy.should_hold_source_partial(current_text="你好世界", last_emitted_text="") is False


def test_policy_does_not_hold_latin_source_partial() -> None:
    policy = TextEmissionPolicy(source_cjk_min_chars=4)

    assert policy.should_hold_source_partial(current_text="Hello", last_emitted_text="") is False
    assert policy.should_hold_source_partial(current_text="Hello world", last_emitted_text="Hello") is False


def test_policy_flushes_target_on_readable_chunks_punctuation_final_and_rewrite() -> None:
    policy = TextEmissionPolicy(target_min_initial_chars=6, target_min_delta_chars=6)

    assert policy.should_emit_target(previous_text="", next_text="大") is False
    assert policy.should_emit_target(previous_text="", next_text="大家好欢迎大家") is True
    assert policy.should_emit_target(previous_text="大家好", next_text="大家好呀") is False
    assert policy.should_emit_target(previous_text="大家好", next_text="大家好呀。") is True
    assert policy.should_emit_target(previous_text="旧译文", next_text="新") is True
    assert policy.should_emit_target(previous_text="大家好", next_text="大家好呀", is_final=True) is True
```

- [x] **Step 2: Run tests and verify failure**

Run:

```bash
cd apps/agent
python -m pytest tests/test_text_emission_policy.py -q
```

Expected: fail because `echosync_agent.services.realtime.text_emission_policy` does not exist.

- [x] **Step 3: Implement policy**

Create `TextEmissionPolicy` with:

- `should_hold_source_partial(current_text, last_emitted_text, is_final=False)`
- `should_emit_target(previous_text, next_text, is_final=False)`
- display character counting that ignores whitespace
- source partial hold only for empty or duplicate text
- punctuation-triggered flush

- [x] **Step 4: Run tests and verify pass**

Run:

```bash
cd apps/agent
python -m pytest tests/test_text_emission_policy.py -q
```

Expected: all tests pass.

### Task 2: Wire Policy Into ASR Assembly

**Files:**
- Modify: `apps/agent/src/echosync_agent/services/asr/transcript_assembler.py`
- Test: `apps/agent/tests/test_transcript_assembler_contracts.py`

- [x] **Step 1: Add regression test for injectable policy**

Add a test that creates `TranscriptAssembler(emission_policy=TextEmissionPolicy(source_cjk_min_chars=2))` and verifies `"你", "好", "世"` emits cumulative source partials `"你"`, `"你好"`, `"你好世"` before final commit. The legacy `source_cjk_min_chars` option remains accepted for compatibility but no longer delays source display.

- [x] **Step 2: Verify test fails**

Run:

```bash
cd apps/agent
python -m pytest tests/test_transcript_assembler_contracts.py -q
```

Expected: fail because `TranscriptAssembler` does not accept `emission_policy`.

- [x] **Step 3: Inject policy**

Add optional constructor argument `emission_policy: TextEmissionPolicy | None = None`, default to `TextEmissionPolicy()`, and use `self.emission_policy.should_hold_source_partial(...)` only to suppress empty/duplicate source updates.

- [x] **Step 4: Verify assembler contracts**

Run:

```bash
cd apps/agent
python -m pytest tests/test_transcript_assembler_contracts.py -q
```

Expected: all assembler tests pass.

### Task 3: Wire Policy Into DeepSeek Streaming Translation

**Files:**
- Modify: `apps/agent/src/echosync_agent/services/translation/deepseek_translator.py`
- Test: `apps/agent/tests/test_deepseek_translator_contracts.py`

- [x] **Step 1: Add compatibility test**

Keep `should_flush_streaming_target()` as a public helper and assert it delegates the same behavior:

```python
assert should_flush_streaming_target(previous_text="旧译文", next_text="新") is True
assert should_flush_streaming_target(previous_text="大家好", next_text="大家好呀", is_final=True) is True
```

- [x] **Step 2: Verify test fails**

Run:

```bash
cd apps/agent
python -m pytest tests/test_deepseek_translator_contracts.py -q
```

Expected: fail because `is_final` is not accepted yet.

- [x] **Step 3: Delegate to policy**

Import `DEFAULT_TEXT_EMISSION_POLICY`, update `should_flush_streaming_target(previous_text, next_text, is_final=False)`, and call the helper with `is_final=True` before yielding the final stream result.

- [x] **Step 4: Verify translator contracts**

Run:

```bash
cd apps/agent
python -m pytest tests/test_deepseek_translator_contracts.py -q
```

Expected: all translator tests pass.

### Task 4: Full Verification

**Files:**
- Modify only files from Tasks 1-3.

- [x] **Step 1: Run full Agent tests**

Run:

```bash
cd apps/agent
python -m pytest
```

Expected: all Agent tests pass.

- [x] **Step 2: Report remaining gaps**

Report that phase 1 is policy extraction and wiring only. LocalAgreement and full LLM revision patching remain later tasks listed in the design spec. Translation first-token/final telemetry has completed first-round implementation; remaining telemetry work is capture/send/ASR-first-delta/overlay-render boundaries.

### Task 5: Frontend Snapshot Rendering Guardrails

**Files:**
- Modify: `apps/desktop/src/shared/caption-store.ts`
- Modify: `apps/desktop/src/shared/caption-display-buffer.ts`
- Test: `apps/desktop/tests/caption-store.test.ts`
- Test: `apps/desktop/tests/caption-display-buffer.test.ts`

- [x] **Step 1: Preserve received text immediately**

Add tests that a one-character `transcript.partial` creates/updates the current source line, and a short `translation.partial` is preserved in store and display buffer without frontend hold.

- [x] **Step 2: Remove frontend semantic buffering**

Keep `caption-display-buffer` as a snapshot pass-through. It may preserve `firstSeenAtMs` and `lastVisibleAtMs` for future visual decay, but it must not delay or chunk text.

- [x] **Step 3: Guard against stale revisions and premature locking**

Add tests that `translation.patch` is ignored when `base_rev` does not match or the line is already truly locked by `segment.commit`, that late partials do not unlock committed lines, and that `translation.partial(status=committed)` does not pre-lock the line before `segment.commit`.

- [x] **Step 4: Verify desktop contracts**

Run:

```bash
npm --prefix apps/desktop test -- caption-store.test.ts caption-display-buffer.test.ts
npm --prefix apps/desktop run typecheck
```

Expected: all tests pass.
