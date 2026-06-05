import { describe, expect, it } from "vitest";

import {
  createInitialCaptionDisplayBuffer,
  selectDisplayCaptionLines,
  type CaptionDisplayBuffer
} from "../src/shared/caption-display-buffer";
import type { CaptionLine } from "../src/shared/caption-store";

describe("字幕显示缓冲", () => {
  it("初始短译文收到后立即显示，语义合帧由 Agent 输出侧负责", () => {
    const desired = [line({ id: "seg_1", targetText: "大" })];
    const buffer = createInitialCaptionDisplayBuffer();

    const next = selectDisplayCaptionLines(buffer, desired, 1000);

    expect(next.lines[0].targetText).toBe("大");
    expect(next.pendingLineIds).toEqual([]);
  });

  it("短译文超过首帧等待时间后显示，避免永久卡住", () => {
    const desired = [line({ id: "seg_1", targetText: "大" })];
    const initial = selectDisplayCaptionLines(createInitialCaptionDisplayBuffer(), desired, 1000);

    const next = selectDisplayCaptionLines(initial.buffer, desired, 1150);

    expect(next.lines[0].targetText).toBe("大");
    expect(next.pendingLineIds).toEqual([]);
  });

  it("短语到达后立即显示首条可读译文", () => {
    const buffer = createInitialCaptionDisplayBuffer();
    const short = selectDisplayCaptionLines(buffer, [line({ id: "seg_1", targetText: "大" })], 1000);

    const next = selectDisplayCaptionLines(short.buffer, [line({ id: "seg_1", targetText: "大家好，欢迎" })], 1030);

    expect(next.lines[0].targetText).toBe("大家好，欢迎");
  });

  it("已有译文的短增量立即显示，避免前端比 stream 返回更慢", () => {
    const visible: CaptionDisplayBuffer = {
      entries: {
        seg_1: {
          targetText: "大家好",
          sourceText: "Hello everyone",
          firstSeenAtMs: 1000,
          lastVisibleAtMs: 1000
        }
      }
    };
    const desired = [line({ id: "seg_1", sourceText: "Hello everyone", targetText: "大家好呀" })];

    const held = selectDisplayCaptionLines(visible, desired, 1040);

    expect(held.lines[0].targetText).toBe("大家好呀");
    expect(held.pendingLineIds).toEqual([]);
  });

  it("长增量立即展示完整事件文本，不在前端二次语义切块", () => {
    const visible: CaptionDisplayBuffer = {
      entries: {
        seg_1: {
          targetText: "大家好",
          sourceText: "Hello everyone",
          firstSeenAtMs: 1000,
          lastVisibleAtMs: 1000
        }
      }
    };
    const desired = [line({ id: "seg_1", targetText: "大家好，欢迎来到今天的课程" })];

    const next = selectDisplayCaptionLines(visible, desired, 1030);

    expect(next.lines[0].targetText).toBe(desired[0].targetText);
    expect(next.pendingLineIds).toEqual([]);
  });

  it("committed 行立即显示最终译文", () => {
    const desired = [line({ id: "seg_1", targetText: "最终译文", state: "locked" })];

    const next = selectDisplayCaptionLines(createInitialCaptionDisplayBuffer(), desired, 1000);

    expect(next.lines[0].targetText).toBe("最终译文");
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
