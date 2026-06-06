import { contextBridge, ipcRenderer } from "electron";

import type { DesktopApi, DesktopCaptureSnapshot } from "../shared/desktop-api";
import type { RealtimeEvent } from "../shared/realtime-events";
import type { SubtitleStyleState } from "../shared/subtitle-style-state";

const desktopApi: DesktopApi = {
  sessionRecords: {
    list: () => ipcRenderer.invoke("session-records:list"),
    get: (id) => ipcRenderer.invoke("session-records:get", id),
    saveDraft: (input) => ipcRenderer.invoke("session-records:save-draft", input),
    rename: (id, title) => ipcRenderer.invoke("session-records:rename", id, title),
    delete: (id) => ipcRenderer.invoke("session-records:delete", id),
    export: (id, format) => ipcRenderer.invoke("session-records:export", id, format),
    getAudioUrl: (id) => ipcRenderer.invoke("session-records:get-audio-url", id)
  },
  getAgentCapabilities: () => ipcRenderer.invoke("agent:get-capabilities"),
  listAudioSources: () => ipcRenderer.invoke("audio:list-sources"),
  getCaptureState: () => ipcRenderer.invoke("audio:get-state"),
  startCapture: (sourceId, sessionId) => ipcRenderer.invoke("audio:start", sourceId, sessionId),
  stopCapture: () => ipcRenderer.invoke("audio:stop"),
  sendRealtimeEvent: (event) => ipcRenderer.invoke("caption:event", event),
  setOverlayVisible: (visible) => ipcRenderer.invoke("overlay:visible", visible),
  setOverlayLocked: (locked) => ipcRenderer.invoke("overlay:locked", locked),
  setOverlayPinned: (pinned) => ipcRenderer.invoke("overlay:pinned", pinned),
  setOverlayLayer: (layer) => ipcRenderer.invoke("overlay:layer", layer),
  getOverlayBounds: () => ipcRenderer.invoke("overlay:get-bounds"),
  resizeOverlay: (bounds) => ipcRenderer.invoke("overlay:resize", bounds),
  setSubtitleStyleWindowVisible: (visible) => ipcRenderer.invoke("subtitle-style:visible", visible),
  updateSubtitleStyle: (patch) => ipcRenderer.invoke("subtitle-style:update", patch),
  wakeOverlayControls: () => ipcRenderer.invoke("overlay:wake-controls"),
  recenterOverlay: () => ipcRenderer.invoke("overlay:recenter"),
  copyText: (text) => ipcRenderer.invoke("clipboard:copy-text", text),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  onRealtimeEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: RealtimeEvent) => listener(payload);
    ipcRenderer.on("caption:event", handler);
    return () => ipcRenderer.off("caption:event", handler);
  },
  onCaptureState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: DesktopCaptureSnapshot) => listener(payload);
    ipcRenderer.on("audio:state", handler);
    return () => ipcRenderer.off("audio:state", handler);
  },
  onOverlayWake: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("overlay:wake-controls", handler);
    return () => ipcRenderer.off("overlay:wake-controls", handler);
  },
  onSubtitleStyle: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: SubtitleStyleState) => listener(payload);
    ipcRenderer.on("subtitle-style:state", handler);
    return () => ipcRenderer.off("subtitle-style:state", handler);
  }
};

contextBridge.exposeInMainWorld("echosyncDesktop", desktopApi);
