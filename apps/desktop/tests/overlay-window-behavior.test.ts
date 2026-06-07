import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

const mainSource = readFileSync(resolve(__dirname, "../src/main/main.ts"), "utf8");

describe("悬浮字幕窗主进程行为", () => {
  it("锁定穿透时忽略鼠标并转发 hover 事件给系统", () => {
    const state = reduceOverlayWindowState(
      { visible: false, pinned: false, locked: false, ignoreMouse: false },
      {
        type: "overlay.locked",
        locked: true
      }
    );

    expect(state.locked).toBe(true);
    expect(state.ignoreMouse).toBe(true);
  });

  it("Pin 后必须保持可交互", () => {
    const state = reduceOverlayWindowState(
      { visible: true, pinned: false, locked: true, ignoreMouse: true },
      {
        type: "overlay.pinned",
        pinned: true
      }
    );

    expect(state.pinned).toBe(true);
    expect(state.ignoreMouse).toBe(false);
  });

  it("取消 Pin 后按锁定意图恢复穿透", () => {
    const state = reduceOverlayWindowState(
      { visible: true, pinned: true, locked: true, ignoreMouse: false },
      {
        type: "overlay.pinned",
        pinned: false
      }
    );

    expect(state.pinned).toBe(false);
    expect(state.ignoreMouse).toBe(true);
  });

  it("fallback 唤醒后显示弹窗并取消穿透", () => {
    const state = reduceOverlayWindowState(
      { visible: false, pinned: false, locked: true, ignoreMouse: true },
      {
        type: "overlay.wake_controls"
      }
    );

    expect(state.visible).toBe(true);
    expect(state.ignoreMouse).toBe(false);
  });

  it("快捷键唤醒设置态后显示弹窗并取消穿透", () => {
    const state = reduceOverlayWindowState(
      { visible: false, pinned: false, locked: true, ignoreMouse: true },
      {
        type: "overlay.wake_settings"
      }
    );

    expect(state.visible).toBe(true);
    expect(state.ignoreMouse).toBe(false);
  });

  it("恢复字幕窗时必须先还原 minimized 状态再显示", () => {
    expect(mainSource).toContain("function revealWindowInactive");
    expect(mainSource).toContain("window.isMinimized()");
    expect(mainSource).toContain("window.restore()");
    expect(mainSource).toContain("revealWindowInactive(window);");
  });

  it("设置和控制 layer 必须强制可交互，回默认态再按锁定恢复穿透", () => {
    const controlsState = reduceOverlayWindowState(
      { visible: true, pinned: false, locked: true, ignoreMouse: true },
      {
        type: "overlay.layer",
        layer: "controls"
      }
    );
    const settingsState = reduceOverlayWindowState(controlsState, {
      type: "overlay.layer",
      layer: "settings"
    });
    const defaultState = reduceOverlayWindowState(settingsState, {
      type: "overlay.layer",
      layer: "default"
    });

    expect(controlsState.ignoreMouse).toBe(false);
    expect(settingsState.ignoreMouse).toBe(false);
    expect(defaultState.ignoreMouse).toBe(true);
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

  it("Ctrl+Shift+S 直达设置态，Alt+Shift+S 保留控制态兼容", () => {
    expect(mainSource).toContain('globalShortcut.register("CommandOrControl+Shift+S"');
    expect(mainSource).toContain("wakeOverlaySettings()");
    expect(mainSource).toContain('sendToWindow(window, "overlay:wake-settings")');
    expect(mainSource).toContain('globalShortcut.register("Alt+Shift+S"');
    expect(mainSource).toContain("wakeOverlayControls()");
  });

  it("用户调整后的 overlay 尺寸在各 layer 之间共享，并按 layer 最小尺寸夹取", () => {
    const resized = reduceOverlayWindowSizeState(
      createDefaultOverlayWindowSizeState(),
      "controls",
      { width: 900, height: 330 }
    );

    expect(selectOverlayWindowLayout("default", resized)).toEqual({ width: 900, height: 330 });
    expect(selectOverlayWindowLayout("controls", resized)).toEqual({ width: 900, height: 330 });
    expect(selectOverlayWindowLayout("settings", resized)).toEqual({ width: 900, height: 330 });
    expect(selectOverlayWindowLayout("pinned", resized)).toEqual({ width: 900, height: 420 });
  });

  it("设置态调整窗口大小后退出到默认态不回弹", () => {
    const resized = reduceOverlayWindowSizeState(
      createDefaultOverlayWindowSizeState(),
      "settings",
      { width: 960, height: 360 }
    );

    expect(selectOverlayWindowLayout("default", resized)).toEqual({ width: 960, height: 360 });
    expect(selectOverlayWindowLayout("controls", resized)).toEqual({ width: 960, height: 360 });
    expect(selectOverlayWindowLayout("settings", resized)).toEqual({ width: 960, height: 360 });
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
