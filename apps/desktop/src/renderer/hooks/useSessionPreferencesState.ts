import { useEffect, useMemo, useState } from "react";
import log from "electron-log/renderer";

import type { DesktopAudioSourceId } from "../../shared/audio-source-catalog";
import type { AsrLatencyMode, AsrProviderSelection } from "../../shared/asr-provider-catalog";
import {
  defaultSessionPreferences,
  reduceSessionPreferences,
  type SessionPreferencesState
} from "../../shared/session-preferences";
import type { TranslationProviderSelection } from "../../shared/translation-provider-catalog";
import type { TtsProviderSelection } from "../../shared/tts-provider-catalog";
import {
  getSessionPreferences,
  onSessionPreferences,
  updateSessionPreferences
} from "../services/ipc/session-preferences";
import {
  languageDirectionForId,
  readStoredLanguageDirectionId,
  writeStoredLanguageDirectionId
} from "../utils/language-direction-storage";
import type { LanguageDirectionId } from "../types/language";

function createInitialSessionPreferences(): SessionPreferencesState {
  return {
    ...defaultSessionPreferences,
    languageDirectionId: readStoredLanguageDirectionId()
  };
}

export function useSessionPreferencesState() {
  const [preferences, setPreferences] = useState<SessionPreferencesState>(createInitialSessionPreferences);
  const languageDirection = useMemo(
    () => languageDirectionForId(preferences.languageDirectionId),
    [preferences.languageDirectionId]
  );

  function applyPreferencesPatch(patch: Partial<SessionPreferencesState>) {
    setPreferences((current) => reduceSessionPreferences(current, patch));
    void updateSessionPreferences(patch).catch((error) => {
      log.warn("[session-preferences] 同步会话偏好失败:", error);
    });
  }

  function applyPreferences(nextPreferences: SessionPreferencesState) {
    const nextLanguageDirectionId = languageDirectionForId(nextPreferences.languageDirectionId).id;
    setPreferences(reduceSessionPreferences(nextPreferences, { languageDirectionId: nextLanguageDirectionId }));
    writeStoredLanguageDirectionId(nextLanguageDirectionId);
  }

  useEffect(() => {
    const remove = onSessionPreferences(applyPreferences);
    void getSessionPreferences().then((nextPreferences) => {
      if (nextPreferences) {
        applyPreferences(nextPreferences);
      }
    });
    return () => remove();
  }, []);

  function selectSource(sourceId: DesktopAudioSourceId) {
    applyPreferencesPatch({ sourceId });
  }

  function syncSourceFromCaptureState(sourceId: DesktopAudioSourceId) {
    setPreferences((current) => reduceSessionPreferences(current, { sourceId }));
  }

  function selectAsrLatencyMode(asrLatencyMode: AsrLatencyMode) {
    applyPreferencesPatch({ asrLatencyMode });
  }

  function selectAsrProvider(asrProvider: AsrProviderSelection) {
    applyPreferencesPatch({ asrProvider });
  }

  function selectTranslationProvider(translationProvider: TranslationProviderSelection) {
    applyPreferencesPatch({ translationProvider });
  }

  function selectEndToEndSourceBackfill(endToEndSourceBackfill: boolean) {
    applyPreferencesPatch({ endToEndSourceBackfill });
  }

  function selectTtsProvider(ttsProvider: TtsProviderSelection) {
    applyPreferencesPatch({ ttsProvider });
  }

  function selectLanguageDirection(languageDirectionId: LanguageDirectionId) {
    writeStoredLanguageDirectionId(languageDirectionId);
    applyPreferencesPatch({ languageDirectionId });
  }

  return {
    asrLatencyMode: preferences.asrLatencyMode,
    asrProvider: preferences.asrProvider,
    endToEndSourceBackfill: preferences.endToEndSourceBackfill,
    languageDirection,
    selectAsrLatencyMode,
    selectAsrProvider,
    selectEndToEndSourceBackfill,
    selectLanguageDirection,
    selectSource,
    selectTranslationProvider,
    selectTtsProvider,
    sourceId: preferences.sourceId,
    syncSourceFromCaptureState,
    translationProvider: preferences.translationProvider,
    ttsProvider: preferences.ttsProvider
  };
}
