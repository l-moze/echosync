import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve(__dirname, "../src/renderer/styles.css"), "utf8");
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

describe("字幕弹窗样式契约", () => {
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

  it("resize 手柄不绘制独立矩形角标", () => {
    expect(stylesheet).not.toContain(".resize-se::after");
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
