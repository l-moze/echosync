import type { RealtimeEvent } from "../../../shared/realtime-events";

export async function getCaptionSnapshot(sessionId?: string) {
  return window.echosyncDesktop?.getCaptionSnapshot(sessionId);
}

export function onRealtimeEvent(listener: (event: RealtimeEvent) => void) {
  return window.echosyncDesktop?.onRealtimeEvent(listener) ?? (() => {});
}
