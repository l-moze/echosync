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

export type OverlayWindowRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OverlayWindowSizeState = {
  width: number;
  heightByLayer: Record<OverlayUiLayer, number>;
};

export type OverlayResizeBoundsInput = {
  currentBounds: OverlayWindowRectangle;
  layer: OverlayUiLayer;
  requestedBounds: Partial<OverlayWindowRectangle>;
  workArea: OverlayWindowRectangle;
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

export function selectOverlayWindowLayout(
  layer: OverlayUiLayer,
  state = createDefaultOverlayWindowSizeState()
): OverlayWindowLayout {
  return selectOverlayWindowLayoutFromSizeState(layer, state);
}

export function createDefaultOverlayWindowSizeState(): OverlayWindowSizeState {
  return {
    width: 1120,
    heightByLayer: {
      default: 142,
      controls: 260,
      settings: 260,
      pinned: 480
    }
  };
}

export function reduceOverlayWindowSizeState(
  state: OverlayWindowSizeState,
  layer: OverlayUiLayer,
  layout: OverlayWindowLayout
): OverlayWindowSizeState {
  const minLayout = minOverlayWindowLayout(layer);
  const width = Math.max(layout.width, minLayout.width);
  const height = Math.max(layout.height, minLayout.height);
  const nextHeightByLayer = {
    ...state.heightByLayer,
    [layer]: height
  };
  if (layer === "controls" || layer === "settings") {
    nextHeightByLayer.controls = height;
    nextHeightByLayer.settings = height;
  }
  return {
    width,
    heightByLayer: nextHeightByLayer
  };
}

export function selectOverlayWindowLayoutFromSizeState(
  layer: OverlayUiLayer,
  state: OverlayWindowSizeState
): OverlayWindowLayout {
  const minLayout = minOverlayWindowLayout(layer);
  return {
    width: Math.max(state.width, minLayout.width),
    height: Math.max(state.heightByLayer[layer], minLayout.height)
  };
}

export function selectOverlayResizeBounds({
  currentBounds,
  layer,
  requestedBounds,
  workArea
}: OverlayResizeBoundsInput): OverlayWindowRectangle {
  const margin = 24;
  const minLayout = minOverlayWindowLayout(layer);
  const maxWidth = Math.max(minLayout.width, workArea.width - margin * 2);
  const maxHeight = Math.max(minLayout.height, workArea.height - margin * 2);
  const width = clampNumber(requestedBounds.width ?? currentBounds.width, minLayout.width, maxWidth);
  const height = clampNumber(requestedBounds.height ?? currentBounds.height, minLayout.height, maxHeight);
  const minX = workArea.x + margin;
  const minY = workArea.y + margin;
  const maxX = workArea.x + workArea.width - width - margin;
  const maxY = workArea.y + workArea.height - height - margin;
  const rawRight = requestedBounds.x !== undefined && requestedBounds.width !== undefined
    ? requestedBounds.x + requestedBounds.width
    : currentBounds.x + currentBounds.width;
  const rawBottom = requestedBounds.y !== undefined && requestedBounds.height !== undefined
    ? requestedBounds.y + requestedBounds.height
    : currentBounds.y + currentBounds.height;
  const requestedX = requestedBounds.x !== undefined && requestedBounds.width !== undefined
    ? rawRight - width
    : requestedBounds.x ?? currentBounds.x;
  const requestedY = requestedBounds.y !== undefined && requestedBounds.height !== undefined
    ? rawBottom - height
    : requestedBounds.y ?? currentBounds.y;
  const x = clampNumber(requestedX, minX, Math.max(minX, maxX));
  const y = clampNumber(requestedY, minY, Math.max(minY, maxY));
  return { x, y, width, height };
}

function minOverlayWindowLayout(layer: OverlayUiLayer): OverlayWindowLayout {
  if (layer === "pinned") {
    return { width: 760, height: 420 };
  }

  if (layer === "controls" || layer === "settings") {
    return { width: 760, height: 260 };
  }

  return { width: 720, height: 120 };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function selectSubtitleStyleWindowLayout(): OverlayWindowLayout {
  return { width: 360, height: 420 };
}
