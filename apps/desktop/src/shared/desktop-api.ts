import type { RealtimeEvent } from "./realtime-events";
import type { DesktopAudioSource, DesktopAudioSourceId } from "./audio-source-catalog";

export type DesktopWindowRole = "control" | "overlay";

export type DesktopCaptureState = "idle" | "requesting" | "listening" | "stopped" | "error";

export type DesktopCaptureSnapshot = {
  sourceId: DesktopAudioSourceId;
  state: DesktopCaptureState;
  message: string;
};

export type DesktopApi = {
  listAudioSources: () => Promise<DesktopAudioSource[]>;
  startCapture: (sourceId: DesktopAudioSourceId) => Promise<DesktopCaptureSnapshot>;
  stopCapture: () => Promise<DesktopCaptureSnapshot>;
  sendRealtimeEvent: (event: RealtimeEvent) => Promise<void>;
  setOverlayVisible: (visible: boolean) => Promise<void>;
  setOverlayLocked: (locked: boolean) => Promise<void>;
  setOverlayPinned: (pinned: boolean) => Promise<void>;
  wakeOverlayControls: () => Promise<void>;
  recenterOverlay: () => Promise<void>;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  onRealtimeEvent: (listener: (event: RealtimeEvent) => void) => () => void;
  onCaptureState: (listener: (snapshot: DesktopCaptureSnapshot) => void) => () => void;
  onOverlayWake: (listener: () => void) => () => void;
};
