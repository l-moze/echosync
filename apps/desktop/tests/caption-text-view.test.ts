import { describe, expect, it } from "vitest";

import { selectCaptionTextParts } from "../src/shared/caption-text-view";
import type { CaptionLine } from "../src/shared/caption-store";
import { defaultSubtitleStyle } from "../src/shared/subtitle-style-state";

describe("字幕文本视图", () => {
  it("默认双语字幕按源文在上、译文在下输出", () => {
    const parts = selectCaptionTextParts(
      line({
        sourceText: "action generation",
        targetText: "动作生成"
      }),
      defaultSubtitleStyle
    );

    expect(parts.map((part) => part.kind)).toEqual(["source", "target"]);
    expect(parts.map((part) => part.text)).toEqual(["action generation", "动作生成"]);
  });

  it("译文尚未返回时保留译文行槽位，但不显示正在翻译占位", () => {
    const parts = selectCaptionTextParts(
      line({
        sourceText: "So another option",
        targetText: ""
      }),
      defaultSubtitleStyle
    );

    expect(parts.map((part) => part.kind)).toEqual(["source", "target"]);
    expect(parts.map((part) => part.text)).toEqual(["So another option", ""]);
    expect(parts[1].isPlaceholder).toBe(true);
    expect(parts.some((part) => part.text.includes("正在翻译"))).toBe(false);
  });
});

function line(patch: Partial<CaptionLine>): CaptionLine {
  return {
    id: "seg",
    rev: 1,
    state: "interim",
    sourceText: "",
    targetText: "",
    stability: 0.8,
    startMs: 0,
    endMs: 1000,
    patchCount: 0,
    ...patch
  };
}
