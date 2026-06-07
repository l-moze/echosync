import type { RealtimeEvent, SegmentStatus } from "./realtime-events";

export type RealtimeEventTelemetry = {
  type: RealtimeEvent["type"];
  sessionId: string;
  segmentId?: string;
  revision?: number;
  traceId?: string;
  spanId?: string;
  state?: string;
  status?: SegmentStatus;
  final?: boolean;
  startMs?: number;
  endMs?: number;
  sourcePreview?: string;
  sourceTextLength?: number;
  targetPreview?: string;
  targetTextLength?: number;
  patchOperationCount?: number;
  patchReason?: string;
  provider?: string;
  code?: string;
  retryable?: boolean;
  message?: string;
  agentToRendererMs?: number;
  asrLatencyMs?: number;
  asrQueueWaitMs?: number;
  asrStreamElapsedMs?: number;
  asrAudioLagMs?: number;
  captionSendFailures?: number;
  captionSendMs?: number;
  llmDeltaCount?: number;
  llmRequestMs?: number;
  llmStreamMs?: number;
  llmTtftMs?: number;
  mergeWaitMs?: number;
  translationQueueWaitMs?: number;
  translationFirstTokenMs?: number;
  translationLatencyMs?: number;
  ttsFirstAudioMs?: number;
  ttsTotalMs?: number;
  ttsAudioChunks?: number;
  ttsAudioBytes?: number;
  ttsFailed?: number;
};

export type RealtimeTelemetryLogger = {
  debug: (message: string, data: RealtimeEventTelemetry) => void;
};

export function buildRealtimeEventTelemetry(
  event: RealtimeEvent,
  receivedAtMs: number
): RealtimeEventTelemetry {
  const metrics = "metrics" in event ? event.metrics : undefined;
  const sourceText = sourceTextFromEvent(event);
  const targetText = targetTextFromEvent(event);

  return {
    type: event.type,
    sessionId: event.session_id,
    segmentId: "segment_id" in event ? event.segment_id : undefined,
    revision: revisionFromEvent(event),
    traceId: traceIdFromEvent(event),
    spanId: spanIdFromEvent(event),
    state: "state" in event ? event.state : undefined,
    status: "status" in event ? event.status : undefined,
    final: "final" in event ? event.final : undefined,
    startMs: startMsFromEvent(event),
    endMs: endMsFromEvent(event),
    sourcePreview: sourceText === undefined ? undefined : preview(sourceText),
    sourceTextLength: sourceText?.length,
    targetPreview: targetText === undefined ? undefined : preview(targetText),
    targetTextLength: targetText?.length,
    patchOperationCount: "operations" in event ? event.operations.length : undefined,
    patchReason: "reason" in event ? event.reason : undefined,
    provider: "provider" in event ? event.provider : undefined,
    code: "code" in event ? event.code : undefined,
    retryable: "retryable" in event ? event.retryable : undefined,
    message: "message" in event ? event.message : undefined,
    agentToRendererMs:
      typeof event.published_at_ms === "number"
        ? Math.max(0, receivedAtMs - event.published_at_ms)
        : undefined,
    asrLatencyMs: metrics?.asr_latency_ms,
    asrQueueWaitMs: metrics?.asr_queue_wait_ms,
    asrStreamElapsedMs: metrics?.asr_stream_elapsed_ms,
    asrAudioLagMs: metrics?.asr_audio_lag_ms,
    captionSendFailures: metrics?.caption_send_failures,
    captionSendMs: metrics?.caption_send_ms,
    llmDeltaCount: metrics?.llm_delta_count,
    llmRequestMs: metrics?.llm_request_ms,
    llmStreamMs: metrics?.llm_stream_ms,
    llmTtftMs: metrics?.llm_ttft_ms,
    mergeWaitMs: metrics?.merge_wait_ms,
    translationQueueWaitMs: metrics?.translation_queue_wait_ms,
    translationFirstTokenMs: metrics?.translation_first_token_ms,
    translationLatencyMs: metrics?.translation_latency_ms,
    ttsFirstAudioMs: metrics?.tts_first_audio_ms,
    ttsTotalMs: metrics?.tts_total_ms,
    ttsAudioChunks: metrics?.tts_audio_chunks,
    ttsAudioBytes: metrics?.tts_audio_bytes,
    ttsFailed: metrics?.tts_failed
  };
}

export function logRealtimeEventTelemetry(
  logger: RealtimeTelemetryLogger,
  event: RealtimeEvent,
  receivedAtMs: number
) {
  logger.debug("caption_event_renderer_received", buildRealtimeEventTelemetry(event, receivedAtMs));
}

function revisionFromEvent(event: RealtimeEvent): number | undefined {
  if ("rev" in event) {
    return event.rev;
  }
  if ("revision" in event) {
    return event.revision;
  }
  return undefined;
}

function traceIdFromEvent(event: RealtimeEvent): string | undefined {
  return "trace_id" in event ? event.trace_id : undefined;
}

function spanIdFromEvent(event: RealtimeEvent): string | undefined {
  return "span_id" in event ? event.span_id : undefined;
}

function startMsFromEvent(event: RealtimeEvent): number | undefined {
  if ("start_ms" in event) {
    return event.start_ms;
  }
  if ("timing" in event) {
    return event.timing.start_ms;
  }
  return undefined;
}

function endMsFromEvent(event: RealtimeEvent): number | undefined {
  if ("end_ms" in event) {
    return event.end_ms;
  }
  if ("timing" in event) {
    return event.timing.end_ms;
  }
  return undefined;
}

function sourceTextFromEvent(event: RealtimeEvent): string | undefined {
  if ("source_text" in event) {
    return event.source_text;
  }
  if ("source" in event) {
    return event.source.full_text;
  }
  return undefined;
}

function targetTextFromEvent(event: RealtimeEvent): string | undefined {
  if ("target_text" in event) {
    return event.target_text;
  }
  if ("target" in event) {
    return event.target?.full_text;
  }
  if ("target_text" in event) {
    return event.target_text;
  }
  return undefined;
}

function preview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 96 ? `${normalized.slice(0, 96)}...` : normalized;
}
