export type OverlayLayer = "default" | "controls" | "settings" | "pinned";
export type OverlayPointerMode = "pass_through" | "interactive" | "dragging";

export type OverlayInteractionState = {
  layer: OverlayLayer;
  pointerMode: OverlayPointerMode;
  hoverStartedAtMs: number | null;
  hoverIntentDelayMs: number;
  collapseStartedAtMs: number | null;
  collapseDelayMs: number;
  fallbackAwake: boolean;
  revisionHighlightedAtMs: number | null;
  revisionHighlightVisible: boolean;
};

export type OverlayInteractionEvent =
  | { type: "pointer.entered"; atMs: number }
  | { type: "pointer.left"; atMs: number }
  | { type: "hover.timer.elapsed"; atMs: number }
  | { type: "collapse.timer.elapsed"; atMs: number }
  | { type: "settings.opened" }
  | { type: "settings.closed" }
  | { type: "pin.enabled" }
  | { type: "pin.disabled" }
  | { type: "fallback.wake" }
  | { type: "drag.started" }
  | { type: "drag.ended" }
  | { type: "revision.highlighted"; atMs: number }
  | { type: "revision.decay.checked"; atMs: number };

export type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ScreenRect = {
  width: number;
  height: number;
  margin: number;
};

export function createInitialOverlayInteractionState(): OverlayInteractionState {
  return {
    layer: "default",
    pointerMode: "pass_through",
    hoverStartedAtMs: null,
    hoverIntentDelayMs: 200,
    collapseStartedAtMs: null,
    collapseDelayMs: 320,
    fallbackAwake: false,
    revisionHighlightedAtMs: null,
    revisionHighlightVisible: false
  };
}

export function reduceOverlayInteraction(
  state: OverlayInteractionState,
  event: OverlayInteractionEvent
): OverlayInteractionState {
  if (event.type === "pointer.entered") {
    if (state.layer === "pinned") {
      return state;
    }
    return { ...state, hoverStartedAtMs: event.atMs, collapseStartedAtMs: null };
  }

  if (event.type === "hover.timer.elapsed") {
    if (
      state.hoverStartedAtMs === null ||
      state.layer === "settings" ||
      state.layer === "pinned" ||
      state.pointerMode === "dragging"
    ) {
      return state;
    }
    if (event.atMs - state.hoverStartedAtMs < state.hoverIntentDelayMs) {
      return state;
    }
    return { ...state, layer: "controls", pointerMode: "interactive", collapseStartedAtMs: null };
  }

  if (event.type === "pointer.left") {
    if (state.layer === "settings" || state.layer === "pinned" || state.pointerMode === "dragging") {
      return state;
    }
    if (state.layer === "controls") {
      return { ...state, collapseStartedAtMs: event.atMs, fallbackAwake: false };
    }
    return { ...state, layer: "default", pointerMode: "pass_through", hoverStartedAtMs: null, collapseStartedAtMs: null, fallbackAwake: false };
  }

  if (event.type === "collapse.timer.elapsed") {
    if (state.collapseStartedAtMs === null || state.layer === "settings" || state.layer === "pinned") {
      return state;
    }
    if (event.atMs - state.collapseStartedAtMs < state.collapseDelayMs) {
      return state;
    }
    return { ...state, layer: "default", pointerMode: "pass_through", hoverStartedAtMs: null, fallbackAwake: false };
  }

  if (event.type === "pin.enabled") {
    return { ...state, layer: "pinned", pointerMode: "interactive", hoverStartedAtMs: null, collapseStartedAtMs: null };
  }

  if (event.type === "settings.opened") {
    return { ...state, layer: "settings", pointerMode: "interactive", hoverStartedAtMs: null, collapseStartedAtMs: null };
  }

  if (event.type === "settings.closed") {
    return { ...state, layer: "controls", pointerMode: "interactive", hoverStartedAtMs: null, collapseStartedAtMs: null };
  }

  if (event.type === "pin.disabled") {
    return { ...state, layer: "default", pointerMode: "pass_through", collapseStartedAtMs: null, fallbackAwake: false };
  }

  if (event.type === "fallback.wake") {
    return { ...state, layer: "controls", pointerMode: "interactive", collapseStartedAtMs: null, fallbackAwake: true };
  }

  if (event.type === "drag.started") {
    return { ...state, pointerMode: "dragging" };
  }

  if (event.type === "drag.ended") {
    return { ...state, pointerMode: state.layer === "default" ? "pass_through" : "interactive" };
  }

  if (event.type === "revision.highlighted") {
    return { ...state, revisionHighlightedAtMs: event.atMs, revisionHighlightVisible: true };
  }

  if (event.type === "revision.decay.checked") {
    if (state.revisionHighlightedAtMs === null) {
      return state;
    }
    return {
      ...state,
      revisionHighlightVisible: event.atMs - state.revisionHighlightedAtMs <= 2000
    };
  }

  return state;
}

export function getSafeExpandedBounds({
  current,
  desired,
  screen
}: {
  current: Rect;
  desired: Pick<Rect, "width" | "height">;
  screen: ScreenRect;
}): Rect {
  const maxLeft = screen.width - screen.margin - desired.width;
  const maxTop = screen.height - screen.margin - desired.height;
  const left = clamp(current.left + current.width - desired.width, screen.margin, maxLeft);
  const growsUp = current.top + desired.height > screen.height - screen.margin;
  const top = clamp(growsUp ? current.top + current.height - desired.height : current.top, screen.margin, maxTop);

  return {
    left,
    top,
    width: desired.width,
    height: desired.height
  };
}

function clamp(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}
