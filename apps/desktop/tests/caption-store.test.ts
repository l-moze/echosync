import { describe, expect, it } from "vitest";

import { applyRealtimeEvent } from "../src/shared/caption-store";
import type { CaptionLine } from "../src/shared/caption-store";

describe("桌面字幕状态机", () => {
  it("按 partial、patch、commit 更新同一个字幕片段", () => {
    const initialLines: CaptionLine[] = [];
    const withPartial = applyRealtimeEvent(initialLines, {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_1",
      rev: 1,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "GPU kernels reduce latency.",
      target_text: "GPU 核函数会降低延迟。",
      status: "partial",
      stability: 0.62,
      start_ms: 0,
      end_ms: 1800
    });

    const withPatch = applyRealtimeEvent(withPartial, {
      type: "translation.patch",
      session_id: "sess_demo",
      segment_id: "seg_1",
      rev: 2,
      base_rev: 1,
      target_lang: "zh-CN",
      operations: [{ op: "replace", from_char: 4, to_char: 7, text: "内核" }],
      reason: "terminology",
      stability: 0.86
    });

    const committed = applyRealtimeEvent(withPatch, {
      type: "segment.commit",
      session_id: "sess_demo",
      segment_id: "seg_1",
      rev: 2,
      start_ms: 0,
      end_ms: 1800,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "GPU kernels reduce latency.",
      target_text: "GPU 内核会降低延迟。",
      final: true
    });

    expect(committed).toEqual([
      {
        id: "seg_1",
        rev: 2,
        state: "locked",
        sourceText: "GPU kernels reduce latency.",
        targetText: "GPU 内核会降低延迟。",
        stability: 1,
        startMs: 0,
        endMs: 1800,
        patchCount: 1
      }
    ]);
  });

  it("源文 partial 更新不清空已有译文，避免打字机闪烁", () => {
    const initialLines: CaptionLine[] = [
      {
        id: "seg_live",
        rev: 2,
        state: "stable",
        sourceText: "This model",
        targetText: "这个模型",
        stability: 0.86,
        startMs: 0,
        endMs: 1000,
        patchCount: 0
      }
    ];

    const lines = applyRealtimeEvent(initialLines, {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_live",
      rev: 3,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "This model supports real time",
      target_text: "",
      status: "partial",
      stability: 0.7,
      start_ms: 0,
      end_ms: 1500
    });

    expect(lines[0].sourceText).toBe("This model supports real time");
    expect(lines[0].targetText).toBe("这个模型");
    expect(lines[0].state).toBe("interim");
  });
});
