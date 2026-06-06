import { app, BrowserWindow, clipboard, desktopCapturer, globalShortcut, ipcMain, screen, session } from "electron";
import log from "electron-log/main";
import path from "node:path";
import WebSocket from "ws";

import { DESKTOP_AUDIO_SOURCES, type DesktopAudioSourceId } from "../shared/audio-source-catalog";
import type { DesktopCaptureSnapshot } from "../shared/desktop-api";
import type { RealtimeEvent } from "../shared/realtime-events";
import { defaultSubtitleStyle, reduceSubtitleStyleState, type SubtitleStyleState } from "../shared/subtitle-style-state";
import {
  agentHttpBaseUrlFromCaptionWsUrl,
  fetchAgentCapabilities
} from "./agent-capabilities-client";
import { buildRealtimeEventTelemetry } from "../shared/realtime-telemetry";
import type { SessionRecordDraftInput, SessionRecordExportFormat } from "../shared/session-records";
import { createCaptionEventBuffer } from "./caption-event-buffer";
import { resolveAppIconPath } from "./desktop-resources";
import { createLoopbackDisplayMediaStreams } from "./display-media-loopback";
import {
  createDefaultOverlayWindowSizeState,
  reduceOverlayWindowSizeState,
  reduceOverlayWindowState,
  selectOverlayResizeBounds,
  selectOverlayWindowLayout,
  selectSubtitleStyleWindowLayout,
  type OverlayUiLayer,
  type OverlayWindowRectangle,
  type OverlayWindowSizeState,
  type OverlayWindowState
} from "./overlay-window-state";
import { createSessionRecordStore } from "./session-record-store";
import { CONTROL_WINDOW_PRESET, OVERLAY_WINDOW_PRESET, type DesktopWindowPreset } from "./window-config";
import { sendToWindow, sendToWindows } from "./window-ipc";
import { shouldCreateWindowAtStartup, shouldRevealWindowOnReady } from "./window-lifecycle";

const CAPTION_WS_URL = process.env.ECHOSYNC_CAPTION_WS_URL || "ws://127.0.0.1:8766/v1/caption/events";
const AGENT_HTTP_BASE_URL =
  process.env.ECHOSYNC_AGENT_HTTP_URL || agentHttpBaseUrlFromCaptionWsUrl(CAPTION_WS_URL);

const rendererUrl = process.env.ECHOSYNC_DESKTOP_RENDERER_URL;
const preloadPath = path.join(__dirname, "../preload/index.js");
const rendererFile = path.join(__dirname, "../renderer/index.html");
const appIconPath = resolveAppIconPath({
  isPackaged: app.isPackaged,
  mainDir: __dirname,
  resourcesPath: process.resourcesPath
});

let controlWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let subtitleStyleWindow: BrowserWindow | null = null;
let overlayVisible = false;
let subtitleStyleVisible = false;
let overlayWindowState: OverlayWindowState = {
  visible: false,
  pinned: false,
  ignoreMouse: false
};
let overlayLayer: OverlayUiLayer = "default";
let overlayWindowSizeState: OverlayWindowSizeState = createDefaultOverlayWindowSizeState();
let captureSnapshot: DesktopCaptureSnapshot = {
  sourceId: "windows-system",
  state: "idle",
  message: "等待选择音频源。"
};
let subtitleStyle: SubtitleStyleState = defaultSubtitleStyle;
let captionWs: WebSocket | null = null;
let captionReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let isQuitting = false;
const captionEventBuffer = createCaptionEventBuffer();

function createWindow(preset: DesktopWindowPreset, role: "control" | "overlay" | "subtitle-style") {
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
    hasShadow: preset.hasShadow,
    icon: appIconPath,
    backgroundColor: preset.backgroundColor,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath
    }
  });

  window.center();

  window.webContents.on("did-finish-load", () => {
    sendToWindow(window, "audio:state", captureSnapshot);
    sendToWindow(window, "subtitle-style:state", subtitleStyle);
    for (const event of captionEventBuffer.snapshot()) {
      sendToWindow(window, "caption:event", event);
    }
  });

  window.once("ready-to-show", () => {
    const userRequestedVisible =
      (role === "overlay" && overlayVisible) || (role === "subtitle-style" && subtitleStyleVisible);
    if (!shouldRevealWindowOnReady(preset, userRequestedVisible)) {
      window.hide();
      return;
    }
    window.show();
    if (role === "control") {
      window.focus();
    }
  });

  if (role === "overlay" || role === "subtitle-style") {
    window.setAlwaysOnTop(true, "screen-saver");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  void loadRenderer(window, role);
  return window;
}

async function loadRenderer(window: BrowserWindow, role: "control" | "overlay" | "subtitle-style") {
  if (rendererUrl) {
    await window.loadURL(`${rendererUrl}/#/${role}`);
    return;
  }

  await window.loadFile(rendererFile, { hash: role });
}

