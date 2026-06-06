import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve(__dirname, "../src/renderer/styles.css"), "utf8");
const overlayStylesheet = stylesheet
  .slice(stylesheet.indexOf("/* Overlay v2:"))
  .split("@media (max-width: 760px)")[0];

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return overlayStylesheet.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
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
});
