# Realtime Telemetry Chain Design

## Background

The backend caption lifecycle and `caption_update` publication are now in place. The next bottleneck is not another visual guess at typewriter or scrolling behavior; the audit in `docs/caption-chain-audit.md` says the system needs a joined timing chain for one caption from audio capture through Agent processing and renderer receipt.

The current chain already has useful pieces:

- Desktop binary PCM frames carry `sentAtMs` in the frame header.
- Agent realtime transport records aggregate transport latency in `_RealtimeTransportMetrics`.
- ASR providers publish `asr_latency_ms` and sometimes `asr_rtf`.
- `TranscriptAssembler` publishes `merge_wait_ms`.
- `CascadedInterpretationEngine` publishes translation first-token/final metrics.
- `CaptionEventHub.publish()` adds `published_at_ms`.
- Desktop `realtime-telemetry.ts` computes `agentToRendererMs`.

The missing piece is consistency. Legacy events carry `metrics`, while the new `caption_update` payload currently does not. Segment commits do not carry metrics. ASR first-delta and checkpoint-created timestamps are also not normalized into segment metrics.

## Goals

- Keep backend telemetry as data on caption events, not as UI-specific behavior.
- Add `metrics` to `caption_update` payloads so the new protocol is at least as diagnosable as legacy events.
- Add `metrics` to `SegmentCommit` so final `caption_update` can preserve ASR/translation timing.
- Normalize `asr_first_delta_ms` and `checkpoint_created_at_ms` in transcript/translation metrics.
- Extend Desktop telemetry types so renderer logs can read the new fields without changing caption rendering.

## Non-Goals

- Do not implement AudioWorklet in this slice.
- Do not change frontend diff/typewriter/scroll behavior.
- Do not remove legacy events.
- Do not build a full diagnostics panel in this slice.
- Do not make Python control animation timing.

## Backend/Frontend Boundary

Backend owns:

- Metrics production and propagation through `TranscriptSegment`, `TranslationSegment`, `SegmentCommit`, legacy events, and `caption_update`.
- Agent receive/checkpoint/translation/caption publish timing fields.
- Log events that help diagnose ASR and translation latency.

Frontend owns:

- `renderer_received_at` and `agentToRendererMs`.
- Optional future `overlay_rendered_at`.
- Displaying or aggregating metrics in UI.
- Visual pacing and diff behavior.

## Proposed Metric Names

Metrics should stay snake_case in backend event payloads:

- `asr_latency_ms`
- `asr_first_delta_ms`
- `asr_rtf`
- `merge_wait_ms`
- `checkpoint_created_at_ms`
- `translation_request_started_ms`
- `translation_first_token_ms`
- `translation_latency_ms`
- `translation_delta_count`

Desktop telemetry can expose camelCase derived names:

- `asrLatencyMs`
- `asrFirstDeltaMs`
- `checkpointCreatedAtMs`
- `translationRequestStartedMs`
- `translationFirstTokenMs`
- `translationLatencyMs`
- `translationDeltaCount`

## Implementation Order

1. Add metrics passthrough to `caption_update` and `SegmentCommit`.
2. Add normalized ASR/checkpoint metrics in `TranscriptAssembler` and preserve them through `CascadedInterpretationEngine`.
3. Extend Desktop telemetry extraction to include the new metrics and `caption_update` text previews.

## Acceptance Criteria

- A `caption_update` generated from a translated segment includes the source segment metrics.
- A final `caption_update` generated from `SegmentCommit` includes final translation metrics.
- A committed transcript segment includes `asr_first_delta_ms`, `merge_wait_ms`, and `checkpoint_created_at_ms`.
- Desktop telemetry logs can read new metrics from both `translation.partial` and `caption_update`.
- Existing caption rendering tests still pass.
