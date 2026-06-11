import type { RealtimeEvent } from "../shared/realtime-events";

export type CaptionEventBuffer = {
  clear: () => void;
  clearSession: (sessionId: string) => void;
  push: (event: RealtimeEvent) => void;
  snapshot: (sessionId?: string) => RealtimeEvent[];
};

export function createCaptionEventBuffer(maxEvents = 10000): CaptionEventBuffer {
  const events: RealtimeEvent[] = [];
  let droppedCount = 0;

  return {
    clear() {
      events.splice(0, events.length);
      droppedCount = 0;
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
        const removeCount = events.length - maxEvents;
        events.splice(0, removeCount);
        droppedCount += removeCount;

        // 警告：缓冲区溢出，内容可能丢失
        if (droppedCount % 100 === 0) {
          console.error(`[caption-event-buffer] 缓冲区溢出，已丢弃 ${droppedCount} 个事件！`);
        }
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
