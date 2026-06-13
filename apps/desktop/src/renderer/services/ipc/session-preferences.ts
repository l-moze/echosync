import type { SessionPreferencesState } from "../../../shared/session-preferences";

export async function getSessionPreferences() {
  return window.echosyncDesktop?.getSessionPreferences();
}

export async function updateSessionPreferences(patch: Partial<SessionPreferencesState>) {
  return window.echosyncDesktop?.updateSessionPreferences(patch);
}

export function onSessionPreferences(listener: (preferences: SessionPreferencesState) => void) {
  return window.echosyncDesktop?.onSessionPreferences(listener) ?? (() => {});
}
