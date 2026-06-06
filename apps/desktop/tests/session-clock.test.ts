import { describe, expect, it } from "vitest";

import { selectSessionClockMs } from "../src/shared/session-clock";

describe("字幕弹窗会话计时", () => {
  it("运行中没有字幕时按本地开始时间计时，不注入固定偏移", () => {
    expect(
      selectSessionClockMs({
        isListening: true,
        lines: [],
        nowMs: 1250,
        startedAtMs: 1000
      })
    ).toBe(250);
  });

  it("运行中计时不低于已有字幕时间戳", () => {
    expect(
      selectSessionClockMs({
        isListening: true,
        lines: [{ endMs: 3200 }],
        nowMs: 2500,
        startedAtMs: 1000
      })
    ).toBe(3200);
  });

  it("停止后使用字幕实际时长冻结", () => {
    expect(
      selectSessionClockMs({
        isListening: false,
        lines: [{ endMs: 1800 }, { endMs: 4200 }],
        nowMs: 9000,
        startedAtMs: 1000
      })
    ).toBe(4200);
  });
});
