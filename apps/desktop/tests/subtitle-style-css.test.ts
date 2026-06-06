import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesPath = fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url));

describe("字幕样式 CSS", () => {
  it("默认悬浮层的翻译字幕颜色沿用样式变量", () => {
    const css = readFileSync(stylesPath, "utf8");
    const defaultTargetRule = css.match(/\.overlayStage\.layer-default \.floatingCaption h1\s*{(?<body>[^}]+)}/);

    expect(defaultTargetRule?.groups?.body).toContain("var(--target-color");
  });

  it("默认悬浮字幕窗口贴满透明窗口，避免两端露出父层", () => {
    const css = readFileSync(stylesPath, "utf8");
    const defaultWindowRule = css.match(/\.overlayStage\.layer-default \.floatingCaption\s*{(?<body>[^}]+)}/);

    expect(defaultWindowRule?.groups?.body).toContain("width: 100%");
    expect(defaultWindowRule?.groups?.body).toContain("padding: 8px 24px 10px");
    expect(defaultWindowRule?.groups?.body).not.toContain("justify-self: center");
    expect(defaultWindowRule?.groups?.body).not.toContain("align-self: center");
  });
});
