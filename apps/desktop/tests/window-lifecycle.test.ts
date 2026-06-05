import { describe, expect, it } from "vitest";

import { shouldCreateWindowAtStartup, shouldRevealWindowOnReady } from "../src/main/window-lifecycle";
import { CONTROL_WINDOW_PRESET, OVERLAY_WINDOW_PRESET } from "../src/main/window-config";

describe("桌面窗口显示生命周期", () => {
  it("启动时只创建控制面板，不创建悬浮字幕窗", () => {
    expect(shouldCreateWindowAtStartup(CONTROL_WINDOW_PRESET)).toBe(true);
    expect(shouldCreateWindowAtStartup(OVERLAY_WINDOW_PRESET)).toBe(false);
  });

  it("控制面板在渲染就绪后显示", () => {
    expect(shouldRevealWindowOnReady(CONTROL_WINDOW_PRESET, false)).toBe(true);
  });

  it("悬浮字幕窗启动时保持隐藏，只有用户请求后才显示", () => {
    expect(shouldRevealWindowOnReady(OVERLAY_WINDOW_PRESET, false)).toBe(false);
    expect(shouldRevealWindowOnReady(OVERLAY_WINDOW_PRESET, true)).toBe(true);
  });
});
