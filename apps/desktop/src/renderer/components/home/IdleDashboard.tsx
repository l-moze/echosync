import { useState } from "react";

import { DESKTOP_AUDIO_SOURCES, type DesktopAudioSource, type DesktopAudioSourceId } from "../../../shared/audio-source-catalog";
import type { AgentCapabilities } from "../../../shared/agent-capabilities";
import {
  ASR_LATENCY_OPTIONS,
  asrLatencyModeLabel,
  type AsrLatencyMode,
  type AsrProviderSelection
} from "../../../shared/asr-provider-catalog";
import {
  HOME_LAUNCHER_COPY,
  buildHomeReadinessSummary,
  productizeHomeDiagnostic
} from "../../../shared/home-launcher-copy";
import type { SessionRecordListItem } from "../../../shared/session-records";
import type { SessionUiState } from "../../../shared/session-ui-state";
import type { TranslationProviderSelection } from "../../../shared/translation-provider-catalog";
import type { TtsProviderSelection } from "../../../shared/tts-provider-catalog";
import { languageDirectionOptions } from "../../constants/language";
import type { LanguageDirectionId, LanguageDirectionOption } from "../../types/language";
import { PreferenceSettingsPanel } from "../preferences/PreferenceSettingsPanel";
import { SessionRecordsWindow } from "../records/SessionRecordsWindow";
import { PreflightAudioVisualizer } from "../session/PreflightAudioVisualizer";
import { LauncherRow } from "./LauncherRow";

export function IdleDashboard({
  agentCapabilities,
  agentCapabilitiesError,
  asrLatencyMode,
  asrProvider,
  currentSource,
  endToEndSourceBackfill,
  languageDirection,
  onAsrLatencyModeSelect,
  onAsrProviderSelect,
  onEndToEndSourceBackfillSelect,
  onLanguageDirectionSelect,
  onSourceSelect,
  onTranslationProviderSelect,
  onTtsProviderSelect,
  onSessionRecordsChanged,
  onStart,
  sessionRecords,
  sessionUi,
  sourceId,
  translationProvider,
  ttsProvider
}: {
  agentCapabilities: AgentCapabilities | null;
  agentCapabilitiesError: string | null;
  asrLatencyMode: AsrLatencyMode;
  asrProvider: AsrProviderSelection;
  currentSource: DesktopAudioSource;
  endToEndSourceBackfill: boolean;
  languageDirection: LanguageDirectionOption;
  onAsrLatencyModeSelect: (mode: AsrLatencyMode) => void;
  onAsrProviderSelect: (provider: AsrProviderSelection) => void;
  onEndToEndSourceBackfillSelect: (enabled: boolean) => void;
  onLanguageDirectionSelect: (directionId: LanguageDirectionId) => void;
  onSourceSelect: (sourceId: DesktopAudioSourceId) => void;
  onTranslationProviderSelect: (provider: TranslationProviderSelection) => void;
  onTtsProviderSelect: (provider: TtsProviderSelection) => void;
  onSessionRecordsChanged: () => Promise<void>;
  onStart: () => void;
  sessionRecords: SessionRecordListItem[];
  sessionUi: SessionUiState;
  sourceId: DesktopAudioSourceId;
  translationProvider: TranslationProviderSelection;
  ttsProvider: TtsProviderSelection;
}) {
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const audioActive = sessionUi.audioActivity === "active" || sessionUi.audioActivity === "clipping";
  const serviceReady = Boolean(agentCapabilities) && !agentCapabilitiesError;
  const readinessSummary = buildHomeReadinessSummary({
    audioActive,
    engineReady: serviceReady,
    overlayReady: true,
    serviceReady
  });

  return (
    <div className="homeLauncher">
      <section className="launcherSurface">
        <div className="launcherIntro">
          <p className="launcherState">{serviceReady ? "已就绪" : "需要检查"}</p>
          <h1>{HOME_LAUNCHER_COPY.title}</h1>
          <p>{HOME_LAUNCHER_COPY.description}</p>
        </div>

        <div className="launcherForm" aria-label="同传启动设置">
          <LauncherRow label="音频源" value={currentSource.label}>
            <div className="choiceGroup">
              {DESKTOP_AUDIO_SOURCES.filter((source) => source.id !== "mixed" && source.id !== "file").map((source) => (
                <button
                  className={source.id === sourceId ? "selected" : ""}
                  key={source.id}
                  onClick={() => onSourceSelect(source.id)}
                  title={source.description}
                >
                  {source.label}
                </button>
              ))}
            </div>
          </LauncherRow>
          <LauncherRow label="目标语言" value={languageDirection.label}>
            <div className="choiceGroup languageDirectionGroup" role="group" aria-label="目标语言">
              {languageDirectionOptions.map((option) => (
                <button
                  className={option.id === languageDirection.id ? "selected" : ""}
                  key={option.id}
                  onClick={() => onLanguageDirectionSelect(option.id)}
                  title={option.label}
                >
                  {option.shortLabel}
                </button>
              ))}
            </div>
          </LauncherRow>
          <LauncherRow label="质量模式" value={asrLatencyModeLabel(asrLatencyMode)}>
            <div className="choiceGroup qualityGroup">
              {ASR_LATENCY_OPTIONS.map((mode) => (
                <button
                  className={mode.id === asrLatencyMode ? "selected" : ""}
                  key={mode.id}
                  onClick={() => onAsrLatencyModeSelect(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </LauncherRow>
        </div>

        <div className="launcherActions">
          <button className="primary launcherPrimary" onClick={onStart}>{HOME_LAUNCHER_COPY.primaryAction}</button>
        </div>

        <PreflightAudioVisualizer sessionUi={sessionUi} />

        <div className="launcherStatusLine">
          <span>{readinessSummary}</span>
          <button onClick={() => setRecordsOpen(true)}>会议记录</button>
          <button onClick={() => setPreferencesOpen(true)}>{HOME_LAUNCHER_COPY.preferencesAction}</button>
        </div>

        {agentCapabilitiesError ? <p className="launcherError">{productizeHomeDiagnostic(agentCapabilitiesError)}</p> : null}
      </section>

      <PreferenceSettingsPanel
        agentCapabilities={agentCapabilities}
        asrLatencyMode={asrLatencyMode}
        asrProvider={asrProvider}
        currentSource={currentSource}
        endToEndSourceBackfill={endToEndSourceBackfill}
        isOpen={preferencesOpen}
        languageDirection={languageDirection}
        onAsrLatencyModeSelect={onAsrLatencyModeSelect}
        onAsrProviderSelect={onAsrProviderSelect}
        onClose={() => setPreferencesOpen(false)}
        onEndToEndSourceBackfillSelect={onEndToEndSourceBackfillSelect}
        onTranslationProviderSelect={onTranslationProviderSelect}
        onTtsProviderSelect={onTtsProviderSelect}
        translationProvider={translationProvider}
        ttsProvider={ttsProvider}
      />
      <SessionRecordsWindow
        isOpen={recordsOpen}
        onClose={() => setRecordsOpen(false)}
        onRecordsChanged={onSessionRecordsChanged}
        records={sessionRecords}
      />
    </div>
  );
}
