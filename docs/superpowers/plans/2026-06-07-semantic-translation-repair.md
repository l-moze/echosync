# Semantic Translation Repair Lane

**Date:** 2026-06-07
**Status:** Implemented MVP
**Owner:** Agent backend, with Desktop event-contract alignment

## Problem

The old "slow repair" slot was not semantic repair. It only compared the
current translation against a previous revision of the same segment and emitted
a local diff patch. That is safe for latency, but it cannot fix poor committed
translations such as literal spoken fillers, fragmented ASR, missing required
terms, or awkward Mandarin word order.

Putting a second LLM call into the existing `CorrectionEngine.revise()` slot is
not acceptable: that slot runs before `segment.commit` and is bounded at 120 ms
for local correction only.

## Decision

Add a separate semantic repair lane after `segment.commit`.

- Fast path remains unchanged: ASR -> streaming translation -> local cleanup ->
  `segment.commit`.
- Slow repair is optional and disabled by default.
- When enabled, committed segments are queued to a low-priority worker.
- The worker asks DeepSeek for a full corrected subtitle text, not patch
  operations.
- The backend publishes a `caption_update` with `state="final"` and
  `revision=base_rev+1`.
- Desktop keeps ignoring `translation.patch` on locked rows, but accepts the
  newer final `caption_update`.
- TTS is not regenerated from slow repair.

## Config

```text
ECHOSYNC_TRANSLATION_REPAIR_PROVIDER=disabled|deepseek
ECHOSYNC_TRANSLATION_REPAIR_MODEL=deepseek-chat
ECHOSYNC_TRANSLATION_REPAIR_TIMEOUT_MS=1500
ECHOSYNC_TRANSLATION_REPAIR_MAX_CONCURRENCY=1
ECHOSYNC_TRANSLATION_REPAIR_MODE=suspect_only|debug_all
```

## Trigger Policy

`suspect_only` queues repair only when a committed segment shows quality risk:

- `glossary_missing_required_terms > 0`
- target locale normalization or discourse-marker cleanup occurred
- source has ASR artifacts such as `it 's` or `c ider`
- source looks like a fragment, for example lower-case continuation or leading
  connector
- target contains obvious spacing/order artifacts
- source/target length ratio is abnormal

`debug_all` repairs every committed segment with non-empty source and target.

## Event Contract

The repair lane emits:

```json
{
  "type": "caption_update",
  "state": "final",
  "revision": 3,
  "target": { "full_text": "修复后的译文", "language": "zh-CN" },
  "metrics": {
    "semantic_revision_latency_ms": 860.0,
    "semantic_revision_changed_chars": 12.0,
    "semantic_revision_trigger_count": 2.0
  }
}
```

The worker checks the latest known revision before publishing, so a late repair
cannot overwrite a newer row.

## Implementation

- `interfaces/translation_repair.py`
- `services/correction/semantic_repair.py`
- `pipeline/engine_pipeline.py`
- `services/subtitle/caption_update.py`
- `runtime/settings.py`
- `runtime/assembly.py`
- `desktop/shared/caption-store.ts`
- `desktop/shared/realtime-events.ts`

## Validation

Focused contracts added:

- repair policy trigger and skip behavior
- DeepSeek repair prompt/context/glossary contract
- pipeline publishes commit before waiting for repair
- final `caption_update` updates a locked Desktop row
- WebSocket/log summary carries semantic revision metrics
