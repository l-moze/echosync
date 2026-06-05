import { contextBridge, ipcRenderer } from "electron";

import type { DesktopApi, DesktopCaptureSnapshot } from "../shared/desktop-api";
import type { RealtimeEvent } from "../shared/realtime-events";

const desktopApi: DesktopApi = {
  listAudioSources: () => ipcRenderer.invoke("audio:list-sources"),
  startCapture: (sourceId) => ipcRenderer.invoke("audio:start", sourceId),
  stopCapture: () => ipcRenderer.invoke("audio:stop"),
  sendRealtimeEvent: (event) => ipcRenderer.invoke("caption:event", event),
  setOverlayVisible: (visible) => ipcRenderer.invoke("overlay:visible", visible),
  setOverlayLocked: (locked) => ipcRenderer.invoke("overlay:locked", locked),
  setOverlayPinned: (pinned) => ipcRenderer.invoke("overlay:pinned", pinned),
  wakeOverlayControls: () => ipcRenderer.invoke("overlay:wake-controls"),
  recenterOverlay: () => ipcRenderer.invoke("overlay:recenter"),
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
  }
};

contextBridge.exposeInMainWorld("echosyncDesktop", desktopApi);
