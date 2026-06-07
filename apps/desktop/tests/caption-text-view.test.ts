import { describe, expect, it } from "vitest";

import { selectCaptionTextBlocks, selectCaptionTextParts } from "../src/shared/caption-text-view";
import type { CaptionLine } from "../src/shared/caption-store";
import { defaultSubtitleStyle, type SubtitleStyleState } from "../src/shared/subtitle-style-state";

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

  it("无音频时使用中文等待占位", () => {
    const parts = selectCaptionTextParts(undefined, defaultSubtitleStyle);

    expect(parts.map((part) => part.text)).toEqual([
      "等待音频输入...",
      "等待 Windows 系统声音或麦克风输入"
    ]);
  });

  it("逐句对照会把超长实时段按句子和字符阈值拆成双语显示块", () => {
    const blocks = selectCaptionTextBlocks(
      line({
        sourceText:
          "I've been talking about this framework that I've been building in the past about neural symbolic concepts to enable more data efficient learning and better generalization I would say this is a new bet for generally intelligent systems.",
        targetText:
          "我一直在谈论我过去一直在构建的关于神经符号概念的框架，以使你知道更多的数据高效学习和更好的泛化。我想说这是一个新的赌注。"
      }),
      defaultSubtitleStyle
    );

    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks[0].sourceText).toContain("neural symbolic concepts");
    expect(blocks[1].sourceText).toContain("I would say");
    expect(blocks[0].targetText).toContain("更好的泛化");
    expect(blocks[1].targetText).toContain("新的赌注");
  });

  it("分区对照保留单个源文区和译文区，不按逐句块拆分", () => {
    const blocks = selectCaptionTextBlocks(
      line({
        sourceText:
          "Each other to get a model that can support probable segmentation that is you can give it arbitrary text instructions and it can give",
        targetText: "互相得到一个可以支持的模型。提示分割，也就是说，你可以给它任意的文本指令。"
      }),
      style({ displayMode: "zonedPair" })
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0].sourceText).toContain("probable segmentation");
    expect(blocks[0].targetText).toContain("提示分割");
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

function style(patch: Partial<SubtitleStyleState>): SubtitleStyleState {
  return { ...defaultSubtitleStyle, ...patch };
}
