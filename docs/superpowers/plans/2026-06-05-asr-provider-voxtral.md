# ASR Provider Voxtral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a light ASR provider factory and Voxtral Realtime ASR adapter so EchoSync can test multiple ASR engines behind the same `Transcriber` contract.

**Architecture:** Keep `Transcriber.stream(AudioFrame)` as the stable boundary. Add a static provider factory used by both runtime assembly and CLI. Add a Voxtral adapter that converts Mistral realtime transcription events into `TranscriptSegment` without changing WebSocket, translation, correction, or subtitle layers.

**Tech Stack:** Python 3.11, pytest, FastAPI test client, existing EchoSync Agent domain DTOs, optional `mistralai[realtime]` dependency.

---

### Task 1: Provider Factory Contract

**Files:**
- Create: `apps/agent/src/echosync_agent/services/asr/factory.py`
- Modify: `apps/agent/src/echosync_agent/runtime/settings.py`
- Modify: `apps/agent/src/echosync_agent/runtime/assembly.py`
- Test: `apps/agent/tests/test_asr_provider_contracts.py`

- [ ] **Step 1: Write failing provider factory tests**

Add tests that instantiate `Settings` with `mock`, `funasr`, and `voxtral`, call `build_transcriber_from_settings()`, and assert the correct transcriber/config is returned. The Voxtral test should pass `mistral_api_key="test-key"` and assert model/delay values.

- [ ] **Step 2: Run provider tests and verify failure**

Run: `pytest apps/agent/tests/test_asr_provider_contracts.py -q`
Expected: import failure for missing `echosync_agent.services.asr.factory` or missing settings fields.

- [ ] **Step 3: Implement factory and settings fields**

Add `mistral_api_key`, `voxtral_model`, and `voxtral_target_delay_ms` to `Settings`. Add a factory function that supports `mock`, `funasr`, and `voxtral`. Update `runtime.assembly` to call the factory.

- [ ] **Step 4: Run provider tests and verify pass**

Run: `pytest apps/agent/tests/test_asr_provider_contracts.py -q`
Expected: all provider factory tests pass.

### Task 2: Voxtral Realtime Adapter Contract

**Files:**
- Create: `apps/agent/src/echosync_agent/services/asr/voxtral_transcriber.py`
- Modify: `apps/agent/src/echosync_agent/services/asr/__init__.py`
- Test: `apps/agent/tests/test_asr_voxtral_contracts.py`

- [ ] **Step 1: Write failing Voxtral adapter tests**

Use injected fake event classes/client factory. Test that PCM bytes from `AudioFrame` are passed through as an async bytes stream and that fake text delta events yield `TranscriptSegment` with text, session id, timing, source language, partial status, and latency metrics.

- [ ] **Step 2: Run Voxtral tests and verify failure**

Run: `pytest apps/agent/tests/test_asr_voxtral_contracts.py -q`
Expected: import failure for missing `VoxtralRealtimeTranscriber`.

- [ ] **Step 3: Implement Voxtral adapter**

Create `VoxtralRealtimeConfig` and `VoxtralRealtimeTranscriber`. Support dependency injection for tests. Default client factory imports Mistral SDK lazily and raises a clear runtime error if `mistralai[realtime]` is not installed. Treat text delta events by duck typing on class name or `text` attribute, and treat error events as runtime errors.

- [ ] **Step 4: Run Voxtral tests and verify pass**

Run: `pytest apps/agent/tests/test_asr_voxtral_contracts.py -q`
Expected: all Voxtral adapter tests pass.

### Task 3: CLI and Package Wiring

**Files:**
- Modify: `apps/agent/src/echosync_agent/asr_demo.py`
- Modify: `apps/agent/pyproject.toml`
- Modify: `.env.example`
- Test: `apps/agent/tests/test_asr_cli_contracts.py`

- [ ] **Step 1: Write failing CLI tests**

Extend CLI parser tests to assert `--provider voxtral`, `--mistral-api-key`, and `--voxtral-delay-ms` are accepted and default delay is 1000.

- [ ] **Step 2: Run CLI tests and verify failure**

Run: `pytest apps/agent/tests/test_asr_cli_contracts.py -q`
Expected: parser rejects `voxtral` or lacks new args.

- [ ] **Step 3: Implement CLI and dependency wiring**

Update parser choices and `build_transcriber()` to use ASR factory config. Add optional dependency group `voxtral = ["mistralai[realtime]>=1.0"]`. Add Voxtral env variables to `.env.example`.

- [ ] **Step 4: Run CLI tests and verify pass**

Run: `pytest apps/agent/tests/test_asr_cli_contracts.py -q`
Expected: CLI tests pass.

### Task 4: Full Agent Verification

**Files:**
- Any files changed in Tasks 1-3.

- [ ] **Step 1: Run focused ASR tests**

Run: `pytest apps/agent/tests/test_asr_provider_contracts.py apps/agent/tests/test_asr_voxtral_contracts.py apps/agent/tests/test_asr_cli_contracts.py apps/agent/tests/test_asr_media_contracts.py apps/agent/tests/test_asr_websocket_contracts.py -q`
Expected: focused ASR tests pass.

- [ ] **Step 2: Run all agent tests**

Run: `pytest apps/agent/tests -q`
Expected: all agent tests pass.

- [ ] **Step 3: Inspect diff**

Run: `git diff -- apps/agent/src/echosync_agent/services/asr apps/agent/src/echosync_agent/runtime apps/agent/src/echosync_agent/asr_demo.py apps/agent/tests apps/agent/pyproject.toml .env.example docs/superpowers/specs/2026-06-05-asr-provider-voxtral-design.md docs/superpowers/plans/2026-06-05-asr-provider-voxtral.md`
Expected: diff only contains ASR provider/Voxtral changes and the two Superpowers documents.

## Self Review

- The plan covers provider selection, Voxtral adapter, CLI, package config, env docs, and verification.
- There are no placeholders.
- Types and names are consistent with the design spec.
