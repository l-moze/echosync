import type { DesktopWindowPreset } from "./window-config";

export function shouldCreateWindowAtStartup(preset: DesktopWindowPreset) {
  return preset.show;
}

export function shouldRevealWindowOnReady(preset: DesktopWindowPreset, userRequestedVisible: boolean) {
  return preset.show || userRequestedVisible;
}
