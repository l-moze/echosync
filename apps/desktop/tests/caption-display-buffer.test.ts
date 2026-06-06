import { describe, expect, it } from "vitest";

import {
  createInitialCaptionDisplayBuffer,
  selectDisplayCaptionLines,
  type CaptionDisplayBuffer
} from "../src/shared/caption-display-buffer";
import type { CaptionLine } from "../src/shared/caption-store";

describe("字幕显示视觉合成器", () => {
  it("保存完整 desired 文本，但 visible 文本按打字机节奏从左到右追赶", () => {
    const desired = [line({ id: "seg_1", sourceText: "Hello", targetText: "测试字幕" })];
    const initial = selectDisplayCaptionLines(createInitialCaptionDisplayBuffer(), desired, 1000);

    expect(initial.desiredLines[0].targetText).toBe("测试字幕");
    expect(initial.lines[0].targetText).toBe("测");
    expect(initial.pendingLineIds).toEqual(["seg_1"]);

    const second = selectDisplayCaptionLines(initial.buffer, desired, 1036);
    const final = selectDisplayCaptionLines(second.buffer, desired, 1144);

    expect(second.lines[0].targetText).toBe("测试");
    expect(final.lines[0].targetText).toBe("测试字幕");
    expect(final.pendingLineIds).toEqual([]);
  });

  it("原文和译文使用独立队列，译文允许慢半拍但不显示占位", () => {
    const desired = [line({ id: "seg_1", sourceText: "More machine learning", targetText: "更多机器学习组件。" })];

    const first = selectDisplayCaptionLines(createInitialCaptionDisplayBuffer(), desired, 1000);
    const second = selectDisplayCaptionLines(first.buffer, desired, 1024);

    expect(first.lines[0].sourceText).toBe("M");
    expect(first.lines[0].targetText).toBe("更");
    expect(second.lines[0].sourceText.length).toBeGreaterThan(second.lines[0].targetText.length);
    expect(second.lines[0].targetText).not.toContain("正在翻译");
    expect(second.pendingLineIds).toEqual(["seg_1"]);
  });

  it("同一 segment 修订时保留公共前缀，只让新尾部进入可见队列", () => {
    const buffer: CaptionDisplayBuffer = {
      entries: {
        seg_1: {
          phase: "active",
          source: {
            desiredText: "I am testing",
            visibleText: "I am testing",
            lastTypedAtMs: 1000,
            revisedUntilMs: null
          },
          target: {
            desiredText: "我正在册",
            visibleText: "我正在册",
            lastTypedAtMs: 1000,
            revisedUntilMs: null
          },
          firstSeenAtMs: 1000,
          lastVisibleAtMs: 1000,
          settledAtMs: null
        }
      }
    };

    const patched = selectDisplayCaptionLines(
      buffer,
      [line({ id: "seg_1", sourceText: "I am testing", targetText: "我正在测试", rev: 2, state: "revised" })],
      1040
    );

    expect(patched.lines[0].targetText).toBe("我正在测");
    expect(patched.buffer.entries.seg_1.target.desiredText).toBe("我正在测试");
    expect(patched.buffer.entries.seg_1.target.revisedUntilMs).toBe(3040);

    const final = selectDisplayCaptionLines(patched.buffer, [line({ id: "seg_1", targetText: "我正在测试", rev: 2 })], 1080);

    expect(final.lines[0].targetText).toBe("我正在测试");
  });

  it("locked 行先进入 settling 并 flush 最终文本，不立即滚入 history", () => {
    const partial = selectDisplayCaptionLines(
      createInitialCaptionDisplayBuffer(),
      [line({ id: "seg_1", sourceText: "Final", targetText: "最终", state: "stable" })],
      1000
    );

    const committed = selectDisplayCaptionLines(
      partial.buffer,
      [line({ id: "seg_1", sourceText: "Final line.", targetText: "最终字幕。", state: "locked" })],
      1020
    );

    expect(committed.lines[0].sourceText).toBe("Final line.");
    expect(committed.lines[0].targetText).toBe("最终字幕。");
    expect(committed.buffer.entries.seg_1.phase).toBe("settling");
    expect(committed.buffer.entries.seg_1.settledAtMs).toBe(1020);
  });
});

function line(patch: Partial<CaptionLine>): CaptionLine {
  return {
    id: "seg",
    rev: 1,
    state: "stable",
    sourceText: "Hello",
    targetText: "",
    stability: 0.8,
    startMs: 0,
    endMs: 1000,
    patchCount: 0,
    ...patch
  };
}
