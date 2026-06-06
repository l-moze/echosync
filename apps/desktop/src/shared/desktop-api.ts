import type { RealtimeEvent } from "./realtime-events";
import type { DesktopAudioSource, DesktopAudioSourceId } from "./audio-source-catalog";
import type { AgentCapabilities } from "./agent-capabilities";
import type { SubtitleStyleState } from "./subtitle-style-state";
import type {
  SessionRecord,
  SessionRecordDraftInput,
  SessionRecordExportFormat,
  SessionRecordExportResult,
  SessionRecordListItem
} from "./session-records";

export type DesktopWindowRole = "control" | "overlay" | "subtitle-style";

export type DesktopCaptureState = "idle" | "requesting" | "listening" | "stopped" | "error";

export type DesktopCaptureSnapshot = {
  sourceId: DesktopAudioSourceId;
  state: DesktopCaptureState;
  message: string;
  sessionId?: string;
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
    rename: (id: string, title: string) => Promise<SessionRecord>;
    delete: (id: string) => Promise<void>;
    export: (id: string, format: SessionRecordExportFormat) => Promise<SessionRecordExportResult>;
    getAudioUrl: (id: string) => Promise<string | null>;
  };
  getAgentCapabilities: () => Promise<AgentCapabilities>;
  listAudioSources: () => Promise<DesktopAudioSource[]>;
  getCaptureState: () => Promise<DesktopCaptureSnapshot>;
  startCapture: (sourceId: DesktopAudioSourceId, sessionId?: string) => Promise<DesktopCaptureSnapshot>;
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
  recenterOverlay: () => Promise<void>;
  copyText: (text: string) => Promise<void>;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  onRealtimeEvent: (listener: (event: RealtimeEvent) => void) => () => void;
  onCaptureState: (listener: (snapshot: DesktopCaptureSnapshot) => void) => () => void;
  onOverlayWake: (listener: () => void) => () => void;
  onSubtitleStyle: (listener: (style: SubtitleStyleState) => void) => () => void;
};
