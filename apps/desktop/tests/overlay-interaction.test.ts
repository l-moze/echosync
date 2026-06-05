import { describe, expect, it } from "vitest";

import {
  createInitialOverlayInteractionState,
  getSafeExpandedBounds,
  reduceOverlayInteraction
} from "../src/shared/overlay-interaction";

describe("字幕弹窗分层交互状态机", () => {
  it("默认是穿透的 Layer A", () => {
    const state = createInitialOverlayInteractionState();

    expect(state.layer).toBe("default");
    expect(state.pointerMode).toBe("pass_through");
    expect(state.fallbackAwake).toBe(false);
  });

  it("快速划过不会唤醒 Hover 控制", () => {
    const pending = reduceOverlayInteraction(createInitialOverlayInteractionState(), {
      type: "pointer.entered",
      atMs: 1000
    });
    const stillDefault = reduceOverlayInteraction(pending, {
      type: "hover.timer.elapsed",
      atMs: 1120
    });

    expect(stillDefault.layer).toBe("default");
    expect(stillDefault.pointerMode).toBe("pass_through");
  });

  it("停留超过 hover intent 阈值后进入轻控制态", () => {
    const pending = reduceOverlayInteraction(createInitialOverlayInteractionState(), {
      type: "pointer.entered",
      atMs: 1000
    });
    const interactive = reduceOverlayInteraction(pending, {
      type: "hover.timer.elapsed",
      atMs: 1230
    });

    expect(interactive.layer).toBe("controls");
    expect(interactive.pointerMode).toBe("interactive");
  });

  it("进入轻控制态后离开不会立刻卸载控制面板", () => {
    const interactive = reduceOverlayInteraction(
      reduceOverlayInteraction(createInitialOverlayInteractionState(), {
        type: "pointer.entered",
        atMs: 1000
      }),
      {
        type: "hover.timer.elapsed",
        atMs: 1230
      }
    );
    const leaving = reduceOverlayInteraction(interactive, {
      type: "pointer.left",
      atMs: 1300
    });

    expect(leaving.layer).toBe("controls");
    expect(leaving.pointerMode).toBe("interactive");
    expect(leaving.collapseStartedAtMs).toBe(1300);
  });

  it("离开轻控制态超过宽限时间后才回到默认态", () => {
    const leaving = reduceOverlayInteraction(
      {
        ...createInitialOverlayInteractionState(),
        layer: "controls",
        pointerMode: "interactive",
        collapseStartedAtMs: 1300
      },
      {
        type: "collapse.timer.elapsed",
        atMs: 1700
      }
    );

    expect(leaving.layer).toBe("default");
    expect(leaving.pointerMode).toBe("pass_through");
  });

  it("离开后重新进入控制面板会取消收起", () => {
    const returned = reduceOverlayInteraction(
      {
        ...createInitialOverlayInteractionState(),
        layer: "controls",
        pointerMode: "interactive",
        collapseStartedAtMs: 1300
      },
      {
        type: "pointer.entered",
        atMs: 1380
      }
    );

    expect(returned.layer).toBe("controls");
    expect(returned.pointerMode).toBe("interactive");
    expect(returned.collapseStartedAtMs).toBeNull();
  });

  it("Pin 后进入小型双语舞台并保持可交互", () => {
    const pinned = reduceOverlayInteraction(createInitialOverlayInteractionState(), { type: "pin.enabled" });

    expect(pinned.layer).toBe("pinned");
    expect(pinned.pointerMode).toBe("interactive");
  });

  it("全局快捷键可以强制唤醒控制态", () => {
    const awake = reduceOverlayInteraction(createInitialOverlayInteractionState(), { type: "fallback.wake" });

    expect(awake.layer).toBe("controls");
    expect(awake.pointerMode).toBe("interactive");
    expect(awake.fallbackAwake).toBe(true);
  });

  it("兜底唤醒后离开字幕区会回到默认穿透态", () => {
    const awake = reduceOverlayInteraction(createInitialOverlayInteractionState(), { type: "fallback.wake" });
    const leaving = reduceOverlayInteraction(awake, { type: "pointer.left", atMs: 5000 });
    const collapsed = reduceOverlayInteraction(leaving, { type: "collapse.timer.elapsed", atMs: 5400 });

    expect(collapsed.layer).toBe("default");
    expect(collapsed.pointerMode).toBe("pass_through");
    expect(collapsed.fallbackAwake).toBe(false);
  });

  it("打开样式设置后保持可交互，不因离开字幕条而收起", () => {
    const settings = reduceOverlayInteraction(createInitialOverlayInteractionState(), {
      type: "settings.opened"
    });
    const left = reduceOverlayInteraction(settings, {
      type: "pointer.left",
      atMs: 2000
    });
    const elapsed = reduceOverlayInteraction(left, {
      type: "collapse.timer.elapsed",
      atMs: 2600
    });

    expect(settings.layer).toBe("settings");
    expect(settings.pointerMode).toBe("interactive");
    expect(elapsed.layer).toBe("settings");
    expect(elapsed.pointerMode).toBe("interactive");
  });

  it("关闭样式设置后回到轻控制态", () => {
    const controls = reduceOverlayInteraction(
      {
        ...createInitialOverlayInteractionState(),
        layer: "settings",
        pointerMode: "interactive"
      },
      {
        type: "settings.closed"
      }
    );

    expect(controls.layer).toBe("controls");
    expect(controls.pointerMode).toBe("interactive");
  });

  it("样式设置打开后忽略后续 hover timer，不退回轻控制态", () => {
    const entered = reduceOverlayInteraction(
      {
        ...createInitialOverlayInteractionState(),
        layer: "settings",
        pointerMode: "interactive"
      },
      {
        type: "pointer.entered",
        atMs: 3000
      }
    );
    const elapsed = reduceOverlayInteraction(entered, {
      type: "hover.timer.elapsed",
      atMs: 3300
    });

    expect(elapsed.layer).toBe("settings");
    expect(elapsed.pointerMode).toBe("interactive");
  });

  it("修订高亮在 2 秒后进入衰减", () => {
    const revised = reduceOverlayInteraction(createInitialOverlayInteractionState(), {
      type: "revision.highlighted",
      atMs: 2000
    });
    const decayed = reduceOverlayInteraction(revised, {
      type: "revision.decay.checked",
      atMs: 4100
    });

    expect(revised.revisionHighlightVisible).toBe(true);
    expect(decayed.revisionHighlightVisible).toBe(false);
  });

  it("靠近屏幕底边时向上展开", () => {
    const bounds = getSafeExpandedBounds({
      current: { left: 900, top: 980, width: 620, height: 96 },
      desired: { width: 760, height: 260 },
      screen: { width: 1920, height: 1080, margin: 24 }
    });

    expect(bounds.top).toBeLessThan(820);
    expect(bounds.left + bounds.width).toBeLessThanOrEqual(1896);
  });
});
