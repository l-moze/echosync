import { describe, expect, it } from "vitest";

import {
  reduceOverlayWindowState,
  selectOverlayWindowLayout,
  selectSubtitleStyleWindowLayout
} from "../src/main/overlay-window-state";

describe("悬浮字幕窗主进程行为", () => {
  it("锁定穿透时忽略鼠标并转发 hover 事件给系统", () => {
    const state = reduceOverlayWindowState(
      { visible: false, pinned: false, ignoreMouse: false },
      {
        type: "overlay.locked",
        locked: true
      }
    );

    expect(state.ignoreMouse).toBe(true);
  });

  it("Pin 后必须保持可交互", () => {
    const state = reduceOverlayWindowState(
      { visible: true, pinned: false, ignoreMouse: true },
      {
        type: "overlay.pinned",
        pinned: true
      }
    );

    expect(state.pinned).toBe(true);
    expect(state.ignoreMouse).toBe(false);
  });

  it("fallback 唤醒后显示弹窗并取消穿透", () => {
    const state = reduceOverlayWindowState(
      { visible: false, pinned: false, ignoreMouse: true },
      {
        type: "overlay.wake_controls"
      }
    );

    expect(state.visible).toBe(true);
    expect(state.ignoreMouse).toBe(false);
  });

  it("样式设置不应该撑大字幕 overlay 窗口", () => {
    const defaultLayout = selectOverlayWindowLayout("default");
    const controlsLayout = selectOverlayWindowLayout("controls");
    const settingsLayout = selectOverlayWindowLayout("settings");
    const pinnedLayout = selectOverlayWindowLayout("pinned");

    expect(defaultLayout.height).toBeLessThanOrEqual(150);
    expect(controlsLayout.height).toBeGreaterThan(defaultLayout.height);
    expect(settingsLayout).toEqual(controlsLayout);
    expect(pinnedLayout.height).toBeGreaterThan(controlsLayout.height);
  });

  it("聚焦和驻留态必须给历史字幕列表保留滚动空间", () => {
    const controlsLayout = selectOverlayWindowLayout("controls");
    const pinnedLayout = selectOverlayWindowLayout("pinned");

    expect(controlsLayout.height).toBeGreaterThanOrEqual(380);
    expect(pinnedLayout.height).toBeGreaterThanOrEqual(500);
  });

  it("字幕样式编辑器使用独立小窗口尺寸", () => {
    const layout = selectSubtitleStyleWindowLayout();

    expect(layout.width).toBe(360);
    expect(layout.height).toBe(420);
  });
});
