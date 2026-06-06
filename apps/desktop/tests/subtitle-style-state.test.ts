import { describe, expect, it } from "vitest";

import {
  defaultSubtitleStyle,
  captionStateDisplayLabel,
  normalizeSubtitleDisplayMode,
  reduceSubtitleStyleState,
  selectSubtitleFontWeight,
  subtitleDisplayModeLabel,
  type SubtitleDisplayMode
} from "../src/shared/subtitle-style-state";

describe("字幕样式共享状态", () => {
  it("默认使用逐句对照，符合实时悬浮字幕的中英对照主场景", () => {
    expect(defaultSubtitleStyle.displayMode).toBe("sentencePair");
  });

  it("默认双语模式先显示源文，再显示译文", () => {
    expect(defaultSubtitleStyle.translationFirst).toBe(false);
  });

  it("默认提供独立的窗口阴影强度，不复用文字描边设置", () => {
    expect(defaultSubtitleStyle.windowShadow).toBeGreaterThan(0);
    expect(defaultSubtitleStyle.windowShadow).toBeLessThanOrEqual(1);
    expect(defaultSubtitleStyle.outlineStyle).toBe("shadow");
  });

  it("支持逐句对照和分区对照两种双语显示模式", () => {
    const modes: SubtitleDisplayMode[] = ["sentencePair", "zonedPair"];

    expect(modes).toEqual(["sentencePair", "zonedPair"]);
  });

  it("显示模式使用面向用户的中文文案", () => {
    expect(subtitleDisplayModeLabel("sentencePair")).toBe("逐句对照");
    expect(subtitleDisplayModeLabel("zonedPair")).toBe("分区对照");
  });

  it("字幕状态标签不暴露内部英文枚举", () => {
    expect(captionStateDisplayLabel("interim")).toBe("临时");
    expect(captionStateDisplayLabel("stable")).toBe("稳定");
    expect(captionStateDisplayLabel("revised")).toBe("已修订");
    expect(captionStateDisplayLabel("locked")).toBe("已锁定");
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

  it("窗口阴影强度可以独立更新", () => {
    const next = reduceSubtitleStyleState(defaultSubtitleStyle, {
      windowShadow: 0.24
    });

    expect(next.windowShadow).toBe(0.24);
    expect(next.outlineStyle).toBe(defaultSubtitleStyle.outlineStyle);
  });

  it("为主字幕和翻译字幕提供有明显差异的常规/加粗字重", () => {
    expect(selectSubtitleFontWeight("source", false)).toBe(400);
    expect(selectSubtitleFontWeight("source", true)).toBe(800);
    expect(selectSubtitleFontWeight("target", false)).toBe(500);
    expect(selectSubtitleFontWeight("target", true)).toBe(850);
  });

  it("兼容旧版显示模式配置并归一到逐句对照", () => {
    expect(normalizeSubtitleDisplayMode("line")).toBe("sentencePair");
    expect(normalizeSubtitleDisplayMode("split")).toBe("sentencePair");
    expect(normalizeSubtitleDisplayMode("bilingual")).toBe("sentencePair");
    expect(normalizeSubtitleDisplayMode("source")).toBe("sentencePair");
    expect(normalizeSubtitleDisplayMode("translation")).toBe("sentencePair");
    expect(normalizeSubtitleDisplayMode("zonedPair")).toBe("zonedPair");
  });
});
