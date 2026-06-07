import type { AsrLatencyMode, AsrProviderSelection } from "./asr-provider-catalog";
import type { DesktopAudioSourceId } from "./audio-source-catalog";
import type { TranslationProviderSelection } from "./translation-provider-catalog";
import type { TtsProviderSelection } from "./tts-provider-catalog";

export type SessionPreferencesState = {
  asrLatencyMode: AsrLatencyMode;
  asrProvider: AsrProviderSelection;
  endToEndSourceBackfill: boolean;
  languageDirectionId: string;
  sourceId: DesktopAudioSourceId;
  translationProvider: TranslationProviderSelection;
  ttsProvider: TtsProviderSelection;
};

export const defaultSessionPreferences: SessionPreferencesState = {
  asrLatencyMode: "balanced",
  asrProvider: "server-default",
  endToEndSourceBackfill: true,
  languageDirectionId: "en-zh",
  sourceId: "windows-system",
  translationProvider: "server-default",
  ttsProvider: "server-default"
};

export function reduceSessionPreferences(
  current: SessionPreferencesState,
  patch: Partial<SessionPreferencesState>
): SessionPreferencesState {
  let changed = false;
  for (const key of Object.keys(patch) as Array<keyof SessionPreferencesState>) {
    if (patch[key] !== current[key]) {
      changed = true;
      break;
    }
  }
  if (!changed) {
    return current;
  }
  return {
    ...current,
    ...patch
  };
}
