import { describe, expect, it } from "vitest";

import { reduceOverlayWindowState } from "../src/main/overlay-window-state";

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
});
