# Backend Caption Lifecycle Protocol Design

## Background

EchoSync already has a state-driven caption chain: Agent emits `transcript.partial`, `translation.partial`, `translation.patch`, and `segment.commit`, while Desktop stores desired caption state and uses a visual display buffer for diff/typewriter rendering. The next backend step is not to move animation into Agent. The backend should expose better segment state and revision context so the frontend can render smoothly without guessing semantic lifecycle.

## Goals

- Keep backend ownership over segment identity, revision, lifecycle, source/target snapshots, endpoint finalization, and translation scheduling.
- Keep frontend ownership over local diff, typewriter pacing, visual revision decay, and scroll presentation.
- Add stable/unstable text fields to backend events so the frontend can style provisional tails without backend character-level display patches.
- Let ASR endpoint final markers participate in EchoSync segment finalization without locking every provider-level short final chunk.
- Give the translator explicit current-segment revision context so it can revise the current translation instead of translating isolated chunks.
- Preserve existing event names during this implementation slice; `caption_update` remains the target protocol, not a breaking change in this pass.

## Non-Goals

- Do not replace the Desktop visual buffer or move typewriter timing into Python.
- Do not remove `translation.patch` yet; keep it as a legacy semantic correction event, not as the primary display diff mechanism.
- Do not enable partial translation by default. Stable and committed checkpoints remain the default translation path.
- Do not rename public event types in this slice.

## Backend/Frontend Boundary

Backend responsibilities:

- Generate and maintain `segment_id`.
- Increment `rev` when the current segment hypothesis changes.
- Publish source and target full snapshot fields.
- Publish `source_stable_text`, `source_unstable_text`, `target_stable_text`, and `target_unstable_text`.
- Decide when a segment becomes stable or committed.
- Debounce/coalesce translation checkpoints by segment and revision.
- Provide previous current-segment source/target context to the translator.

Frontend responsibilities:

- Ignore stale revisions.
- Update the existing segment node when `segment_id` is unchanged.
- Compute lightweight LCP/grapheme diff for visual animation.
- Pace visible text with the display buffer/typewriter queue.
- Manage stable scrolling and overlay history.

## Implementation Slice

1. Add a small backend text-region helper that splits a full text snapshot into stable and unstable regions.
2. Attach stable/unstable fields to transcript and translation domain events.
3. Treat ASR endpoint-final metrics as a real segment commit signal, while preserving the existing guard against provider-level short finals that lack endpoint evidence.
4. Add current-segment revision context to `CorrectionContext` and DeepSeek prompt construction.
5. Add optional frontend event type fields so TypeScript consumers know the backend can send these fields.

## Compatibility

Existing consumers can ignore the new fields. Legacy events continue to be emitted in the current order. A future protocol pass can add a dedicated `caption_update` event once Desktop consumption is ready.

