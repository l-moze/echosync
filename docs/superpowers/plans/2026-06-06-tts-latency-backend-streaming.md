# TTS Latency Backend Streaming Implementation

> Status: implemented and verified on 2026-06-06. Follow-up latency telemetry landed the same day.

## Goal

Keep TTS synthesis on the Python Agent backend, reduce first-audio delay, and keep the renderer responsible only for streaming playback.

## Decisions

- TTS synthesis stays in Agent backend, not renderer.
  - API keys, voice ids, provider SDK quirks, retries, and logs remain server side.
  - Desktop only selects provider and plays returned audio.
- TTS is triggered once per final `segment.commit`.
  - DeepSeek streaming `translation.partial` events do not trigger repeated synthesis.
- Agent publishes TTS audio chunks immediately as `tts.audio final=false`.
  - The old lookahead-style approach had to hold one audio chunk to know whether it was final.
  - The new protocol sends an empty `audio_base64` `final=true` event after the provider stream ends.
- Renderer prefers MediaSource incremental playback.
  - If MediaSource/MIME is unsupported, it falls back to collecting the same `segment_id:rev` chunks and playing one Blob after the empty final marker.
- ElevenLabs default model is `eleven_flash_v2_5`.
  - Official docs position Flash v2.5 as the low-latency real-time TTS model.
  - `.env` can still override to `eleven_multilingual_v2` when quality or number normalization is more important.
  - `ELEVENLABS_OPTIMIZE_STREAMING_LATENCY` remains user-configurable but unset by default because the stream API marks it deprecated.
- HTTP streaming remains the MVP path for committed translations.
  - ElevenLabs' WebSocket TTS is a better fit when text arrives incrementally from an LLM.
  - EchoSync currently sends only committed translations to TTS, so WebSocket TTS should wait until logs show `tts_first_audio_ms` is the bottleneck.

## Official Docs Checked

- ElevenLabs Models: https://elevenlabs.io/docs/models/ documents `eleven_flash_v2_5` as optimized for real-time use at about 75ms model latency; `eleven_multilingual_v2` is better for long-form quality and number normalization.
- ElevenLabs Stream Speech API: https://elevenlabs.io/docs/api-reference/text-to-speech/stream documents `/v1/text-to-speech/:voice_id/stream` as streamed audio output; `optimize_streaming_latency` is optional and deprecated.
- ElevenLabs Latency Optimization: https://elevenlabs.io/docs/api-reference/reducing-latency documents WebSocket TTS for real-time text input and chunk scheduling; it should be treated as a phase-2 option after HTTP streaming metrics prove provider TTFA dominates.
- MDN MediaSource: https://developer.mozilla.org/en-US/docs/Web/API/MediaSource/endOfStream documents closing a MediaSource stream after SourceBuffer updates complete; the renderer now waits for playback `ended`/`error` or explicit `clear()` before releasing the object URL.

## Verification

Agent full suite:

```powershell
$env:PYTHONPATH='apps/agent/src'; pytest apps/agent/tests -q
```

Result:

```text
186 passed in 1.43s
```

Desktop typecheck:

```powershell
npm --prefix apps/desktop run typecheck
```

Result: passed.

Desktop full Vitest suite:

```powershell
npm --prefix apps/desktop test -- --run
```

Result:

```text
35 passed (35)
216 passed (216)
```

Production builds:

```powershell
npm --prefix apps/desktop run build
npm --prefix apps/web run build
```

Result: passed.

## 2026-06-06 Follow-up: Real-Log Counters

- Added Agent log checkpoints:
  - `tts_synthesis_started`
  - `tts_synthesis_first_audio`
  - `tts_synthesis_finished`
  - `tts_synthesis_failed`
- Added `tts.audio.metrics`:
  - `tts_first_audio_ms`
  - `tts_total_ms`
  - `tts_audio_chunks`
  - `tts_audio_bytes`
- Extended `echosync-log-summary` to summarize audio transport, ASR queue, FunASR inference, DeepSeek translation, and TTS distributions in one report.
- Desktop shared event types and renderer telemetry now preserve TTS metrics.

## Next Cut

- Compare Edge TTS vs ElevenLabs Flash v2.5 on the same subtitle segment.
- Consider ElevenLabs WebSocket TTS only after HTTP streaming logs show provider TTFA is still the bottleneck.
- If TTS is not the bottleneck, continue optimizing ASR checkpoint timing or DeepSeek queue pressure instead.
