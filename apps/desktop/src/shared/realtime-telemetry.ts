import type { RealtimeEvent, SegmentStatus } from "./realtime-events";

export type RealtimeEventTelemetry = {
  type: RealtimeEvent["type"];
  sessionId: string;
  segmentId?: string;
  status?: SegmentStatus;
  agentToRendererMs?: number;
  asrLatencyMs?: number;
  mergeWaitMs?: number;
  translationFirstTokenMs?: number;
  translationLatencyMs?: number;
};

export type RealtimeTelemetryLogger = {
  debug: (message: string, data: RealtimeEventTelemetry) => void;
};

export function buildRealtimeEventTelemetry(
  event: RealtimeEvent,
  receivedAtMs: number
): RealtimeEventTelemetry {
  const metrics = "metrics" in event ? event.metrics : undefined;

  return {
    type: event.type,
    sessionId: event.session_id,
    segmentId: "segment_id" in event ? event.segment_id : undefined,
    status: "status" in event ? event.status : undefined,
    agentToRendererMs:
      typeof event.published_at_ms === "number"
        ? Math.max(0, receivedAtMs - event.published_at_ms)
        : undefined,
    asrLatencyMs: metrics?.asr_latency_ms,
    mergeWaitMs: metrics?.merge_wait_ms,
    translationFirstTokenMs: metrics?.translation_first_token_ms,
    translationLatencyMs: metrics?.translation_latency_ms
  };
}

export function logRealtimeEventTelemetry(
  logger: RealtimeTelemetryLogger,
  event: RealtimeEvent,
  receivedAtMs: number
) {
  logger.debug("caption_event_renderer_received", buildRealtimeEventTelemetry(event, receivedAtMs));
}
