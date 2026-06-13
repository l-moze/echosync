import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { readStylesheetWithImports } from "./helpers/stylesheet";

const stylesheet = readStylesheetWithImports(resolve(__dirname, "../src/renderer/styles.css"));
const rendererSource = [
  "../src/renderer/main.tsx",
  "../src/renderer/components/caption/OverlayWindow.tsx",
  "../src/renderer/components/caption/OverlayResizeHandles.tsx",
  "../src/renderer/components/caption/OverlayToolbar.tsx",
  "../src/renderer/components/caption/OverlaySessionBar.tsx"
].map((path) => readFileSync(resolve(__dirname, path), "utf8")).join("\n");
const preOverlayStylesheet = stylesheet.slice(0, stylesheet.indexOf("/* Overlay v2:"));
const overlayStylesheet = stylesheet.slice(stylesheet.indexOf("/* Overlay v2:"));

function cssRule(selector: string): string {
  return cssRules(selector)[0] ?? "";
}

function cssRules(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...overlayStylesheet.matchAll(new RegExp(`(?:^|\\n|})\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"))].map(
    (match) => match[1],
  );
}

function rootCaptionWindowRules(): string[] {
  return [...stylesheet.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((match) =>
      match[1]
        .split(",")
        .some((selector) => /\.floatingCaption(?:[.:][\w-]+)*$/.test(selector.trim())),
    )
    .map((match) => match[2]);
}

function preOverlayRules(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...preOverlayStylesheet.matchAll(new RegExp(`(?:^|\\n|})\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"))].map(
    (match) => match[1],
  );
}

describe("字幕弹窗样式契约", () => {
  it("Overlay v2 之前不保留旧版 overlay 根选择器，避免后续样式覆盖和审查误判", () => {
    const staleSelectors = [
      ".overlayShell",
      ".floatingCaption",
      ".overlayMeta",
      ".overlaySource",
      ".overlayTarget",
      ".overlayStateBadge",
      ".focusMeter",
      ".overlayControls",
      ".pinnedCaptionStack",
      ".pinnedLine"
    ];

    for (const selector of staleSelectors) {
      expect(preOverlayRules(selector), selector).toHaveLength(0);
    }
  });

  it("overlay 父层不留可见或可点击的外边距", () => {
    expect(cssRule(".overlayShell")).toContain("padding: 0");
    expect(cssRule(".overlayShell")).toContain("pointer-events: none");
    expect(cssRule(".overlayStage")).toContain("width: 100%");
    expect(cssRule(".overlayStage")).toContain("pointer-events: none");
  });

  it("字幕窗口填满 BrowserWindow，避免透明父层遮盖底层应用", () => {
    expect(cssRule(".floatingCaption")).toContain("width: 100%");
    expect(cssRule(".floatingCaption")).toContain("height: 100%");
    expect(cssRule(".floatingCaption")).toContain("box-sizing: border-box");
  });

  it("默认态也不收窄字幕窗口，避免两端和边角露出父层", () => {
    const defaultCaptionRule = cssRule(".overlayStage.layer-default .floatingCaption");

    expect(defaultCaptionRule).toContain("width: 100%");
    expect(defaultCaptionRule).not.toMatch(/\bcalc\(100vw\s*-/);
    expect(defaultCaptionRule).not.toMatch(/\bwidth\s*:\s*min\(/);
    expect(defaultCaptionRule).not.toContain("align-self: center");
    expect(defaultCaptionRule).not.toContain("justify-self: center");
  });

  it("resize 手柄不绘制独立矩形角标", () => {
    expect(stylesheet).not.toContain(".resize-se::after");
  });

  it("字幕窗口本体保持稳定圆角，避免 hover 或 layer 切换时抖动", () => {
    const captionRules = rootCaptionWindowRules();

    expect(captionRules.length).toBeGreaterThan(0);
    for (const captionRule of captionRules) {
      const radiusValues = [...captionRule.matchAll(/\bborder-radius\s*:\s*([^;]+);/g)].map((match) => match[1].trim());
      expect(radiusValues.every((value) => value === "var(--caption-radius)")).toBe(true);
      const transitionValues = [...captionRule.matchAll(/\btransition\s*:\s*([^;]+);/g)].map((match) => match[1].trim());
      expect(transitionValues.every((value) => !/\bborder-radius\b/.test(value))).toBe(true);
    }
    expect(cssRule(".floatingCaption")).toContain("--caption-radius: 18px");
    expect(cssRule(".floatingCaption")).toContain("overflow: hidden");
  });

  it("resize 手柄始终渲染，不依赖工具栏显示状态", () => {
    expect(rendererSource).toContain("<OverlayResizeHandles");
    expect(rendererSource).not.toContain("showChrome ? <OverlayResizeHandles /> : null");
  });

  it("字幕弹窗不渲染内部状态徽标", () => {
    expect(overlayStylesheet).not.toContain(".overlayStateBadge");
    expect(rendererSource).not.toContain("overlayStateBadge");
    expect(rendererSource).toContain("逐句对照");
    expect(rendererSource).toContain("分区对照");
  });

  it("resize 手柄容器不覆盖全窗拖拽区域", () => {
    expect(cssRule(".overlayResizeHandles")).not.toContain("-webkit-app-region: no-drag");
    expect(cssRule(".resizeHandle")).toContain("-webkit-app-region: no-drag");
  });

  it("顶部工具组容器只负责布局，不绘制圆角外框", () => {
    const toolbarRules = cssRules(".overlayToolbar");

    expect(toolbarRules.length).toBeGreaterThan(0);
    for (const toolbarRule of toolbarRules) {
      expect(toolbarRule).not.toMatch(/\bborder\s*:/);
      expect(toolbarRule).not.toMatch(/\bborder-radius\s*:/);
      expect(toolbarRule).not.toMatch(/\bbackground\s*:/);
      expect(toolbarRule).not.toMatch(/\bbackdrop-filter\s*:/);
    }
  });

  it("底部会话工具组容器只负责布局，不绘制圆角外框", () => {
    const sessionBarRules = cssRules(".overlaySessionBar");

    expect(sessionBarRules.length).toBeGreaterThan(0);
    for (const sessionBarRule of sessionBarRules) {
      expect(sessionBarRule).not.toMatch(/\bborder\s*:/);
      expect(sessionBarRule).not.toMatch(/\bborder-radius\s*:/);
      expect(sessionBarRule).not.toMatch(/\bbackground\s*:/);
      expect(sessionBarRule).not.toMatch(/\bbackdrop-filter\s*:/);
    }
  });
});
