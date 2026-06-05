import { describe, expect, it } from "vitest";

import { CONTROL_WINDOW_PRESET, OVERLAY_WINDOW_PRESET } from "../src/main/window-config";

describe("桌面窗口预设", () => {
  it("悬浮字幕窗是透明、无边框、置顶窗口", () => {
    expect(OVERLAY_WINDOW_PRESET.title).toBe("EchoSync 悬浮字幕");
    expect(OVERLAY_WINDOW_PRESET.show).toBe(false);
    expect(OVERLAY_WINDOW_PRESET.frame).toBe(false);
    expect(OVERLAY_WINDOW_PRESET.transparent).toBe(true);
    expect(OVERLAY_WINDOW_PRESET.alwaysOnTop).toBe(true);
    expect(OVERLAY_WINDOW_PRESET.skipTaskbar).toBe(true);
    expect(OVERLAY_WINDOW_PRESET.backgroundColor).toBe("#00000000");
  });

  it("悬浮字幕窗保持横向字幕条尺寸，避免退化成控制面板", () => {
    expect(OVERLAY_WINDOW_PRESET.width).toBeGreaterThanOrEqual(1080);
    expect(OVERLAY_WINDOW_PRESET.height).toBeLessThanOrEqual(150);
    expect(OVERLAY_WINDOW_PRESET.minHeight).toBeLessThanOrEqual(96);
  });

  it("主控窗口保留标准任务栏入口", () => {
    expect(CONTROL_WINDOW_PRESET.title).toBe("EchoSync 控制台");
    expect(CONTROL_WINDOW_PRESET.show).toBe(true);
    expect(CONTROL_WINDOW_PRESET.frame).toBe(false);
    expect(CONTROL_WINDOW_PRESET.transparent).toBe(false);
    expect(CONTROL_WINDOW_PRESET.skipTaskbar).toBe(false);
  });
});
