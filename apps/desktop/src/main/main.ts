import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "node:path";

import { DESKTOP_AUDIO_SOURCES, type DesktopAudioSourceId } from "../shared/audio-source-catalog";
import type { DesktopCaptureSnapshot } from "../shared/desktop-api";
import type { RealtimeEvent } from "../shared/realtime-events";
import { reduceOverlayWindowState, type OverlayWindowState } from "./overlay-window-state";
import { CONTROL_WINDOW_PRESET, OVERLAY_WINDOW_PRESET, type DesktopWindowPreset } from "./window-config";
import { shouldCreateWindowAtStartup, shouldRevealWindowOnReady } from "./window-lifecycle";

const rendererUrl = process.env.ECHOSYNC_DESKTOP_RENDERER_URL;
const preloadPath = path.join(__dirname, "../preload/index.js");
const rendererFile = path.join(__dirname, "../renderer/index.html");

let controlWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let overlayVisible = false;
let overlayWindowState: OverlayWindowState = {
  visible: false,
  pinned: false,
  ignoreMouse: false
};
let captureSnapshot: DesktopCaptureSnapshot = {
  sourceId: "windows-system",
  state: "idle",
  message: "等待选择音频源。"
};

function createWindow(preset: DesktopWindowPreset, role: "control" | "overlay") {
  const window = new BrowserWindow({
    title: preset.title,
    width: preset.width,
    height: preset.height,
    minWidth: preset.minWidth,
    minHeight: preset.minHeight,
    show: false,
    frame: preset.frame,
    transparent: preset.transparent,
    alwaysOnTop: preset.alwaysOnTop,
    skipTaskbar: preset.skipTaskbar,
    resizable: preset.resizable,
    backgroundColor: preset.backgroundColor,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath
    }
  });

  window.center();

  window.webContents.on("did-finish-load", () => {
    window.webContents.send("audio:state", captureSnapshot);
  });

  window.once("ready-to-show", () => {
    if (!shouldRevealWindowOnReady(preset, role === "overlay" && overlayVisible)) {
      window.hide();
      return;
    }
    window.show();
    if (role === "control") {
      window.focus();
    }
  });

  if (role === "overlay") {
    window.setAlwaysOnTop(true, "screen-saver");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  void loadRenderer(window, role);
  return window;
}

async function loadRenderer(window: BrowserWindow, role: "control" | "overlay") {
  if (rendererUrl) {
    await window.loadURL(`${rendererUrl}/#/${role}`);
    return;
  }

  await window.loadFile(rendererFile, { hash: role });
}

function broadcastCaptionEvent(event: RealtimeEvent) {
  controlWindow?.webContents.send("caption:event", event);
  overlayWindow?.webContents.send("caption:event", event);
}

function broadcastCaptureState(snapshot: DesktopCaptureSnapshot) {
  controlWindow?.webContents.send("audio:state", snapshot);
  overlayWindow?.webContents.send("audio:state", snapshot);
}

function ensureOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = createWindow(OVERLAY_WINDOW_PRESET, "overlay");
  }
  return overlayWindow;
}

function registerIpc() {
  ipcMain.handle("audio:list-sources", () => DESKTOP_AUDIO_SOURCES);

  ipcMain.handle("audio:start", (_event, sourceId: DesktopAudioSourceId) => {
    const source = DESKTOP_AUDIO_SOURCES.find((item) => item.id === sourceId);
    captureSnapshot = {
      sourceId,
      state: source ? "listening" : "error",
      message: source
        ? `${source.label} 已进入采集准备态。真实 PCM 会由后续采集适配器送入 Agent。`
        : "未知音频源。"
    };
    broadcastCaptureState(captureSnapshot);
    return captureSnapshot;
  });

  ipcMain.handle("audio:stop", () => {
    captureSnapshot = {
      ...captureSnapshot,
      state: "stopped",
      message: "音频采集已停止。"
    };
    broadcastCaptureState(captureSnapshot);
    return captureSnapshot;
  });

  ipcMain.handle("caption:event", (_event, payload: RealtimeEvent) => {
    broadcastCaptionEvent(payload);
  });

  ipcMain.handle("overlay:visible", (_event, visible: boolean) => {
    overlayVisible = visible;
    overlayWindowState = reduceOverlayWindowState(overlayWindowState, { type: "overlay.visible", visible });
    if (visible) {
      const window = ensureOverlayWindow();
      window.showInactive();
      window.moveTop();
    } else {
      overlayWindow?.hide();
    }
  });

  ipcMain.handle("overlay:locked", (_event, locked: boolean) => {
    overlayWindowState = reduceOverlayWindowState(overlayWindowState, { type: "overlay.locked", locked });
    overlayWindow?.setIgnoreMouseEvents(overlayWindowState.ignoreMouse, { forward: true });
  });

  ipcMain.handle("overlay:pinned", (_event, pinned: boolean) => {
    overlayWindowState = reduceOverlayWindowState(overlayWindowState, { type: "overlay.pinned", pinned });
    overlayWindow?.setIgnoreMouseEvents(overlayWindowState.ignoreMouse, { forward: true });
    overlayWindow?.webContents.send("overlay:wake-controls");
  });

  ipcMain.handle("overlay:wake-controls", () => {
    overlayWindowState = reduceOverlayWindowState(overlayWindowState, { type: "overlay.wake_controls" });
    const window = ensureOverlayWindow();
    window.setIgnoreMouseEvents(false);
    window.showInactive();
    window.moveTop();
    window.webContents.send("overlay:wake-controls");
  });

  ipcMain.handle("overlay:recenter", () => {
    const window = ensureOverlayWindow();
    window.center();
    window.showInactive();
    window.moveTop();
  });

  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle("window:toggle-maximize", (event) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender);
    if (!currentWindow) {
      return;
    }
    if (currentWindow.isMaximized()) {
      currentWindow.unmaximize();
      return;
    }
    currentWindow.maximize();
  });

  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}

app.whenReady().then(() => {
  registerIpc();

  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    callback({ video: undefined, audio: "loopback" });
  });

  if (shouldCreateWindowAtStartup(CONTROL_WINDOW_PRESET)) {
    controlWindow = createWindow(CONTROL_WINDOW_PRESET, "control");
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      controlWindow = createWindow(CONTROL_WINDOW_PRESET, "control");
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