function broadcastCaptionEvent(event: RealtimeEvent) {
  log.info("[caption-event] main_forwarded", buildRealtimeEventTelemetry(event, Date.now()));
  captionEventBuffer.push(event);
  sendToWindows([controlWindow, overlayWindow], "caption:event", event);
}

function broadcastCaptureState(snapshot: DesktopCaptureSnapshot) {
  sendToWindows([controlWindow, overlayWindow], "audio:state", snapshot);
}

function broadcastSubtitleStyle(style: SubtitleStyleState) {
  sendToWindows([controlWindow, overlayWindow, subtitleStyleWindow], "subtitle-style:state", style);
}

function ensureOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = createWindow(OVERLAY_WINDOW_PRESET, "overlay");
    overlayWindow.on("closed", () => {
      overlayWindow = null;
    });
  }
  return overlayWindow;
}

function ensureSubtitleStyleWindow() {
  if (!subtitleStyleWindow || subtitleStyleWindow.isDestroyed()) {
    const layout = selectSubtitleStyleWindowLayout();
    subtitleStyleWindow = createWindow(
      {
        title: "EchoSync 字幕样式",
        width: layout.width,
        height: layout.height,
        minWidth: layout.width,
        minHeight: 340,
        show: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        hasShadow: false,
        backgroundColor: "#00000000"
      },
      "subtitle-style"
    );
    subtitleStyleWindow.on("closed", () => {
      subtitleStyleWindow = null;
    });
  }
  return subtitleStyleWindow;
}

function placeSubtitleStyleWindowNearOverlay(window: BrowserWindow) {
  const overlay = ensureOverlayWindow();
  const overlayBounds = overlay.getBounds();
  const windowBounds = window.getBounds();
  const workArea = screen.getDisplayMatching(overlayBounds).workArea;
  const margin = 18;
  const nextX = clamp(overlayBounds.x + overlayBounds.width - windowBounds.width, workArea.x + margin, workArea.x + workArea.width - windowBounds.width - margin);
  const nextY = clamp(overlayBounds.y + 52, workArea.y + margin, workArea.y + workArea.height - windowBounds.height - margin);
  window.setPosition(nextX, nextY, false);
}

function applyOverlayLayout(layer: OverlayUiLayer) {
  const window = ensureOverlayWindow();
  overlayLayer = layer;
  const layout = selectOverlayWindowLayout(layer, overlayWindowSizeState);
  const [currentWidth, currentHeight] = window.getSize();
  if (currentWidth === layout.width && currentHeight === layout.height) {
    return window;
  }

  window.setSize(layout.width, layout.height, false);
  return window;
}

