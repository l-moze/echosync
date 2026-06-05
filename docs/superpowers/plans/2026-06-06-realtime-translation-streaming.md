# Realtime Translation Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first maintainable layer for low-latency readable streaming subtitles: centralized text emission policy, wired into ASR assembly and DeepSeek streaming translation.

**Architecture:** Keep EchoSync's cascaded pipeline. Extract text display/flush decisions into a small policy object so ASR, translation, and future revision code do not duplicate thresholds. This task does not change the event protocol.

**Tech Stack:** Python 3.11, pytest, existing EchoSync Agent dataclasses and async stream contracts.

---

### Task 1: Central Text Emission Policy

**Files:**
- Create: `apps/agent/src/echosync_agent/services/realtime/__init__.py`
- Create: `apps/agent/src/echosync_agent/services/realtime/text_emission_policy.py`
- Test: `apps/agent/tests/test_text_emission_policy.py`

- [ ] **Step 1: Write failing tests**

```python
from echosync_agent.services.realtime.text_emission_policy import TextEmissionPolicy


def test_policy_holds_short_cjk_source_partial_until_readable_chunk() -> None:
    policy = TextEmissionPolicy(source_cjk_min_chars=4)

    assert policy.should_hold_source_partial(current_text="你", last_emitted_text="") is True
    assert policy.should_hold_source_partial(current_text="你好世", last_emitted_text="") is True
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

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd apps/agent
python -m pytest tests/test_text_emission_policy.py -q
```

Expected: fail because `echosync_agent.services.realtime.text_emission_policy` does not exist.

- [ ] **Step 3: Implement policy**

Create `TextEmissionPolicy` with:

- `should_hold_source_partial(current_text, last_emitted_text, is_final=False)`
- `should_emit_target(previous_text, next_text, is_final=False)`
- display character counting that ignores whitespace
- CJK detection for `\u4e00-\u9fff`
- punctuation-triggered flush

- [ ] **Step 4: Run tests and verify pass**

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

- [ ] **Step 1: Add regression test for injectable policy**

Add a test that creates `TranscriptAssembler(emission_policy=TextEmissionPolicy(source_cjk_min_chars=2))` and verifies `"你", "好", "世"` emits `"你好"` partial before final commit.

- [ ] **Step 2: Verify test fails**

Run:

```bash
cd apps/agent
python -m pytest tests/test_transcript_assembler_contracts.py -q
```

Expected: fail because `TranscriptAssembler` does not accept `emission_policy`.

- [ ] **Step 3: Inject policy**

Add optional constructor argument `emission_policy: TextEmissionPolicy | None = None`, default to `TextEmissionPolicy()`, and replace the local `_should_hold_partial_display()` logic with `self.emission_policy.should_hold_source_partial(...)`.

- [ ] **Step 4: Verify assembler contracts**

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

- [ ] **Step 1: Add compatibility test**

Keep `should_flush_streaming_target()` as a public helper and assert it delegates the same behavior:

```python
assert should_flush_streaming_target(previous_text="旧译文", next_text="新") is True
assert should_flush_streaming_target(previous_text="大家好", next_text="大家好呀", is_final=True) is True
```

- [ ] **Step 2: Verify test fails**

Run:

```bash
cd apps/agent
python -m pytest tests/test_deepseek_translator_contracts.py -q
```

Expected: fail because `is_final` is not accepted yet.

- [ ] **Step 3: Delegate to policy**

Import `DEFAULT_TEXT_EMISSION_POLICY`, update `should_flush_streaming_target(previous_text, next_text, is_final=False)`, and call the helper with `is_final=True` before yielding the final stream result.

- [ ] **Step 4: Verify translator contracts**

Run:

```bash
cd apps/agent
python -m pytest tests/test_deepseek_translator_contracts.py -q
```

Expected: all translator tests pass.

### Task 4: Full Verification

**Files:**
- Modify only files from Tasks 1-3.

- [ ] **Step 1: Run full Agent tests**

Run:

```bash
cd apps/agent
python -m pytest
```

Expected: all Agent tests pass.

- [ ] **Step 2: Report remaining gaps**

Report that phase 1 is policy extraction and wiring only. LocalAgreement, LLM revision patching, and metrics are intentionally left for later tasks listed in the design spec.
