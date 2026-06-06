import { describe, expect, it } from "vitest";

import {
  defaultSubtitleStyle,
  normalizeSubtitleDisplayMode,
  reduceSubtitleStyleState,
  type SubtitleDisplayMode
} from "../src/shared/subtitle-style-state";

describe("字幕样式共享状态", () => {
  it("默认使用双语双行字幕，符合实时悬浮字幕的中英对照主场景", () => {
    expect(defaultSubtitleStyle.displayMode).toBe("bilingual");
  });

  it("默认双语模式先显示源文，再显示译文", () => {
    expect(defaultSubtitleStyle.translationFirst).toBe(false);
  });

  it("默认提供独立的窗口阴影强度，不复用文字描边设置", () => {
    expect(defaultSubtitleStyle.windowShadow).toBeGreaterThan(0);
    expect(defaultSubtitleStyle.windowShadow).toBeLessThanOrEqual(1);
    expect(defaultSubtitleStyle.outlineStyle).toBe("shadow");
  });

  it("支持双语、主字幕、翻译字幕三种显示模式", () => {
    const modes: SubtitleDisplayMode[] = ["bilingual", "source", "translation"];

    expect(modes).toEqual(["bilingual", "source", "translation"]);
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

  it("兼容旧版 line/split 显示模式配置", () => {
    expect(normalizeSubtitleDisplayMode("line")).toBe("bilingual");
    expect(normalizeSubtitleDisplayMode("split")).toBe("bilingual");
  });
});
