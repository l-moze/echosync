import { describe, expect, it } from "vitest";

import {
  createDefaultOverlayWindowSizeState,
  reduceOverlayWindowSizeState,
  reduceOverlayWindowState,
  selectOverlayResizeBounds,
  selectOverlayWindowLayout,
  selectSubtitleStyleWindowLayout
} from "../src/main/overlay-window-state";
import { OVERLAY_WINDOW_PRESET } from "../src/main/window-config";

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

  it("聚焦态保持紧凑，避免透明窗口露出大块空白", () => {
    const controlsLayout = selectOverlayWindowLayout("controls");

    expect(controlsLayout.height).toBeLessThanOrEqual(280);
  });

  it("驻留态必须给历史字幕列表保留滚动空间", () => {
    const pinnedLayout = selectOverlayWindowLayout("pinned");

    expect(pinnedLayout.height).toBeGreaterThanOrEqual(460);
  });

  it("字幕 overlay 窗口不使用系统 resize 边框和系统阴影", () => {
    expect(OVERLAY_WINDOW_PRESET.resizable).toBe(false);
    expect(OVERLAY_WINDOW_PRESET.hasShadow).toBe(false);
  });

  it("用户调整后的 overlay 宽度在各 layer 之间共享，高度按 layer 保存", () => {
    const resized = reduceOverlayWindowSizeState(
      createDefaultOverlayWindowSizeState(),
      "controls",
      { width: 900, height: 330 }
    );

    expect(selectOverlayWindowLayout("default", resized).width).toBe(900);
    expect(selectOverlayWindowLayout("controls", resized)).toEqual({ width: 900, height: 330 });
    expect(selectOverlayWindowLayout("pinned", resized).height).toBeGreaterThanOrEqual(460);
  });

  it("自定义 resize 会按当前 layer 最小尺寸和屏幕工作区夹取 bounds", () => {
    const bounds = selectOverlayResizeBounds({
      currentBounds: { x: 100, y: 100, width: 1120, height: 260 },
      layer: "controls",
      requestedBounds: { x: -200, y: -200, width: 300, height: 80 },
      workArea: { x: 0, y: 0, width: 1366, height: 768 }
    });

    expect(bounds.width).toBeGreaterThanOrEqual(760);
    expect(bounds.height).toBeGreaterThanOrEqual(260);
    expect(bounds.x).toBeGreaterThanOrEqual(24);
    expect(bounds.y).toBeGreaterThanOrEqual(24);
  });

  it("自定义 resize 不允许窗口超过当前屏幕工作区", () => {
    const bounds = selectOverlayResizeBounds({
      currentBounds: { x: 100, y: 100, width: 1120, height: 260 },
      layer: "pinned",
      requestedBounds: { width: 3000, height: 2000 },
      workArea: { x: 0, y: 0, width: 1366, height: 768 }
    });

    expect(bounds.width).toBeLessThanOrEqual(1318);
    expect(bounds.height).toBeLessThanOrEqual(720);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1342);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(744);
  });

  it("从左上角缩放到最小尺寸时保持右下锚点稳定", () => {
    const bounds = selectOverlayResizeBounds({
      currentBounds: { x: 100, y: 120, width: 900, height: 330 },
      layer: "controls",
      requestedBounds: { x: 260, y: 210, width: 740, height: 240 },
      workArea: { x: 0, y: 0, width: 1366, height: 768 }
    });

    expect(bounds.width).toBe(760);
    expect(bounds.height).toBe(260);
    expect(bounds.x + bounds.width).toBe(1000);
    expect(bounds.y + bounds.height).toBe(450);
  });

  it("字幕样式编辑器使用独立小窗口尺寸", () => {
    const layout = selectSubtitleStyleWindowLayout();

    expect(layout.width).toBe(360);
    expect(layout.height).toBe(420);
  });
});
