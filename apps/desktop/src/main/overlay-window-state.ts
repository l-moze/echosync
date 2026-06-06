export type OverlayWindowState = {
  visible: boolean;
  pinned: boolean;
  ignoreMouse: boolean;
};

export type OverlayUiLayer = "default" | "controls" | "settings" | "pinned";

export type OverlayWindowLayout = {
  width: number;
  height: number;
};

export type OverlayWindowEvent =
  | { type: "overlay.visible"; visible: boolean }
  | { type: "overlay.locked"; locked: boolean }
  | { type: "overlay.pinned"; pinned: boolean }
  | { type: "overlay.wake_controls" }
  | { type: "overlay.recentered" };

export function reduceOverlayWindowState(state: OverlayWindowState, event: OverlayWindowEvent): OverlayWindowState {
  if (event.type === "overlay.visible") {
    return { ...state, visible: event.visible };
  }

  if (event.type === "overlay.locked") {
    return { ...state, ignoreMouse: event.locked && !state.pinned };
  }

  if (event.type === "overlay.pinned") {
    return { ...state, pinned: event.pinned, ignoreMouse: event.pinned ? false : state.ignoreMouse };
  }

  if (event.type === "overlay.wake_controls") {
    return { ...state, visible: true, ignoreMouse: false };
  }

  return state;
}

export function selectOverlayWindowLayout(layer: OverlayUiLayer): OverlayWindowLayout {
  if (layer === "pinned") {
    return { width: 1120, height: 480 };
  }

  if (layer === "controls" || layer === "settings") {
    return { width: 1120, height: 260 };
  }

  return { width: 1120, height: 142 };
}

export function selectSubtitleStyleWindowLayout(): OverlayWindowLayout {
  return { width: 360, height: 420 };
}
