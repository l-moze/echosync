import type { DesktopWindowBounds } from "../../../shared/desktop-api";
import type { OverlayLayer } from "../../../shared/overlay-interaction";

export function onOverlayWake(listener: () => void) {
  return window.echosyncDesktop?.onOverlayWake(listener) ?? (() => {});
}

export function onOverlaySettingsWake(listener: () => void) {
  return window.echosyncDesktop?.onOverlaySettingsWake(listener) ?? (() => {});
}

export async function setOverlayLayer(layer: OverlayLayer) {
  await window.echosyncDesktop?.setOverlayLayer(layer);
}

export async function setOverlayVisible(visible: boolean) {
  await window.echosyncDesktop?.setOverlayVisible(visible);
}

export async function wakeOverlayControls() {
  await window.echosyncDesktop?.wakeOverlayControls();
}

export async function getOverlayBounds() {
  return window.echosyncDesktop?.getOverlayBounds();
}

export async function resizeOverlay(bounds: Partial<DesktopWindowBounds>) {
  return window.echosyncDesktop?.resizeOverlay(bounds);
}
