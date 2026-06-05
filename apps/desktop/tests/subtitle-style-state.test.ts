import { describe, expect, it } from "vitest";

import { defaultSubtitleStyle, reduceSubtitleStyleState } from "../src/shared/subtitle-style-state";

describe("字幕样式共享状态", () => {
  it("默认使用双栏字幕，符合实时悬浮字幕的中英对照主场景", () => {
    expect(defaultSubtitleStyle.displayMode).toBe("split");
  });

  it("合并局部样式更新并保留其他字段", () => {
    const next = reduceSubtitleStyleState(defaultSubtitleStyle, {
      targetScale: 34,
      targetColor: "#f8e38c"
    });

    expect(next.targetScale).toBe(34);
    expect(next.targetColor).toBe("#f8e38c");
    expect(next.sourceScale).toBe(defaultSubtitleStyle.sourceScale);
  });
});
