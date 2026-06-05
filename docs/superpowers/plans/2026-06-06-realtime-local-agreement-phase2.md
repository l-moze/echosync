# Realtime Local Agreement Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first LocalAgreement-compatible ASR assembly behavior so EchoSync can handle providers that emit full rolling hypotheses, not only append-only deltas.

**Architecture:** Keep `TranscriptAssembler` as the ASR hypothesis boundary. Add a small `HypothesisUpdatePolicy` in `services/realtime` that decides whether incoming ASR text is an append delta or a full replacement hypothesis. `TranscriptAssembler` will use it to update `current_text` before applying existing emission and checkpoint logic.

**Tech Stack:** Python 3.11, pytest, existing EchoSync Agent async stream contracts.

---

### Task 1: Hypothesis Update Policy

**Files:**
- Create: `apps/agent/src/echosync_agent/services/realtime/hypothesis_update_policy.py`
- Test: `apps/agent/tests/test_hypothesis_update_policy.py`

- [ ] **Step 1: Write failing tests**

```python
from echosync_agent.services.realtime.hypothesis_update_policy import HypothesisUpdatePolicy


def test_policy_appends_short_delta_to_current_text() -> None:
    policy = HypothesisUpdatePolicy()

    result = policy.apply(current_text="Hello", incoming_text=", world")

    assert result.text == "Hello, world"
    assert result.mode == "append_delta"


def test_policy_replaces_with_full_hypothesis_when_incoming_contains_current_prefix() -> None:
    policy = HypothesisUpdatePolicy()

    result = policy.apply(current_text="Hello wor", incoming_text="Hello world")

    assert result.text == "Hello world"
    assert result.mode == "replace_hypothesis"


def test_policy_replaces_when_source_revises_previous_words() -> None:
    policy = HypothesisUpdatePolicy()

    result = policy.apply(current_text="I scream", incoming_text="ice cream")

    assert result.text == "ice cream"
    assert result.mode == "replace_hypothesis"
```

- [ ] **Step 2: Verify tests fail**

Run:

```bash
cd apps/agent
python -m pytest tests/test_hypothesis_update_policy.py -q
```

Expected: fail because `hypothesis_update_policy.py` does not exist.

- [ ] **Step 3: Implement minimal policy**

Create:

```python
@dataclass(frozen=True, slots=True)
class HypothesisUpdate:
    text: str
    mode: Literal["append_delta", "replace_hypothesis"]
```

Rules:
- empty current text -> replace with incoming
- incoming starts with current text -> replace with incoming
- incoming shares a meaningful prefix with current text -> replace with incoming
- incoming begins with whitespace or punctuation-like continuation -> append
- otherwise replace

- [ ] **Step 4: Verify policy tests pass**

Run:

```bash
cd apps/agent
python -m pytest tests/test_hypothesis_update_policy.py -q
```

Expected: all policy tests pass.

### Task 2: Wire Into TranscriptAssembler

**Files:**
- Modify: `apps/agent/src/echosync_agent/services/asr/transcript_assembler.py`
- Test: `apps/agent/tests/test_transcript_assembler_contracts.py`

- [ ] **Step 1: Add failing assembler test**

Add a test that feeds full rolling hypotheses:

```python
segments = asyncio.run(
    _collect(assembler.stream(_partial_segments(["Hello wor", "Hello world", "Hello world."])))
)

assert [(segment.text, segment.status) for segment in segments] == [
    ("Hello wor", SegmentStatus.PARTIAL),
    ("Hello world", SegmentStatus.PARTIAL),
    ("Hello world.", SegmentStatus.COMMITTED),
]
```

This must prove the assembler does not concatenate into `"Hello worHello worldHello world."`.

- [ ] **Step 2: Verify assembler test fails**

Run:

```bash
cd apps/agent
python -m pytest tests/test_transcript_assembler_contracts.py -q
```

Expected: fail because existing assembler appends every incoming text.

- [ ] **Step 3: Inject update policy**

Add optional constructor argument `hypothesis_policy: HypothesisUpdatePolicy | None = None`. Use `self.hypothesis_policy.apply(current_text=current_text, incoming_text=segment.text)` to update `current_text`. Keep `buffer` only as a boolean/history marker for end-of-stream flush.

- [ ] **Step 4: Verify assembler contracts**

Run:

```bash
cd apps/agent
python -m pytest tests/test_transcript_assembler_contracts.py -q
```

Expected: all assembler tests pass.

### Task 3: Full Verification

**Files:**
- Modify only Phase 2 files.

- [ ] **Step 1: Run Agent lint**

Run:

```bash
cd apps/agent
python -m ruff check src tests
```

Expected: all checks pass.

- [ ] **Step 2: Run full Agent tests**

Run:

```bash
cd apps/agent
python -m pytest
```

Expected: all Agent tests pass.

- [ ] **Step 3: Commit**

Run:

```bash
git add -- apps/agent/src/echosync_agent/services/realtime/hypothesis_update_policy.py apps/agent/src/echosync_agent/services/asr/transcript_assembler.py apps/agent/tests/test_hypothesis_update_policy.py apps/agent/tests/test_transcript_assembler_contracts.py docs/superpowers/plans/2026-06-06-realtime-local-agreement-phase2.md
git commit -m "支持实时转写滚动假设更新"
```
