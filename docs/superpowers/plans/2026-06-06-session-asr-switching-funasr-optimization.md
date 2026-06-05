# Session ASR Switching And FunASR Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session-level ASR provider selection and make FunASR consume small transport frames through an internal inference buffer, so low-latency transport does not force inefficient 80ms FunASR calls.

**Architecture:** Desktop declares the chosen ASR provider and latency mode in `audio.start`; Agent applies a per-session settings override before building the pipeline. FunASR keeps the public `Transcriber` boundary but aggregates incoming `AudioFrame` objects into provider-sized chunks before `AutoModel.generate()`. Documentation clarifies which providers are currently usable and which high-quality ASR adapters are next.

**Tech Stack:** Python 3.11+, FastAPI WebSocket, FunASR AutoModel, TypeScript/Electron renderer, Vitest, pytest.

---

## Files

- Modify `apps/desktop/src/renderer/realtime-audio-client.ts`: accept `asrProvider` and `asrLatencyMode`, include them in `audio.start`.
- Modify `apps/desktop/tests/realtime-audio-client.test.ts`: cover start-message provider fields.
- Modify `apps/agent/src/echosync_agent/runtime/settings.py`: add allowed ASR override helper and latency mode.
- Modify `apps/agent/src/echosync_agent/transport/realtime_ws.py`: read session ASR override from `audio.start` before pipeline creation.
- Modify `apps/agent/src/echosync_agent/services/asr/funasr_transcriber.py`: buffer 80ms frames into `chunk_ms` inference windows and flush on final/end.
- Modify `apps/agent/tests/test_realtime_caption_websocket_contracts.py`: prove per-session ASR override reaches pipeline settings.
- Modify `apps/agent/tests/test_asr_media_contracts.py` or add focused FunASR tests: prove aggregation calls model once for enough small frames and flushes final remainder.
- Modify `README.md`, `doc/architecture-mvp.md`, `doc/技术路线与库调研.md`, `docs/caption-chain-audit.md`: document session-level ASR switching and FunASR buffering.

---

### Task 1: Desktop Sends ASR Session Options

- [x] Write a Vitest expectation that `createRealtimeAudioClient({ asrProvider: "funasr", asrLatencyMode: "balanced" })` includes `asr_provider` and `asr_latency_mode` in the `audio.start` payload.
- [x] Run `npm --prefix apps/desktop test -- realtime-audio-client.test.ts` and confirm the new test fails because the options are not supported.
- [x] Add `asrProvider?: "mock" | "funasr" | "voxtral"` and `asrLatencyMode?: "low_latency" | "balanced" | "accuracy"` to `RealtimeAudioClientOptions`.
- [x] Include `asr_provider` and `asr_latency_mode` in the start payload, defaulting to `"funasr"` and `"balanced"` for real capture.
- [x] Run the focused desktop test and confirm it passes.

### Task 2: Agent Applies Per-Session ASR Override

- [x] Write a pytest that sends `audio.start` with `asr_provider="funasr"` and asserts the settings passed to `build_demo_pipeline()` use `funasr` even when server default is `mock`.
- [x] Run the focused pytest and confirm it fails because `_RealtimeWebSocketSession` builds the pipeline before reading `audio.start`.
- [x] Move pipeline construction until after `audio.start` is handled, or lazily create it before the first audio frame.
- [x] Add a small settings override function that validates provider against the supported set and rejects unknown provider names with `realtime.error`.
- [x] Keep API keys server-side: session override can choose `voxtral`, but the existing `.env` key remains the source of credentials.
- [x] Run the focused pytest and confirm it passes.

### Task 3: FunASR Buffers Small Transport Frames

- [x] Write a fake-model pytest for `FunAsrTranscriber` that feeds six 100ms frames with `chunk_ms=300` and asserts `model.generate()` is called twice with 300ms audio windows.
- [x] Write a second fake-model pytest that feeds a final 100ms remainder and asserts it is flushed with `is_final=True`.
- [x] Run the focused pytest and confirm the tests fail because current FunASR calls the model once per input frame.
- [x] Implement an internal buffer in `FunAsrTranscriber.stream()`: accumulate PCM bytes and frame metadata until `chunk_ms`, then call `_recognize_frame()` with a merged `AudioFrame`.
- [x] Flush any remainder when an input frame has `is_final=True` or when the frame iterator ends.
- [x] Preserve session id, source language/source kind/device id, and use first start/end last timestamps on merged frames.
- [x] Run the focused pytest and confirm it passes.

### Task 4: Documentation Sync

- [x] Update README local test notes to explain ASR can be selected per session once UI wiring is added, while `.env` remains the default.
- [x] Update architecture docs to say transport frames are 80ms but FunASR inference windows are provider-sized, default 600ms.
- [x] Update technology research docs with the provider shortlist: FunASR local, Voxtral cloud, Deepgram/Azure next, OpenAI Realtime as end-to-end candidate.
- [x] Run keyword checks for stale claims that Desktop cannot select ASR or that FunASR is called per 80ms transport frame.

---

## Self Review

- No placeholder tasks remain.
- Scope is limited to session provider selection, FunASR buffering, and docs. It does not implement Deepgram/Azure networking in this pass, so those names remain research candidates rather than selectable providers.
- Tests cover Desktop start payload, Agent session override, and FunASR buffering behavior.
