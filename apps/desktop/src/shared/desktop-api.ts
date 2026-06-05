import type { RealtimeEvent } from "./realtime-events";
import type { DesktopAudioSource, DesktopAudioSourceId } from "./audio-source-catalog";
import type { SubtitleStyleState } from "./subtitle-style-state";

export type DesktopWindowRole = "control" | "overlay" | "subtitle-style";

export type DesktopCaptureState = "idle" | "requesting" | "listening" | "stopped" | "error";

export type DesktopCaptureSnapshot = {
  sourceId: DesktopAudioSourceId;
  state: DesktopCaptureState;
  message: string;
  sessionId?: string;
};

export type DesktopApi = {
  listAudioSources: () => Promise<DesktopAudioSource[]>;
  getCaptureState: () => Promise<DesktopCaptureSnapshot>;
  startCapture: (sourceId: DesktopAudioSourceId, sessionId?: string) => Promise<DesktopCaptureSnapshot>;
  stopCapture: () => Promise<DesktopCaptureSnapshot>;
  sendRealtimeEvent: (event: RealtimeEvent) => Promise<void>;
  setOverlayVisible: (visible: boolean) => Promise<void>;
  setOverlayLocked: (locked: boolean) => Promise<void>;
  setOverlayPinned: (pinned: boolean) => Promise<void>;
  setOverlayLayer: (layer: "default" | "controls" | "settings" | "pinned") => Promise<void>;
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
