import type { DesktopAudioSource, DesktopAudioSourceId } from "../../../shared/audio-source-catalog";
import type { AgentCapabilities } from "../../../shared/agent-capabilities";
import type { AsrLatencyMode, AsrProviderSelection } from "../../../shared/asr-provider-catalog";
import type { CaptionLine } from "../../../shared/caption-store";
import type { SessionArchiveDraft } from "../../../shared/session-archive";
import type { SessionRecordListItem } from "../../../shared/session-records";
import type { SessionUiEvent, SessionUiState } from "../../../shared/session-ui-state";
import type { TranslationProviderSelection } from "../../../shared/translation-provider-catalog";
import type { TtsProviderSelection } from "../../../shared/tts-provider-catalog";
import type { LanguageDirectionId, LanguageDirectionOption } from "../../types/language";
import type { SessionArchiveSaveStatus } from "../../types/session";
import { IdleDashboard } from "../home/IdleDashboard";
import { ActiveDashboard } from "../session/ActiveDashboard";
import { FinishedDashboard } from "../session/FinishedDashboard";

export function ControlCenter({
  activeLine,
  agentCapabilities,
  agentCapabilitiesError,
  asrLatencyMode,
  asrProvider,
  currentSource,
  endToEndSourceBackfill,
  languageDirection,
  lines,
  onAsrLatencyModeSelect,
  onAsrProviderSelect,
  onEndToEndSourceBackfillSelect,
  onLanguageDirectionSelect,
  onSourceSelect,
  onTranslationProviderSelect,
  onTtsProviderSelect,
  onSessionRecordsChanged,
  onShowOverlay,
  onStart,
  onStop,
  overlayLocked,
  dispatchSessionUi,
  sessionArchive,
  sessionArchiveSaveStatus,
  sessionRecords,
  sessionUi,
  sourceId,
  toggleOverlayLocked,
  translationProvider,
  ttsProvider
}: {
  activeLine?: CaptionLine;
  agentCapabilities: AgentCapabilities | null;
  agentCapabilitiesError: string | null;
  asrLatencyMode: AsrLatencyMode;
  asrProvider: AsrProviderSelection;
  currentSource: DesktopAudioSource;
  endToEndSourceBackfill: boolean;
  languageDirection: LanguageDirectionOption;
  lines: CaptionLine[];
  onAsrLatencyModeSelect: (mode: AsrLatencyMode) => void;
  onAsrProviderSelect: (provider: AsrProviderSelection) => void;
  onEndToEndSourceBackfillSelect: (enabled: boolean) => void;
  onLanguageDirectionSelect: (directionId: LanguageDirectionId) => void;
  onSourceSelect: (sourceId: DesktopAudioSourceId) => void;
  onTranslationProviderSelect: (provider: TranslationProviderSelection) => void;
  onTtsProviderSelect: (provider: TtsProviderSelection) => void;
  onSessionRecordsChanged: () => Promise<void>;
  onShowOverlay: () => void;
  onStart: () => void;
  onStop: () => void;
  overlayLocked: boolean;
  dispatchSessionUi: (event: SessionUiEvent) => void;
  sessionArchive: SessionArchiveDraft | null;
  sessionArchiveSaveStatus: SessionArchiveSaveStatus;
  sessionRecords: SessionRecordListItem[];
  sessionUi: SessionUiState;
  sourceId: DesktopAudioSourceId;
  toggleOverlayLocked: () => void;
  translationProvider: TranslationProviderSelection;
  ttsProvider: TtsProviderSelection;
}) {
  return (
    <section className={`controlCenter lifecycle-${sessionUi.lifecycle}`}>
      {sessionUi.lifecycle === "idle" ? (
        <IdleDashboard
          agentCapabilities={agentCapabilities}
          agentCapabilitiesError={agentCapabilitiesError}
          asrLatencyMode={asrLatencyMode}
          asrProvider={asrProvider}
          currentSource={currentSource}
          endToEndSourceBackfill={endToEndSourceBackfill}
          languageDirection={languageDirection}
          onAsrLatencyModeSelect={onAsrLatencyModeSelect}
          onAsrProviderSelect={onAsrProviderSelect}
          onEndToEndSourceBackfillSelect={onEndToEndSourceBackfillSelect}
          onLanguageDirectionSelect={onLanguageDirectionSelect}
          onSourceSelect={onSourceSelect}
          onTranslationProviderSelect={onTranslationProviderSelect}
          onTtsProviderSelect={onTtsProviderSelect}
          onSessionRecordsChanged={onSessionRecordsChanged}
          onStart={onStart}
          sessionRecords={sessionRecords}
          sessionUi={sessionUi}
          sourceId={sourceId}
          translationProvider={translationProvider}
          ttsProvider={ttsProvider}
        />
      ) : null}
      {sessionUi.lifecycle === "active" ? (
        <ActiveDashboard
          activeLine={activeLine}
          agentCapabilities={agentCapabilities}
          asrLatencyMode={asrLatencyMode}
          asrProvider={asrProvider}
          lines={lines}
          onShowOverlay={onShowOverlay}
          onStop={onStop}
          overlayLocked={overlayLocked}
          dispatchSessionUi={dispatchSessionUi}
          sessionUi={sessionUi}
          sourceId={sourceId}
          toggleOverlayLocked={toggleOverlayLocked}
        />
      ) : null}
      {sessionUi.lifecycle === "finished" ? (
        <FinishedDashboard
          dispatchSessionUi={dispatchSessionUi}
          lines={lines}
          onStart={onStart}
          sessionArchive={sessionArchive}
          sessionArchiveSaveStatus={sessionArchiveSaveStatus}
          sessionRecords={sessionRecords}
          sessionUi={sessionUi}
        />
      ) : null}
    </section>
  );
}
