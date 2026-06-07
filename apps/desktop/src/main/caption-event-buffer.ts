import type { RealtimeEvent } from "../shared/realtime-events";

export type CaptionEventBuffer = {
  clear: () => void;
  clearSession: (sessionId: string) => void;
  push: (event: RealtimeEvent) => void;
  snapshot: (sessionId?: string) => RealtimeEvent[];
};

export function createCaptionEventBuffer(maxEvents = 50): CaptionEventBuffer {
  const events: RealtimeEvent[] = [];

  return {
    clear() {
      events.splice(0, events.length);
    },
    clearSession(sessionId) {
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index]?.session_id === sessionId) {
          events.splice(index, 1);
        }
      }
    },
    push(event) {
      if (event.type === "tts.audio") {
        return;
      }
      events.push(event);
      if (events.length > maxEvents) {
        events.splice(0, events.length - maxEvents);
      }
    },
    snapshot(sessionId) {
      if (!sessionId) {
        return [...events];
      }
      return events.filter((event) => event.session_id === sessionId);
    }
  };
}
