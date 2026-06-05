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
