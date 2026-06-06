# Agent Capabilities And Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Desktop choose ASR/translation providers safely by reading Agent capabilities before starting realtime capture.

**Architecture:** Agent exposes a small HTTP capabilities endpoint derived from `Settings`. Desktop main/preload bridges that endpoint into the renderer. Renderer stores ASR provider, ASR latency mode, and translation provider selections, validates them before opening media capture, then sends explicit session overrides in `audio.start`.

**Tech Stack:** Python 3.11, FastAPI, pytest, TypeScript, Electron, React, Vitest.

---

### Task 1: Agent Capabilities Contract

**Files:**
- Create: `apps/agent/src/echosync_agent/runtime/capabilities.py`
- Test: `apps/agent/tests/test_runtime_capabilities.py`
- Modify: `apps/agent/src/echosync_agent/transport/caption_ws.py`
- Test: `apps/agent/tests/test_realtime_caption_websocket_contracts.py`

- [x] Add tests for provider readiness and HTTP endpoint.
- [x] Implement `build_realtime_capabilities(settings, dependency_available=...)`.
- [x] Add `GET /healthz` and `GET /v1/realtime/capabilities`.
- [x] Run focused pytest.

### Task 2: Desktop Provider State And Preflight

**Files:**
- Create: `apps/desktop/src/shared/asr-provider-catalog.ts`
- Create: `apps/desktop/src/shared/agent-capabilities.ts`
- Create: `apps/desktop/src/shared/realtime-preflight.ts`
- Test: `apps/desktop/tests/realtime-preflight.test.ts`
- Modify: `apps/desktop/src/shared/desktop-api.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/main.ts`

- [x] Add Vitest coverage for preflight failures and valid real provider selection.
- [x] Implement shared provider/catalog/capabilities types.
- [x] Bridge `agent:get-capabilities` through main and preload.
- [x] Run focused Vitest.

### Task 3: Renderer UI Wiring

**Files:**
- Modify: `apps/desktop/src/renderer/main.tsx`
- Modify: `apps/desktop/src/renderer/realtime-audio-client.ts`
- Test: `apps/desktop/tests/realtime-audio-client.test.ts`

- [x] Move ASR provider types into shared catalog.
- [x] Add ASR provider and latency selectors to the idle dashboard.
- [x] Refresh capabilities before start and block invalid selections.
- [x] Pass explicit provider selections into `createRealtimeAudioClient`.
- [x] Run desktop typecheck and targeted tests.

### Task 4: Documentation And Review

**Files:**
- Modify: `README.md`
- Modify: `doc/architecture-mvp.md`
- Modify: `docs/caption-chain-audit.md`
- Modify: `docs/superpowers/plans/2026-06-06-session-asr-switching-funasr-optimization.md`

- [x] Update docs for capabilities/preflight.
- [x] Fix stale “default funasr” wording.
- [x] Run keyword checks for stale claims.
- [x] Run full Agent/Desktop verification.
