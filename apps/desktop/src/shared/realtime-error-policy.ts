import type { RealtimeErrorEvent } from "./realtime-events";

export type RealtimeErrorSurfaceContext = {
  stoppingSessionIds: ReadonlySet<string>;
};

export function shouldSurfaceRealtimeError(
  event: RealtimeErrorEvent,
  context: RealtimeErrorSurfaceContext
): boolean {
  return !context.stoppingSessionIds.has(event.session_id);
}
