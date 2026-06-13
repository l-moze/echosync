import type { SubtitleStyleState } from "../../../shared/subtitle-style-state";

export function onSubtitleStyleChange(listener: (style: Partial<SubtitleStyleState>) => void) {
  return window.echosyncDesktop?.onSubtitleStyle(listener) ?? (() => {});
}

export async function updateSharedSubtitleStyle(next: Partial<SubtitleStyleState>) {
  await window.echosyncDesktop?.updateSubtitleStyle(next);
}

export async function setSubtitleStyleWindowVisible(visible: boolean) {
  await window.echosyncDesktop?.setSubtitleStyleWindowVisible(visible);
}

export async function setOverlayPinned(pinned: boolean) {
  await window.echosyncDesktop?.setOverlayPinned(pinned);
}

export async function setOverlayLocked(locked: boolean) {
  await window.echosyncDesktop?.setOverlayLocked(locked);
}

export async function recenterOverlay() {
  await window.echosyncDesktop?.recenterOverlay();
}
