import { describe, expect, it } from "vitest";

import {
  createInitialCaptionTextBlockBuffer,
  selectBufferedCaptionTextBlocks,
  selectCaptionTextBlocks,
  selectCaptionTextParts
} from "../src/shared/caption-text-view";
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

  it("逐句对照超过三行长度后先保留反应时间，再拆成稳定视觉块", () => {
    const longLine = line({
      sourceText:
        "I've been talking about this framework that I've been building in the past about neural symbolic concepts to enable more data efficient learning and better generalization I would say this is a new bet for generally intelligent systems.",
      targetText:
        "我一直在谈论我过去一直在构建的关于神经符号概念的框架，以使更多的数据高效学习和更好的泛化。我想说这是一个新的赌注。"
    });
    const first = selectBufferedCaptionTextBlocks(
      createInitialCaptionTextBlockBuffer(),
      longLine,
      defaultSubtitleStyle,
      1000
    );

    expect(first.blocks).toHaveLength(1);
    expect(first.pending).toBe(true);

    const stillReading = selectBufferedCaptionTextBlocks(first.buffer, longLine, defaultSubtitleStyle, 1600);

    expect(stillReading.blocks).toHaveLength(1);
    expect(stillReading.pending).toBe(true);

    const split = selectBufferedCaptionTextBlocks(stillReading.buffer, longLine, defaultSubtitleStyle, 1900);

    expect(split.blocks.length).toBeGreaterThanOrEqual(2);
    expect(split.pending).toBe(false);
    expect(split.blocks[0].id).toBe("seg:visual:0");
    expect(split.blocks[1].id).toBe("seg:visual:1");
    expect(split.blocks[0].sourceText).toContain("neural symbolic concepts");
    expect(split.blocks[1].sourceText).toContain("I would say");
  });

  it("视觉块拆分后冻结前段边界，后续实时追加不会重排已读内容", () => {
    const initialText =
      "I've been talking about this framework that I've been building in the past about neural symbolic concepts to enable more data efficient learning and better generalization I would say this is a new bet for generally intelligent systems.";
    const appendedText = `${initialText} And now we can look at the practical subtitle behavior in a streaming user interface.`;
    const first = selectBufferedCaptionTextBlocks(
      createInitialCaptionTextBlockBuffer(),
      line({ sourceText: initialText, targetText: "" }),
      defaultSubtitleStyle,
      1000
    );
    const split = selectBufferedCaptionTextBlocks(
      first.buffer,
      line({ sourceText: initialText, targetText: "" }),
      defaultSubtitleStyle,
      2000
    );
    const firstBlockBeforeAppend = split.blocks[0].sourceText;

    const afterAppend = selectBufferedCaptionTextBlocks(
      split.buffer,
      line({ sourceText: appendedText, targetText: "" }),
      defaultSubtitleStyle,
      2100
    );

    expect(afterAppend.blocks[0].sourceText).toBe(firstBlockBeforeAppend);
    expect(afterAppend.blocks.at(-1)?.sourceText).toContain("streaming user interface");
  });

  it("译文迟到或修订时不移动已经冻结的原文视觉边界", () => {
    const sourceText =
      "I've been talking about this framework that I've been building in the past about neural symbolic concepts to enable more data efficient learning and better generalization I would say this is a new bet for generally intelligent systems.";
    const targetText =
      "我一直在谈论这个框架，它关于神经符号概念，能够带来更高的数据效率和更好的泛化能力。我想说这是通向通用智能系统的新尝试。";
    const first = selectBufferedCaptionTextBlocks(
      createInitialCaptionTextBlockBuffer(),
      line({ sourceText, targetText: "" }),
      defaultSubtitleStyle,
      1000
    );
    const sourceSplit = selectBufferedCaptionTextBlocks(
      first.buffer,
      line({ sourceText, targetText: "" }),
      defaultSubtitleStyle,
      2000
    );
    const firstSourceBlock = sourceSplit.blocks[0].sourceText;

    const withTranslation = selectBufferedCaptionTextBlocks(
      sourceSplit.buffer,
      line({ sourceText, targetText, state: "revised", rev: 2 }),
      defaultSubtitleStyle,
      2100
    );

    expect(withTranslation.blocks[0].sourceText).toBe(firstSourceBlock);
    expect(withTranslation.blocks[0].targetText).toContain("神经符号概念");
    expect(withTranslation.blocks[1].sourceText).toContain("I would say");
  });

  it("连续超长实时段会分批成熟拆分，不等待下一次 ASR token 才继续整理", () => {
    const sourceText = [
      "I've been talking about this framework that I've been building in the past about neural symbolic concepts to enable more data efficient learning and better generalization",
      "I would say this is a new bet for generally intelligent systems because it lets us combine symbolic constraints with neural representations",
      "And now we can look at the practical subtitle behavior in a streaming user interface where readers need enough time to understand each part"
    ].join(" ");
    const first = selectBufferedCaptionTextBlocks(
      createInitialCaptionTextBlockBuffer(),
      line({ sourceText, targetText: "" }),
      defaultSubtitleStyle,
      1000
    );
    const firstSplit = selectBufferedCaptionTextBlocks(
      first.buffer,
      line({ sourceText, targetText: "" }),
      defaultSubtitleStyle,
      1900
    );

    expect(firstSplit.blocks).toHaveLength(2);
    expect(firstSplit.pending).toBe(true);

    const secondSplit = selectBufferedCaptionTextBlocks(
      firstSplit.buffer,
      line({ sourceText, targetText: "" }),
      defaultSubtitleStyle,
      2800
    );

    expect(secondSplit.blocks.length).toBeGreaterThanOrEqual(3);
    expect(secondSplit.blocks[0].sourceText).toContain("neural symbolic concepts");
    expect(secondSplit.blocks[1].sourceText).toContain("generally intelligent systems");
    expect(secondSplit.blocks[2].sourceText).toContain("streaming user interface");
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
