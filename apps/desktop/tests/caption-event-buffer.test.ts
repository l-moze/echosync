import { describe, expect, it } from "vitest";

import { createCaptionEventBuffer } from "../src/main/caption-event-buffer";
import type { RealtimeEvent, SubtitleEvent } from "../src/shared/realtime-events";

const captionEvent: RealtimeEvent = {
  type: "translation.partial",
  session_id: "sess_buffer",
  segment_id: "seg_buffer",
  rev: 1,
  source_lang: "en",
  target_lang: "zh-CN",
  source_text: "The event arrived before the renderer loaded.",
  target_text: "事件在渲染器加载前到达。",
  status: "committed",
  stability: 1,
  start_ms: 0,
  end_ms: 1800
};

describe("主进程字幕事件缓存", () => {
  it("默认缓存足够覆盖一段真实测评的高频字幕事件，避免窗口迟开后只补最后几秒", () => {
    const buffer = createCaptionEventBuffer();

    for (let index = 0; index < 640; index += 1) {
      buffer.push({ ...captionEvent, segment_id: `seg_${index}` });
    }

    expect(buffer.snapshot()).toHaveLength(640);
    expect(buffer.snapshot().filter(isSubtitleEvent)[0].segment_id).toBe("seg_0");
  });

  it("保留最近事件，供窗口加载后重放", () => {
    const buffer = createCaptionEventBuffer(2);

    buffer.push({ ...captionEvent, segment_id: "seg_1" });
    buffer.push({ ...captionEvent, segment_id: "seg_2" });
    buffer.push({ ...captionEvent, segment_id: "seg_3" });

    expect(buffer.snapshot().filter(isSubtitleEvent).map((event) => event.segment_id)).toEqual([
      "seg_2",
      "seg_3"
    ]);
  });

  it("不缓存 TTS 音频事件，避免窗口重载时重复播放", () => {
    const buffer = createCaptionEventBuffer(2);

    buffer.push({
      type: "tts.audio",
      session_id: "sess_buffer",
      segment_id: "seg_voice",
      rev: 1,
      start_ms: 0,
      end_ms: 1200,
      target_lang: "zh-CN",
      audio_base64: "YXVkaW8=",
      mime_type: "audio/mpeg",
      sample_rate: null,
      final: true
    });

    expect(buffer.snapshot()).toEqual([]);
  });

  it("支持按会话快照和清理，避免新会话重放上一场字幕", () => {
    const buffer = createCaptionEventBuffer(5);

    buffer.push({ ...captionEvent, session_id: "sess_old", segment_id: "seg_old" });
    buffer.push({ ...captionEvent, session_id: "sess_new", segment_id: "seg_new" });

    expect(buffer.snapshot("sess_new").filter(isSubtitleEvent).map((event) => event.segment_id)).toEqual(["seg_new"]);

    buffer.clearSession("sess_old");

    expect(buffer.snapshot().filter(isSubtitleEvent).map((event) => event.segment_id)).toEqual(["seg_new"]);
  });
});

function isSubtitleEvent(event: RealtimeEvent): event is SubtitleEvent {
  return event.type === "translation.partial";
}