function registerIpc() {
  const sessionRecordStore = createSessionRecordStore(path.join(app.getPath("userData"), "echosync-data"));

  ipcMain.handle("session-records:list", () => sessionRecordStore.list());
  ipcMain.handle("session-records:get", (_event, id: string) => sessionRecordStore.get(id));
  ipcMain.handle("session-records:save-draft", (_event, input: SessionRecordDraftInput) =>
    sessionRecordStore.saveDraft(input)
  );
  ipcMain.handle("session-records:rename", (_event, id: string, title: string) =>
    sessionRecordStore.rename(id, title)
  );
  ipcMain.handle("session-records:delete", (_event, id: string) => sessionRecordStore.delete(id));
  ipcMain.handle("session-records:export", (_event, id: string, format: SessionRecordExportFormat) =>
    sessionRecordStore.exportRecord(id, format)
  );
  ipcMain.handle("session-records:get-audio-url", (_event, id: string) =>
    sessionRecordStore.getAudioUrl(id)
  );

  ipcMain.handle("agent:get-capabilities", () => fetchAgentCapabilities(AGENT_HTTP_BASE_URL));
  ipcMain.handle("audio:list-sources", () => DESKTOP_AUDIO_SOURCES);
  ipcMain.handle("audio:get-state", () => captureSnapshot);

  ipcMain.handle("audio:start", (_event, sourceId: DesktopAudioSourceId, sessionId?: string) => {
    const source = DESKTOP_AUDIO_SOURCES.find((item) => item.id === sourceId);
    captureSnapshot = {
      sourceId,
      state: source ? "listening" : "error",
      message: source
        ? `${source.label} 已开始采集，音频正在送入同传服务。`
        : "未知音频源。",
      sessionId: source ? sessionId : undefined
    };
    broadcastCaptureState(captureSnapshot);
    return captureSnapshot;
  });

  ipcMain.handle("audio:stop", () => {
    captureSnapshot = {
      ...captureSnapshot,
      state: "stopped",
      message: "音频采集已停止。",
      sessionId: undefined
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
    applyOverlayLayout(pinned ? "pinned" : "default");
    overlayWindow?.setIgnoreMouseEvents(overlayWindowState.ignoreMouse, { forward: true });
    sendToWindow(overlayWindow, "overlay:wake-controls");
  });

  ipcMain.handle("overlay:layer", (_event, layer: OverlayUiLayer) => {
    applyOverlayLayout(layer);
  });

  ipcMain.handle("overlay:get-bounds", () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      return null;
    }
    return overlayWindow.getBounds();
  });

  ipcMain.handle("overlay:resize", (_event, requestedBounds: Partial<OverlayWindowRectangle>) => {
    const window = ensureOverlayWindow();
    const currentBounds = window.getBounds();
    const workArea = screen.getDisplayMatching(currentBounds).workArea;
    const nextBounds = selectOverlayResizeBounds({
      currentBounds,
      layer: overlayLayer,
      requestedBounds,
      workArea
    });
    overlayWindowSizeState = reduceOverlayWindowSizeState(overlayWindowSizeState, overlayLayer, nextBounds);
    window.setBounds(nextBounds, false);
    return window.getBounds();
  });

  ipcMain.handle("subtitle-style:visible", (_event, visible: boolean) => {
    subtitleStyleVisible = visible;
    if (!visible) {
      subtitleStyleWindow?.hide();
      return;
    }
    const window = ensureSubtitleStyleWindow();
    placeSubtitleStyleWindowNearOverlay(window);
    window.showInactive();
    window.moveTop();
  });

  ipcMain.handle("subtitle-style:update", (_event, patch: Partial<SubtitleStyleState>) => {
    subtitleStyle = reduceSubtitleStyleState(subtitleStyle, patch);
    broadcastSubtitleStyle(subtitleStyle);
    return subtitleStyle;
  });

  ipcMain.handle("overlay:wake-controls", () => {
    wakeOverlayControls();
  });

  ipcMain.handle("overlay:recenter", () => {
    const window = ensureOverlayWindow();
    window.center();
    window.showInactive();
    window.moveTop();
  });

  ipcMain.handle("clipboard:copy-text", (_event, text: string) => {
    clipboard.writeText(text);
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

function wakeOverlayControls() {
  overlayWindowState = reduceOverlayWindowState(overlayWindowState, { type: "overlay.wake_controls" });
  const window = applyOverlayLayout("controls");
  window.setIgnoreMouseEvents(false);
  window.showInactive();
  window.moveTop();
  sendToWindow(window, "overlay:wake-controls");
}

app.setAppUserModelId("com.echosync.desktop");
app.setName("EchoSync");

app.whenReady().then(() => {
  registerIpc();

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    void resolveDisplayMediaVideoSource(request.frame, request.videoRequested).then((videoSource) => {
      callback(createLoopbackDisplayMediaStreams(videoSource, request.videoRequested));
    });
  });

  // 连接 Agent 字幕事件 WebSocket
  connectCaptionWs();

  globalShortcut.register("Alt+Shift+S", () => {
    wakeOverlayControls();
  });

  if (shouldCreateWindowAtStartup(CONTROL_WINDOW_PRESET)) {
    controlWindow = createWindow(CONTROL_WINDOW_PRESET, "control");
    controlWindow.on("closed", () => {
      controlWindow = null;
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      controlWindow = createWindow(CONTROL_WINDOW_PRESET, "control");
      controlWindow.on("closed", () => {
        controlWindow = null;
      });
    }
  });
});

function connectCaptionWs() {
  if (isQuitting) {
    return;
  }
  if (captionReconnectTimer) {
    clearTimeout(captionReconnectTimer);
    captionReconnectTimer = null;
  }
  try {
    captionWs = new WebSocket(CAPTION_WS_URL);

    captionWs.on("open", () => {
      log.info("[caption-ws] 已连接到 Agent:", CAPTION_WS_URL);
    });

    captionWs.on("message", (data: WebSocket.Data) => {
      try {
        const event = JSON.parse(data.toString()) as RealtimeEvent;
        broadcastCaptionEvent(event);
      } catch (err) {
        log.error("[caption-ws] 解析事件失败:", err);
      }
    });

    captionWs.on("close", (code, reason) => {
      log.info("[caption-ws] 已断开，code:", code, "reason:", reason.toString());
      if (!isQuitting) {
        captionReconnectTimer = setTimeout(connectCaptionWs, 5000);
      }
    });

    captionWs.on("error", (err: Error) => {
      log.warn("[caption-ws] 连接错误:", err.message);
    });
  } catch (err) {
    log.warn("[caption-ws] 无法创建连接:", err);
  }
}

async function resolveDisplayMediaVideoSource(frame: Electron.WebFrameMain | null, videoRequested: boolean) {
  if (!videoRequested) {
    return null;
  }

  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1, height: 1 }
    });
    return sources[0] ?? frame;
  } catch (error) {
    log.warn("[display-media] 获取屏幕占位视频源失败，尝试使用当前 frame:", error);
    return frame;
  }
}

function clamp(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

app.on("before-quit", () => {
  isQuitting = true;
  if (captionReconnectTimer) {
    clearTimeout(captionReconnectTimer);
    captionReconnectTimer = null;
  }
  globalShortcut.unregisterAll();
  captionWs?.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
