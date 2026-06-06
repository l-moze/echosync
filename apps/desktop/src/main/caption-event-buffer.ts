import type { RealtimeEvent } from "../shared/realtime-events";

export type CaptionEventBuffer = {
  push: (event: RealtimeEvent) => void;
  snapshot: () => RealtimeEvent[];
};

export function createCaptionEventBuffer(maxEvents = 50): CaptionEventBuffer {
  const events: RealtimeEvent[] = [];

  return {
    push(event) {
      if (event.type === "tts.audio") {
        return;
      }
      events.push(event);
      if (events.length > maxEvents) {
        events.splice(0, events.length - maxEvents);
      }
    },
    snapshot() {
      return [...events];
    }
  };
}
