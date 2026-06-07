import type { RealtimeEvent } from "./realtime-events";
import type { DesktopAudioSource, DesktopAudioSourceId } from "./audio-source-catalog";
import type { AgentCapabilities } from "./agent-capabilities";
import type { AsrLatencyMode, AsrProviderId } from "./asr-provider-catalog";
import type { SessionPreferencesState } from "./session-preferences";
import type { SubtitleStyleState } from "./subtitle-style-state";
import type {
  SessionRecord,
  SessionRecordDraftInput,
  SessionRecordExportFormat,
  SessionRecordExportResult,
  SessionRecordListItem,
  SessionRecordSummary
} from "./session-records";
import type { TtsProviderId } from "./agent-capabilities";
import type { TranslationProviderId } from "./translation-provider-catalog";

export type DesktopWindowRole = "control" | "overlay" | "subtitle-style";

export type DesktopCaptureState = "idle" | "requesting" | "listening" | "stopped" | "error";

export type DesktopCaptureSnapshot = {
  sourceId: DesktopAudioSourceId;
  state: DesktopCaptureState;
  message: string;
  sessionId?: string;
};

export type DesktopCaptureRecording = {
  activityRanges?: Array<{
    startMs: number;
    endMs: number;
  }>;
  data: ArrayBuffer;
  mimeType: string;
  sessionId: string;
};

export type DesktopCaptureStartRequest = {
  asrLatencyMode: AsrLatencyMode;
  asrProvider?: AsrProviderId;
  endToEndSourceBackfill?: boolean;
  sessionId: string;
  sourceId: DesktopAudioSourceId;
  sourceLang?: string;
  translationProvider?: TranslationProviderId;
  ttsProvider?: TtsProviderId;
};

export type DesktopWindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesktopApi = {
  sessionRecords: {
    list: () => Promise<SessionRecordListItem[]>;
    get: (id: string) => Promise<SessionRecord | null>;
    saveDraft: (input: SessionRecordDraftInput) => Promise<SessionRecord>;
    updateSummary: (id: string, summary: Partial<SessionRecordSummary>) => Promise<SessionRecord>;
    generateSummary: (id: string) => Promise<void>;
    rename: (id: string, title: string) => Promise<SessionRecord>;
    delete: (id: string) => Promise<void>;
    export: (id: string, format: SessionRecordExportFormat) => Promise<SessionRecordExportResult>;
    getAudioData: (id: string) => Promise<{ data: ArrayBuffer; mimeType: string } | null>;
    getAudioUrl: (id: string) => Promise<string | null>;
  };
  getAgentCapabilities: () => Promise<AgentCapabilities>;
  getCaptionSnapshot: (sessionId?: string) => Promise<RealtimeEvent[]>;
  listAudioSources: () => Promise<DesktopAudioSource[]>;
  getSessionPreferences: () => Promise<SessionPreferencesState>;
  updateSessionPreferences: (patch: Partial<SessionPreferencesState>) => Promise<SessionPreferencesState>;
  getCaptureState: () => Promise<DesktopCaptureSnapshot>;
  getPendingCaptureRecording: (sessionId: string) => Promise<DesktopCaptureRecording | null>;
  startCapture: (request: DesktopCaptureStartRequest) => Promise<DesktopCaptureSnapshot>;
  stopCapture: () => Promise<DesktopCaptureSnapshot>;
  sendRealtimeEvent: (event: RealtimeEvent) => Promise<void>;
  setOverlayVisible: (visible: boolean) => Promise<void>;
  setOverlayLocked: (locked: boolean) => Promise<void>;
  setOverlayPinned: (pinned: boolean) => Promise<void>;
  setOverlayLayer: (layer: "default" | "controls" | "settings" | "pinned") => Promise<void>;
  getOverlayBounds: () => Promise<DesktopWindowBounds | null>;
  resizeOverlay: (bounds: Partial<DesktopWindowBounds>) => Promise<DesktopWindowBounds | null>;
  setSubtitleStyleWindowVisible: (visible: boolean) => Promise<void>;
  updateSubtitleStyle: (patch: Partial<SubtitleStyleState>) => Promise<SubtitleStyleState>;
  wakeOverlayControls: () => Promise<void>;
  wakeOverlaySettings: () => Promise<void>;
  recenterOverlay: () => Promise<void>;
  copyText: (text: string) => Promise<void>;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  onRealtimeEvent: (listener: (event: RealtimeEvent) => void) => () => void;
  onCaptureState: (listener: (snapshot: DesktopCaptureSnapshot) => void) => () => void;
  onSessionRecordChanged: (listener: (recordId: string) => void) => () => void;
  onSessionPreferences: (listener: (preferences: SessionPreferencesState) => void) => () => void;
  onOverlayWake: (listener: () => void) => () => void;
  onOverlaySettingsWake: (listener: () => void) => () => void;
  onSubtitleStyle: (listener: (style: SubtitleStyleState) => void) => () => void;
};
