import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type UIEvent } from "react";
import { createRoot } from "react-dom/client";
import log from "electron-log/renderer";

import { DESKTOP_AUDIO_SOURCES, type DesktopAudioSource, type DesktopAudioSourceId } from "../shared/audio-source-catalog";
import type { AgentCapabilities } from "../shared/agent-capabilities";
import {
  ASR_LATENCY_OPTIONS,
  ASR_PROVIDER_OPTIONS,
  asrLatencyModeLabel,
  asrProviderLabel,
  selectedAsrProviderId,
  type AsrLatencyMode,
  type AsrProviderSelection
} from "../shared/asr-provider-catalog";
import {
  selectedTranslationProviderId,
  TRANSLATION_PROVIDER_OPTIONS,
  translationProviderLabel,
  type TranslationProviderSelection
} from "../shared/translation-provider-catalog";
import {
  selectedTtsProviderId,
  TTS_PROVIDER_OPTIONS,
  ttsProviderLabel,
  type TtsProviderSelection
} from "../shared/tts-provider-catalog";
import {
  createInitialCaptionDisplayBuffer,
  selectDisplayCaptionPresentation,
  selectDisplayCaptionLines,
  type CaptionDisplayBuffer
} from "../shared/caption-display-buffer";
import { selectCaptionTextParts } from "../shared/caption-text-view";
import {
  applyRealtimeEvent,
  isRealtimeEventForActiveSession,
  selectActiveCaptionLine,
  selectOverlayHistoryLinesForDisplay,
  type CaptionLine
} from "../shared/caption-store";
import type { DesktopCaptureSnapshot, DesktopWindowBounds } from "../shared/desktop-api";
import {
  createInitialOverlayInteractionState,
  reduceOverlayInteraction,
  type OverlayInteractionEvent
} from "../shared/overlay-interaction";
import { validateRealtimePreflight } from "../shared/realtime-preflight";
import {
  createInitialSessionUiState,
  reduceSessionUiState,
  selectSessionHealthMetrics,
  type SessionSummary,
  type StartupUiState,
  type SessionUiEvent
} from "../shared/session-ui-state";
import { selectSessionClockMs } from "../shared/session-clock";
import {
  defaultSubtitleStyle,
  captionStateDisplayLabel,
  normalizeSubtitleDisplayMode,
  reduceSubtitleStyleState,
  selectSubtitleFontWeight,
  subtitleDisplayModeLabel,
  type SubtitleDisplayMode,
  type SubtitleOutlineStyle,
  type SubtitleStyleState
} from "../shared/subtitle-style-state";
import { cleanTranscriptLines, serializeTranscriptMarkdown, serializeTranscriptSrt } from "../shared/session-export";
import {
  buildSessionArchiveDraft,
  selectPlaybackSegmentId,
  sessionArchiveTitleFromDate,
  type SessionArchiveDraft
} from "../shared/session-archive";
import { logRealtimeEventTelemetry } from "../shared/realtime-telemetry";
import {
  ADVANCED_SETTINGS_NAV,
  HOME_LAUNCHER_COPY,
  PREFERENCE_ADVANCED_ENTRY,
  PREFERENCE_SETTINGS_NAV,
  RECORD_LIST_COLUMNS,
  buildHomeReadinessSummary,
  productizeHomeDiagnostic
} from "../shared/home-launcher-copy";
import { createInitialCaptionLines } from "./initial-captions";
import { createRealtimeAudioClient, type RealtimeAudioClient } from "./realtime-audio-client";
import { createTtsAudioPlaybackQueue, type TtsAudioPlaybackQueue } from "./tts-audio-playback";
import { resolveDesktopWindowRole } from "./window-role";

import "./styles.css";

const fontOptions = ["System", "Inter", "Segoe UI", "Microsoft YaHei"];
type NavigationConfirmReason = "active_session" | "startup_cancel" | "dirty_export" | null;

function useSharedSubtitleStyle() {
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyleState>(defaultSubtitleStyle);

  useEffect(() => {
    const remove = window.echosyncDesktop?.onSubtitleStyle((style) => {
      setSubtitleStyle((current) => reduceSubtitleStyleState(current, style));
    });
    return () => remove?.();
  }, []);

  function updateSubtitleStyle(next: Partial<SubtitleStyleState>) {
    setSubtitleStyle((current) => reduceSubtitleStyleState(current, next));
    void window.echosyncDesktop?.updateSubtitleStyle(next);
  }

  return { subtitleStyle, updateSubtitleStyle };
}

function App() {
  const role = resolveDesktopWindowRole(window.location.hash);
  const [lines, setLines] = useState<CaptionLine[]>(createInitialCaptionLines);
  const [sourceId, setSourceId] = useState<DesktopAudioSourceId>("windows-system");
  const [asrProvider, setAsrProvider] = useState<AsrProviderSelection>("server-default");
  const [asrLatencyMode, setAsrLatencyMode] = useState<AsrLatencyMode>("balanced");
  const [translationProvider, setTranslationProvider] =
    useState<TranslationProviderSelection>("server-default");
  const [ttsProvider, setTtsProvider] = useState<TtsProviderSelection>("server-default");
  const [agentCapabilities, setAgentCapabilities] = useState<AgentCapabilities | null>(null);
  const [agentCapabilitiesError, setAgentCapabilitiesError] = useState<string | null>(null);
  const [overlayLocked, setOverlayLocked] = useState(false);
  const [sessionUi, setSessionUi] = useState(() => createInitialSessionUiState({ platform: "windows" }));
  const [snapshot, setSnapshot] = useState<DesktopCaptureSnapshot>({
    sourceId: "windows-system",
    state: "idle",
    message: "等待选择音频源。"
  });
  const [hasRealEvents, setHasRealEvents] = useState(false);
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  const [sessionArchive, setSessionArchive] = useState<SessionArchiveDraft | null>(null);
  const [navigationConfirmReason, setNavigationConfirmReason] = useState<NavigationConfirmReason>(null);
  const realtimeClientRef = useRef<RealtimeAudioClient | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const startupRunIdRef = useRef(0);
  const sessionUiRef = useRef(sessionUi);
  const terminalRealtimeErrorRef = useRef<string | null>(null);
  const ttsPlaybackRef = useRef<TtsAudioPlaybackQueue>(createTtsAudioPlaybackQueue());

  useEffect(() => {
    sessionUiRef.current = sessionUi;
  }, [sessionUi]);

  useEffect(() => {
    const removeCaptionListener = window.echosyncDesktop?.onRealtimeEvent((event) => {
      if (!isRealtimeEventForActiveSession(activeSessionIdRef.current, event)) {
        return;
      }
      logRealtimeEventTelemetry(log, event, Date.now());
      if (event.type === "realtime.done") {
        activeSessionIdRef.current = null;
        return;
      }
      if (event.type === "tts.audio") {
        if (role === "control") {
          void ttsPlaybackRef.current.enqueue(event);
        }
        setHasRealEvents(true);
        return;
      }
      setLines((current) => applyRealtimeEvent(current, event));
      setHasRealEvents(true);
      if (event.type === "realtime.error") {
        setRealtimeError(event.message);
        setSnapshot((current) => ({
          ...current,
          state: "error",
          message: event.message
        }));
        void stopRealtimeAfterError(event.message);
      }
    });
    const removeCaptureListener = window.echosyncDesktop?.onCaptureState((nextSnapshot) => {
      const terminalError = terminalRealtimeErrorRef.current;
      setSnapshot(
        terminalError && nextSnapshot.state === "stopped"
          ? { ...nextSnapshot, state: "error", message: terminalError, sessionId: undefined }
          : nextSnapshot
      );
      setSourceId(nextSnapshot.sourceId);
      activeSessionIdRef.current = nextSnapshot.sessionId ?? null;
      if (nextSnapshot.state === "listening") {
        terminalRealtimeErrorRef.current = null;
        dispatchSessionUi({ type: "session.started" });
      }
      if (nextSnapshot.state === "error") {
        setRealtimeError(nextSnapshot.message);
      }
      if (nextSnapshot.state === "stopped" || nextSnapshot.state === "error") {
        const currentClient = realtimeClientRef.current;
        realtimeClientRef.current = null;
        activeSessionIdRef.current = null;
        void currentClient?.stop();
      }
    });
    void window.echosyncDesktop?.getCaptureState().then((currentSnapshot) => {
      setSnapshot(currentSnapshot);
      setSourceId(currentSnapshot.sourceId);
      activeSessionIdRef.current = currentSnapshot.sessionId ?? null;
    });
    return () => {
      removeCaptionListener?.();
      removeCaptureListener?.();
    };
  }, []);

  useEffect(() => {
    void refreshAgentCapabilities();
  }, []);

  const activeLine = useMemo(() => selectActiveCaptionLine(lines), [lines]);
  const currentSource = DESKTOP_AUDIO_SOURCES.find((source) => source.id === sourceId) ?? DESKTOP_AUDIO_SOURCES[1];

  function dispatchSessionUi(event: SessionUiEvent) {
    const next = reduceSessionUiState(sessionUiRef.current, event);
    sessionUiRef.current = next;
    setSessionUi(next);
  }

  async function refreshAgentCapabilities() {
    try {
      const capabilities = await window.echosyncDesktop?.getAgentCapabilities();
      if (!capabilities) {
        throw new Error("桌面端没有返回同传服务能力信息。");
      }
      setAgentCapabilities(capabilities);
      setAgentCapabilitiesError(null);
      return capabilities;
    } catch (error) {
      const message = error instanceof Error ? error.message : "同传服务能力检查失败。";
      setAgentCapabilitiesError(message);
      setAgentCapabilities(null);
      return null;
    }
  }

  useEffect(() => {
    if (sessionUi.lifecycle !== "idle" || sessionUi.startup.phase !== "idle") {
      return;
    }

    const timer = window.setInterval(() => {
      dispatchSessionUi({
        type: "audio.level.changed",
        peak: sourceId === "windows-system" ? 0.38 : 0.18,
        rms: sourceId === "windows-system" ? 0.12 : 0.05
      });
    }, 1200);

    return () => window.clearInterval(timer);
  }, [sessionUi.lifecycle, sessionUi.startup.phase, sourceId]);

  useEffect(() => {
    if (sessionUi.startup.phase === "idle" || sessionUi.startup.phase === "failed") {
      return;
    }
    const timer = window.setInterval(() => {
      dispatchSessionUi({ type: "startup.slow_tick", atMs: Date.now() });
    }, 700);
    return () => window.clearInterval(timer);
  }, [sessionUi.startup.phase]);

  async function startCapture(nextSourceId = sourceId) {
    const runId = startupRunIdRef.current + 1;
    startupRunIdRef.current = runId;
    const startedAtMs = Date.now();
    dispatchSessionUi({ type: "startup.started", phase: "connecting_agent", atMs: startedAtMs });
    if (realtimeClientRef.current) {
      await realtimeClientRef.current.stop();
      realtimeClientRef.current = null;
      activeSessionIdRef.current = null;
    }
    setRealtimeError(null);
    terminalRealtimeErrorRef.current = null;
    setSessionArchive(null);
    ttsPlaybackRef.current.clear();
    setLines(createInitialCaptionLines());
    const capabilities = await refreshAgentCapabilities();
    const preflightMessage = validateRealtimePreflight({
      asrLatencyMode,
      asrProvider,
      capabilities,
      sourceId: nextSourceId,
      ttsProvider,
      translationProvider
    });
    if (preflightMessage) {
      setSnapshot({
        sourceId: nextSourceId,
        state: "error",
        message: preflightMessage
      });
      dispatchSessionUi({ type: "startup.failed", message: preflightMessage });
      return;
    }
    dispatchSessionUi({ type: "startup.phase.changed", phase: "preparing_audio", atMs: Date.now() });
    const client = createRealtimeAudioClient({
      asrLatencyMode,
      asrProvider: selectedAsrProviderId(asrProvider),
      sourceId: nextSourceId,
      translationProvider: selectedTranslationProviderId(translationProvider),
      ttsProvider: selectedTtsProviderId(ttsProvider)
    });
    realtimeClientRef.current = client;
    activeSessionIdRef.current = client.sessionId;
    const nextSnapshot = await window.echosyncDesktop?.startCapture(nextSourceId, client.sessionId);
    if (nextSnapshot) {
      try {
        dispatchSessionUi({ type: "startup.phase.changed", phase: "connecting_agent", atMs: Date.now() });
        await client.start();
        if (startupRunIdRef.current !== runId) {
          await client.stop();
          return;
        }
        setSnapshot(nextSnapshot);
        dispatchSessionUi({ type: "startup.phase.changed", phase: "opening_overlay", atMs: Date.now() });
        await window.echosyncDesktop?.setOverlayVisible(true);
        if (startupRunIdRef.current !== runId) {
          return;
        }
        dispatchSessionUi({ type: "startup.completed" });
        dispatchSessionUi({ type: "session.started" });
      } catch (error) {
        if (startupRunIdRef.current !== runId) {
          return;
        }
        realtimeClientRef.current = null;
        activeSessionIdRef.current = null;
        ttsPlaybackRef.current.clear();
        await window.echosyncDesktop?.stopCapture();
        const message = error instanceof Error ? error.message : "实时音频采集启动失败。";
        setSnapshot({
          sourceId: nextSourceId,
          state: "error",
          message
        });
        dispatchSessionUi({ type: "startup.failed", message });
      }
    } else {
      dispatchSessionUi({ type: "startup.failed", message: "桌面端没有返回音频采集状态。" });
    }
  }

  async function stopRealtimeAfterError(message: string) {
    startupRunIdRef.current += 1;
    terminalRealtimeErrorRef.current = message;
    const currentClient = realtimeClientRef.current;
    realtimeClientRef.current = null;
    activeSessionIdRef.current = null;
    ttsPlaybackRef.current.clear();
    let nextSnapshot: DesktopCaptureSnapshot | undefined;

    try {
      await currentClient?.stop();
    } catch (error) {
      log.warn("[realtime] 停止失败会话音频流时出错:", error);
    }

    try {
      nextSnapshot = await window.echosyncDesktop?.stopCapture();
    } catch (error) {
      log.warn("[realtime] 更新失败会话采集状态时出错:", error);
    }

    setSnapshot((current) => ({
      ...(nextSnapshot ?? current),
      state: "error",
      message,
      sessionId: undefined
    }));

    dispatchSessionUi({ type: "startup.failed", message });
  }

  async function stopCapture() {
    const currentClient = realtimeClientRef.current;
    realtimeClientRef.current = null;
    activeSessionIdRef.current = null;
    ttsPlaybackRef.current.clear();
    const recording = await currentClient?.stop();
    const nextSnapshot = await window.echosyncDesktop?.stopCapture();
    if (nextSnapshot) {
      setSnapshot(nextSnapshot);
      if (recording) {
        const createdAt = new Date();
        setSessionArchive(
          buildSessionArchiveDraft({
            audioMimeType: recording.mimeType,
            audioObjectUrl: URL.createObjectURL(recording.blob),
            createdAt: createdAt.toISOString(),
            durationMs: Math.max(...lines.map((line) => line.endMs), 0),
            id: currentClient?.sessionId ?? `sess_${createdAt.getTime()}`,
            lines,
            title: sessionArchiveTitleFromDate(createdAt)
          })
        );
      }
      const summary: SessionSummary = {
        durationMs: Math.max(...lines.map((line) => line.endMs), 0),
        segmentCount: lines.length,
        patchCount: lines.reduce((sum, line) => sum + line.patchCount, 0),
        averageLatencyMs: 920,
        wordCount: lines.reduce((sum, line) => sum + line.targetText.length, 0)
      };
      dispatchSessionUi({ type: "session.finished", summary });
    }
  }

  function requestReturnHome() {
    if (sessionUi.startup.phase !== "idle") {
      setNavigationConfirmReason("startup_cancel");
      return;
    }
    if (sessionUi.lifecycle === "active" || realtimeClientRef.current || snapshot.state === "listening" || snapshot.state === "requesting") {
      setNavigationConfirmReason("active_session");
      return;
    }
    if (sessionUi.lifecycle === "finished" && sessionUi.preExportEdit.dirty) {
      setNavigationConfirmReason("dirty_export");
      return;
    }
    void performReturnHome();
  }

  async function performReturnHome() {
    startupRunIdRef.current += 1;
    ttsPlaybackRef.current.clear();
    if (realtimeClientRef.current || snapshot.state === "listening" || snapshot.state === "requesting" || sessionUi.startup.phase !== "idle") {
      const currentClient = realtimeClientRef.current;
      realtimeClientRef.current = null;
      activeSessionIdRef.current = null;
      await currentClient?.stop();
      const nextSnapshot = await window.echosyncDesktop?.stopCapture();
      if (nextSnapshot) {
        setSnapshot(nextSnapshot);
      }
    }
    setNavigationConfirmReason(null);
    setRealtimeError(null);
    setSessionArchive(null);
    setLines(createInitialCaptionLines());
    dispatchSessionUi({ type: "startup.cancelled" });
    dispatchSessionUi({ type: "session.return_home" });
  }

  function dismissNavigationDialog() {
    setNavigationConfirmReason(null);
  }

  async function toggleOverlayLocked() {
    const next = !overlayLocked;
    setOverlayLocked(next);
    await window.echosyncDesktop?.setOverlayLocked(next);
  }

  if (role === "overlay") {
    return (
      <OverlayWindow
        activeLine={activeLine}
        lines={lines}
        onSourceStart={(nextSourceId) => void startCapture(nextSourceId)}
        onStop={() => void stopCapture()}
        realtimeError={realtimeError}
        snapshot={snapshot}
      />
    );
  }

  if (role === "subtitle-style") {
    return <SubtitleStyleWindow />;
  }

  return (
    <main className="controlShell">
      <AppTitleBar
        canNavigateBack={sessionUi.lifecycle !== "idle" || sessionUi.startup.phase !== "idle"}
        pageTitle={pageTitleForSession(sessionUi)}
        statusLabel={snapshot.state === "listening" ? "同传中" : hasRealEvents ? "同传服务已连接" : "免费 1 小时"}
        onBack={requestReturnHome}
        onShowOverlay={() => window.echosyncDesktop?.setOverlayVisible(true)}
      />

      <section className="homeShell">
        <ControlCenter
          activeLine={activeLine}
          currentSource={currentSource}
          lines={lines}
          onShowOverlay={() => window.echosyncDesktop?.setOverlayVisible(true)}
          onSourceSelect={(nextSourceId) => setSourceId(nextSourceId)}
          onAsrLatencyModeSelect={setAsrLatencyMode}
          onAsrProviderSelect={setAsrProvider}
          onTranslationProviderSelect={setTranslationProvider}
          onTtsProviderSelect={setTtsProvider}
          onReturnHome={requestReturnHome}
          onStart={() => void startCapture()}
          onStop={() => void stopCapture()}
          overlayLocked={overlayLocked}
          dispatchSessionUi={dispatchSessionUi}
          sessionArchive={sessionArchive}
          sessionUi={sessionUi}
          agentCapabilities={agentCapabilities}
          agentCapabilitiesError={agentCapabilitiesError}
          asrLatencyMode={asrLatencyMode}
          asrProvider={asrProvider}
          sourceId={sourceId}
          toggleOverlayLocked={() => void toggleOverlayLocked()}
          translationProvider={translationProvider}
          ttsProvider={ttsProvider}
        />
      </section>
      {sessionUi.startup.phase !== "idle" ? (
        <SessionStartupOverlay
          startup={sessionUi.startup}
          onCancel={requestReturnHome}
          onReturnHome={() => void performReturnHome()}
          onRetry={() => void startCapture()}
        />
      ) : null}
      {navigationConfirmReason ? (
        <LeaveSessionDialog
          reason={navigationConfirmReason}
          onCancel={dismissNavigationDialog}
          onConfirm={() => void performReturnHome()}
        />
      ) : null}
    </main>
  );
}

function AppTitleBar({
  canNavigateBack,
  onBack,
  onShowOverlay,
  pageTitle,
  statusLabel
}: {
  canNavigateBack: boolean;
  onBack: () => void;
  onShowOverlay: () => void;
  pageTitle: string;
  statusLabel: string;
}) {
  return (
    <header className="titleBar">
      <div className="titleBarLeft">
        {canNavigateBack ? (
          <button aria-label="返回首页" className="backButton" title="返回首页" onClick={onBack}>
            ‹
          </button>
        ) : null}
        <div className="brand">
          <span className="brandDot" />
          <strong>{pageTitle}</strong>
        </div>
      </div>
      <div className="centerPill">{statusLabel}</div>
      <div className="windowActions">
        <button title="显示字幕窗" onClick={onShowOverlay}>
          实时字幕
        </button>
        <button title="最小化" onClick={() => window.echosyncDesktop?.minimize()}>
          -
        </button>
        <button title="最大化/还原" onClick={() => window.echosyncDesktop?.toggleMaximize()}>
          ⛶
        </button>
        <button title="关闭" onClick={() => window.echosyncDesktop?.close()}>
          ×
        </button>
      </div>
    </header>
  );
}

function LeaveSessionDialog({
  onCancel,
  onConfirm,
  reason
}: {
  onCancel: () => void;
  onConfirm: () => void;
  reason: Exclude<NavigationConfirmReason, null>;
}) {
  const copy = leaveDialogCopy[reason];
  return (
    <div className="modalScrim" role="presentation">
      <section aria-modal="true" className="confirmDialog" role="dialog">
        <h2>{copy.title}</h2>
        <p>{copy.detail}</p>
        <div className="dialogActions">
          <button className="safeAction" autoFocus onClick={onCancel}>
            {copy.cancelLabel}
          </button>
          <button className="dangerAction" onClick={onConfirm}>
            {copy.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function SessionStartupOverlay({
  onCancel,
  onReturnHome,
  onRetry,
  startup
}: {
  onCancel: () => void;
  onReturnHome: () => void;
  onRetry: () => void;
  startup: StartupUiState;
}) {
  const isFailed = startup.phase === "failed";
  return (
    <div className="startupScrim" role="presentation">
      <section aria-live="polite" className={`startupCard phase-${startup.phase}`} role={isFailed ? "alertdialog" : "status"}>
        <AudioLoadingBars active={!isFailed} />
        <h2>{startup.message || "正在启动同传..."}</h2>
        {startup.detail ? <p>{startup.detail}</p> : null}
        {isFailed ? (
          <div className="dialogActions">
            <button className="safeAction" onClick={onReturnHome}>
              返回首页
            </button>
            <button className="primaryAction" onClick={onRetry}>
              重试
            </button>
          </div>
        ) : startup.canCancel ? (
          <button className="startupCancel" onClick={onCancel}>
            取消启动
          </button>
        ) : null}
      </section>
    </div>
  );
}

function AudioLoadingBars({ active }: { active: boolean }) {
  return (
    <div className={active ? "audioLoadingBars active" : "audioLoadingBars"} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

const leaveDialogCopy: Record<Exclude<NavigationConfirmReason, null>, { title: string; detail: string; cancelLabel: string; confirmLabel: string }> = {
  active_session: {
    title: "停止同传并返回首页？",
    detail: "当前会话正在运行，返回首页会停止音频采集和实时字幕。",
    cancelLabel: "继续同传",
    confirmLabel: "停止并返回"
  },
  startup_cancel: {
    title: "取消启动并返回首页？",
    detail: "系统正在准备音频或连接同传服务，取消后会关闭本次启动流程。",
    cancelLabel: "继续等待",
    confirmLabel: "取消启动"
  },
  dirty_export: {
    title: "放弃导出前编辑？",
    detail: "当前复盘文本有未导出的修改，返回首页会丢弃这些编辑。",
    cancelLabel: "继续编辑",
    confirmLabel: "放弃并返回"
  }
};

function pageTitleForSession(sessionUi: ReturnType<typeof createInitialSessionUiState>) {
  if (sessionUi.startup.phase !== "idle") {
    return "启动同传";
  }
  if (sessionUi.lifecycle === "active") {
    return "正在同传";
  }
  if (sessionUi.lifecycle === "finished") {
    return "会话复盘";
  }
  return "EchoSync";
}

function ControlCenter({
  activeLine,
  agentCapabilities,
  agentCapabilitiesError,
  asrLatencyMode,
  asrProvider,
  currentSource,
  lines,
  onShowOverlay,
  onAsrLatencyModeSelect,
  onAsrProviderSelect,
  onSourceSelect,
  onTranslationProviderSelect,
  onTtsProviderSelect,
  onReturnHome,
  onStart,
  onStop,
  overlayLocked,
  dispatchSessionUi,
  sessionArchive,
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
  lines: CaptionLine[];
  onShowOverlay: () => void;
  onAsrLatencyModeSelect: (mode: AsrLatencyMode) => void;
  onAsrProviderSelect: (provider: AsrProviderSelection) => void;
  onSourceSelect: (sourceId: DesktopAudioSourceId) => void;
  onTranslationProviderSelect: (provider: TranslationProviderSelection) => void;
  onTtsProviderSelect: (provider: TtsProviderSelection) => void;
  onReturnHome: () => void;
  onStart: () => void;
  onStop: () => void;
  overlayLocked: boolean;
  dispatchSessionUi: (event: SessionUiEvent) => void;
  sessionArchive: SessionArchiveDraft | null;
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
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
          onShowOverlay={onShowOverlay}
          onAsrLatencyModeSelect={onAsrLatencyModeSelect}
          onAsrProviderSelect={onAsrProviderSelect}
          onSourceSelect={onSourceSelect}
          onTranslationProviderSelect={onTranslationProviderSelect}
          onTtsProviderSelect={onTtsProviderSelect}
          onStart={onStart}
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
          sessionUi={sessionUi}
        />
      ) : null}
    </section>
  );
}

function IdleDashboard({
  agentCapabilities,
  agentCapabilitiesError,
  asrLatencyMode,
  asrProvider,
  currentSource,
  onShowOverlay,
  onAsrLatencyModeSelect,
  onAsrProviderSelect,
  onSourceSelect,
  onTranslationProviderSelect,
  onTtsProviderSelect,
  onStart,
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
  onShowOverlay: () => void;
  onAsrLatencyModeSelect: (mode: AsrLatencyMode) => void;
  onAsrProviderSelect: (provider: AsrProviderSelection) => void;
  onSourceSelect: (sourceId: DesktopAudioSourceId) => void;
  onTranslationProviderSelect: (provider: TranslationProviderSelection) => void;
  onTtsProviderSelect: (provider: TtsProviderSelection) => void;
  onStart: () => void;
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
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
          <LauncherRow label="目标语言" value="English → 中文" />
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
          <button className="subtleAction" onClick={onShowOverlay}>{HOME_LAUNCHER_COPY.previewAction}</button>
        </div>

        <section className="subtitlePreview" aria-label="字幕窗预览">
          <span className="previewBadge">字幕窗预览</span>
          <div className="previewCaptionBubble">
            <p>The speaker is explaining how live captions work.</p>
            <strong>演讲者正在解释实时字幕的工作方式。</strong>
          </div>
        </section>

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
        isOpen={preferencesOpen}
        onAsrLatencyModeSelect={onAsrLatencyModeSelect}
        onAsrProviderSelect={onAsrProviderSelect}
        onClose={() => setPreferencesOpen(false)}
        onTranslationProviderSelect={onTranslationProviderSelect}
        onTtsProviderSelect={onTtsProviderSelect}
        translationProvider={translationProvider}
        ttsProvider={ttsProvider}
      />
      <SessionRecordsWindow isOpen={recordsOpen} onClose={() => setRecordsOpen(false)} />
    </div>
  );
}

function LauncherRow({
  children,
  label,
  value
}: {
  children?: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="launcherRow">
      <span>{label}</span>
      <strong>{value}</strong>
      {children ? <div className="launcherRowControl">{children}</div> : null}
    </div>
  );
}

function PreferenceSettingsPanel({
  agentCapabilities,
  asrLatencyMode,
  asrProvider,
  currentSource,
  isOpen,
  onAsrLatencyModeSelect,
  onAsrProviderSelect,
  onClose,
  onTranslationProviderSelect,
  onTtsProviderSelect,
  translationProvider,
  ttsProvider
}: {
  agentCapabilities: AgentCapabilities | null;
  asrLatencyMode: AsrLatencyMode;
  asrProvider: AsrProviderSelection;
  currentSource: DesktopAudioSource;
  isOpen: boolean;
  onAsrLatencyModeSelect: (mode: AsrLatencyMode) => void;
  onAsrProviderSelect: (provider: AsrProviderSelection) => void;
  onClose: () => void;
  onTranslationProviderSelect: (provider: TranslationProviderSelection) => void;
  onTtsProviderSelect: (provider: TtsProviderSelection) => void;
  translationProvider: TranslationProviderSelection;
  ttsProvider: TtsProviderSelection;
}) {
  const [activeSection, setActiveSection] = useState<"general" | "captions" | "quality" | "privacy">("general");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  if (!isOpen) {
    return null;
  }

  const asrOptions = ASR_PROVIDER_OPTIONS.filter((provider) => provider.id !== "mock");
  const translationOptions = TRANSLATION_PROVIDER_OPTIONS.filter((provider) => provider.id !== "mock");
  const ttsOptions = TTS_PROVIDER_OPTIONS;

  return (
    <aside className="engineSettingsPanel preferenceSettingsPanel" aria-label="偏好设置">
      <header>
        <div>
          <p>设置</p>
          <h2>偏好设置</h2>
        </div>
        <button aria-label="关闭偏好设置" onClick={onClose}>×</button>
      </header>
      <nav aria-label="设置分组">
        {PREFERENCE_SETTINGS_NAV.map((item) => (
          <button
            className={item.id === activeSection ? "selected" : ""}
            key={item.id}
            onClick={() => setActiveSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {activeSection === "general" ? (
        <section className="engineSettingsGroup">
          <h3>常规</h3>
          <PreferenceRow label="默认音频源" value={currentSource.label} />
          <PreferenceRow label="默认语言方向" value="English → 中文" />
          <PreferenceRow label="启动时打开字幕窗" value="开启" />
        </section>
      ) : null}
      {activeSection === "captions" ? (
        <section className="engineSettingsGroup">
          <h3>字幕</h3>
          <PreferenceRow label="显示模式" value="逐句对照" />
          <PreferenceRow label="字号" value="跟随字幕窗口" />
          <PreferenceRow label="位置" value="由字幕窗口控制" />
        </section>
      ) : null}
      {activeSection === "quality" ? (
        <section className="engineSettingsGroup">
          <h3>同传质量</h3>
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
          <PreferenceRow
            label="语音播报"
            value={ttsProviderLabel(ttsProvider, agentCapabilities?.defaults.tts_provider)}
          />
          <div className="choiceGroup qualityGroup">
            {ttsOptions.map((option) => (
              <button
                className={option.id === ttsProvider ? "selected" : ""}
                key={option.id}
                onClick={() => onTtsProviderSelect(option.id)}
                title={option.description}
              >
                {option.label}
              </button>
            ))}
          </div>
          <PreferenceRow label="引擎" value={translationProviderLabel(translationProvider, agentCapabilities?.defaults.translation_provider).replace("通用模型", "自动")} />
        </section>
      ) : null}
      {activeSection === "privacy" ? (
        <section className="engineSettingsGroup">
          <h3>记录与隐私</h3>
          <PreferenceRow label="保存原始音频" value="本次会话后询问" />
          <PreferenceRow label="保存双语记录" value="开启" />
          <PreferenceRow label="自动清理" value="关闭" />
        </section>
      ) : null}
      <details
        className="developerSettings advancedSettings"
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        open={advancedOpen}
      >
        <summary>{PREFERENCE_ADVANCED_ENTRY.label}</summary>
        {advancedOpen ? (
          <>
            <nav aria-label="高级设置分组">
              {ADVANCED_SETTINGS_NAV.map((item) => (
                <span key={item.id}>{item.label}</span>
              ))}
            </nav>
            <EngineChoiceRow
              label="语音识别"
              options={asrOptions.map((option) => ({
                id: option.id,
                label: engineOptionLabel(option.label, option.id),
                selected: option.id === asrProvider,
                onSelect: () => onAsrProviderSelect(option.id)
              }))}
              status={asrProviderLabel(asrProvider, agentCapabilities?.defaults.asr_provider).replace("后端默认", "自动")}
            />
            <EngineChoiceRow
              label="翻译"
              options={translationOptions.map((option) => ({
                id: option.id,
                label: engineOptionLabel(option.label, option.id),
                selected: option.id === translationProvider,
                onSelect: () => onTranslationProviderSelect(option.id)
              }))}
              status={translationProviderLabel(translationProvider, agentCapabilities?.defaults.translation_provider).replace("通用模型", "自动")}
            />
            <PreferenceRow label="故障处理" value="故障时尽量继续生成字幕" />
            <PreferenceRow label="性能诊断" value="按需导出诊断报告" />
            <PreferenceRow label="延迟日志" value="按需开启" />
            <PreferenceRow label="WebSocket 地址" value="由桌面端管理" />
            <PreferenceRow label="事件调试" value="开发者模式" />
            <div className="choiceGroup">
              <button
                className={asrProvider === "mock" ? "selected" : ""}
                onClick={() => onAsrProviderSelect("mock")}
              >
                Mock 引擎
              </button>
              <button
                className={translationProvider === "mock" ? "selected" : ""}
                onClick={() => onTranslationProviderSelect("mock")}
              >
                Mock 翻译
              </button>
            </div>
          </>
        ) : null}
      </details>
    </aside>
  );
}

function PreferenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="preferenceRow">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EngineChoiceRow({
  label,
  options,
  status
}: {
  label: string;
  options: Array<{ id: string; label: string; selected: boolean; onSelect: () => void }>;
  status: string;
}) {
  return (
    <div className="engineChoiceRow">
      <span>{label}</span>
      <strong>{status}</strong>
      <div className="choiceGroup">
        {options.map((option) => (
          <button className={option.selected ? "selected" : ""} key={option.id} onClick={option.onSelect}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function engineOptionLabel(label: string, id: string) {
  if (id === "server-default") {
    return "自动";
  }
  return label;
}

function ActiveDashboard({
  activeLine,
  agentCapabilities,
  asrLatencyMode,
  asrProvider,
  lines,
  onStop,
  overlayLocked,
  dispatchSessionUi,
  sessionUi,
  sourceId,
  toggleOverlayLocked
}: {
  activeLine?: CaptionLine;
  agentCapabilities: AgentCapabilities | null;
  asrLatencyMode: AsrLatencyMode;
  asrProvider: AsrProviderSelection;
  lines: CaptionLine[];
  onStop: () => void;
  overlayLocked: boolean;
  dispatchSessionUi: (event: SessionUiEvent) => void;
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
  sourceId: DesktopAudioSourceId;
  toggleOverlayLocked: () => void;
}) {
  return (
    <div className="dashboardGrid">
      <section className="dashboardPanel">
        <div className="activeToolbar">
          <span className="centerPill">同传中</span>
          <button onClick={onStop}>停止并复盘</button>
          <button className={overlayLocked ? "selected" : ""} onClick={toggleOverlayLocked}>
            {overlayLocked ? "穿透中" : "允许交互"}
          </button>
        </div>
        <TranscriptMonitor activeLine={activeLine} dispatchSessionUi={dispatchSessionUi} lines={lines} sessionUi={sessionUi} />
      </section>
      <aside className="dashboardPanel">
        <h2>正在同传</h2>
        <HealthMetric label="质量模式" value={asrLatencyModeLabel(asrLatencyMode)} />
        <HealthMetric label="字幕窗" value={overlayLocked ? "鼠标穿透" : "可交互"} />
        <LiveSessionStatusPanel lines={lines} sessionUi={sessionUi} sourceId={sourceId} />
        <details className="liveUtilityDetails">
          <summary>临时术语</summary>
          <TermQuickAdd dispatchSessionUi={dispatchSessionUi} sessionUi={sessionUi} />
        </details>
      </aside>
    </div>
  );
}

function FinishedDashboard({
  dispatchSessionUi,
  lines,
  onStart,
  sessionArchive,
  sessionUi
}: {
  dispatchSessionUi: (event: SessionUiEvent) => void;
  lines: CaptionLine[];
  onStart: () => void;
  sessionArchive: SessionArchiveDraft | null;
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
}) {
  const [editableTranscript, setEditableTranscript] = useState(() => transcriptLinesToEditableText(lines));
  const [exportStatus, setExportStatus] = useState("等待导出");
  const [playbackMs, setPlaybackMs] = useState(0);
  const cleanedLines = useMemo(() => editableTextToTranscriptLines(editableTranscript, lines), [editableTranscript, lines]);
  const activePlaybackSegmentId = useMemo(
    () => selectPlaybackSegmentId(cleanedLines, playbackMs),
    [cleanedLines, playbackMs]
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function cleanUpTranscript() {
    const nextLines = cleanTranscriptLines(cleanedLines);
    setEditableTranscript(transcriptLinesToEditableText(nextLines));
    dispatchSessionUi({ type: "pre_export.edited" });
    setExportStatus("已完成快速清理");
  }

  function seekToSegment(line: CaptionLine) {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.currentTime = line.startMs / 1000;
    setPlaybackMs(line.startMs);
    void audio.play();
  }

  async function copyMarkdown() {
    await window.echosyncDesktop?.copyText(serializeTranscriptMarkdown(cleanedLines));
    setExportStatus("Markdown 已复制");
  }

  async function copySrt() {
    await window.echosyncDesktop?.copyText(serializeTranscriptSrt(cleanedLines));
    setExportStatus("SRT 已复制");
  }

  function startNewSession() {
    dispatchSessionUi({ type: "session.reset" });
    onStart();
  }

  return (
    <div className="dashboardGrid">
      <section className="summaryPanel">
        <p className="eyebrow">本次复盘</p>
        <h1>{sessionArchive?.title ?? "同传已结束，可以清理后导出"}</h1>
        {sessionArchive ? (
          <section className="archivePlaybackPanel" aria-label="会话录音回放">
            <audio
              controls
              ref={audioRef}
              src={sessionArchive.audio.objectUrl}
              onTimeUpdate={(event) => setPlaybackMs(Math.round(event.currentTarget.currentTime * 1000))}
            />
            <span>{formatTime(playbackMs)} / {formatTime(sessionArchive.durationMs)}</span>
          </section>
        ) : (
          <p className="archiveMissing">本次会话没有可回放录音，仍可导出双语文本。</p>
        )}
        <TranscriptReviewGrid
          activeSegmentId={activePlaybackSegmentId}
          lines={cleanedLines}
          onLineClick={seekToSegment}
        />
        <details className="preExportDetails">
          <summary>编辑导出文本</summary>
          <textarea
            aria-label="导出前编辑"
            className="preExportEditor"
            onChange={(event) => {
              setEditableTranscript(event.target.value);
              dispatchSessionUi({ type: "pre_export.edited" });
              setExportStatus("有未导出的编辑");
            }}
            value={editableTranscript}
          />
        </details>
        <div className="startActions">
          <button onClick={() => void copyMarkdown()}>复制 Markdown</button>
          <button onClick={() => void copySrt()}>复制 SRT</button>
          <button onClick={cleanUpTranscript}>快速清理</button>
          <button onClick={startNewSession}>开始新会话</button>
        </div>
        <p className="exportStatus">{exportStatus}{sessionUi.preExportEdit.dirty ? " · 已编辑" : ""}</p>
      </section>
      <RecentSessionsPanel />
    </div>
  );
}

function TranscriptReviewGrid({
  activeSegmentId,
  lines,
  onLineClick
}: {
  activeSegmentId: string | null;
  lines: CaptionLine[];
  onLineClick: (line: CaptionLine) => void;
}) {
  return (
    <section className="transcriptReviewGrid" aria-label="双语会话记录">
      <div className="reviewColumn">
        <h2>原文</h2>
        {lines.map((line) => (
          <button
            className={line.id === activeSegmentId ? "reviewSegment active" : "reviewSegment"}
            key={`source-${line.id}`}
            onClick={() => onLineClick(line)}
          >
            <span>{formatTime(line.startMs)}-{formatTime(line.endMs)}</span>
            {line.sourceText}
          </button>
        ))}
      </div>
      <div className="reviewColumn">
        <h2>译文</h2>
        {lines.map((line) => (
          <button
            className={line.id === activeSegmentId ? "reviewSegment active" : "reviewSegment"}
            key={`target-${line.id}`}
            onClick={() => onLineClick(line)}
          >
            <span>{formatTime(line.startMs)}-{formatTime(line.endMs)}</span>
            {line.targetText}
          </button>
        ))}
      </div>
    </section>
  );
}

function PreflightAudioVisualizer({ sessionUi }: { sessionUi: ReturnType<typeof createInitialSessionUiState> }) {
  const width = `${Math.round(sessionUi.preflight.level.rms * 100)}%`;
  return (
    <div className="preflightMeter">
      <div className="meterTrack"><span className="meterFill" style={{ width }} /></div>
      <p>{sessionUi.preflight.warning ?? "音频输入正常，可以开始。"}</p>
    </div>
  );
}

function TranscriptMonitor({
  activeLine,
  dispatchSessionUi,
  lines,
  sessionUi
}: {
  activeLine?: CaptionLine;
  dispatchSessionUi: (event: SessionUiEvent) => void;
  lines: CaptionLine[];
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
}) {
  const monitorRef = useRef<HTMLDivElement | null>(null);
  const contentRevisionKey = lines.map((line) => `${line.id}:${line.rev}`).join("|");
  const visibleLines = lines.slice(-120);
  const previousContentRevisionKeyRef = useRef(contentRevisionKey);
  const dispatchRef = useRef(dispatchSessionUi);

  useEffect(() => {
    dispatchRef.current = dispatchSessionUi;
  }, [dispatchSessionUi]);

  useEffect(() => {
    if (previousContentRevisionKeyRef.current === contentRevisionKey) {
      return;
    }
    previousContentRevisionKeyRef.current = contentRevisionKey;
    dispatchRef.current({ type: "transcript.new_content" });

    if (sessionUi.autoScroll.mode === "following") {
      window.requestAnimationFrame(() => scrollTranscriptToBottom(monitorRef.current));
    }
  }, [contentRevisionKey, sessionUi.autoScroll.mode]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom > 72 && sessionUi.autoScroll.mode === "following") {
      dispatchSessionUi({ type: "transcript.user.scrolled_up" });
    }
    if (distanceToBottom < 24 && sessionUi.autoScroll.mode === "locked") {
      dispatchSessionUi({ type: "transcript.user.follow_current" });
    }
  }

  function handleSelection() {
    const selectedText = window.getSelection()?.toString().trim();
    if (selectedText && sessionUi.autoScroll.mode === "following") {
      dispatchSessionUi({ type: "transcript.user.selected_text" });
    }
  }

  function followCurrent() {
    dispatchSessionUi({ type: "transcript.user.follow_current" });
    window.requestAnimationFrame(() => scrollTranscriptToBottom(monitorRef.current));
  }

  return (
    <div
      className={sessionUi.autoScroll.mode === "locked" ? "transcriptMonitor locked" : "transcriptMonitor"}
      onMouseUp={handleSelection}
      onScroll={handleScroll}
      ref={monitorRef}
    >
      {sessionUi.autoScroll.mode === "locked" ? <div className="autoScrollState">已锁定回溯，新片段不会打断阅读。</div> : null}
      {visibleLines.map((line) => (
        <article className={`transcriptItem ${line.state}`} key={line.id}>
          <span>{formatTime(line.startMs)}-{formatTime(line.endMs)} · {captionStateDisplayLabel(line.state)}</span>
          <p className="sourceText">{line.sourceText}</p>
          <p className="targetText">{line.targetText}</p>
        </article>
      ))}
      {activeLine ? <p className="statusBox">当前片段：{activeLine.targetText}</p> : null}
      {sessionUi.autoScroll.newContentAvailable ? <button className="newContentButton" onClick={followCurrent}>有新内容，回到当前</button> : null}
    </div>
  );
}

function HealthPanel({
  lines,
  sessionUi,
  sourceId
}: {
  lines: CaptionLine[];
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
  sourceId: DesktopAudioSourceId;
}) {
  const metrics = selectSessionHealthMetrics({ lines, sessionUi, sourceLabel: sourceLabel(sourceId) });
  return (
    <div className="healthGrid">
      <HealthMetric label="输入源" value={metrics.inputSource} />
      <HealthMetric label="音频活动" value={audioActivityLabel(metrics.audioLevel)} />
      <HealthMetric label="首字幕" value={formatMetricMs(metrics.firstCaptionLatencyMs)} />
      <HealthMetric label="稳定提交" value={formatMetricMs(metrics.stableCommitLatencyMs)} />
      <HealthMetric label="自动修订" value={`${metrics.patchCount} 次`} />
      <HealthMetric label="稳定度" value={formatPercent(metrics.averageStability)} />
      <HealthMetric label="置信来源" value={metrics.confidenceLabel} />
    </div>
  );
}

function LiveSessionStatusPanel({
  lines,
  sessionUi,
  sourceId
}: {
  lines: CaptionLine[];
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
  sourceId: DesktopAudioSourceId;
}) {
  const metrics = selectSessionHealthMetrics({ lines, sessionUi, sourceLabel: sourceLabel(sourceId) });
  return (
    <div className="healthGrid liveStatusGrid">
      <HealthMetric label="音频输入" value={audioActivityLabel(metrics.audioLevel)} />
      <HealthMetric label="延迟" value={formatMetricMs(metrics.firstCaptionLatencyMs)} />
      <HealthMetric label="稳定提交" value={formatMetricMs(metrics.stableCommitLatencyMs)} />
      <HealthMetric label="自动修订" value={`${metrics.patchCount} 次`} />
    </div>
  );
}

function HealthMetric({ label, value }: { label: string; value: string }) {
  return <div className="healthMetric"><span>{label}</span><strong>{value}</strong></div>;
}

function TermQuickAdd({
  dispatchSessionUi,
  sessionUi
}: {
  dispatchSessionUi: (event: SessionUiEvent) => void;
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
}) {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const syncTimersRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      syncTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  function submitTerm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSource = source.trim();
    const nextTarget = target.trim();
    if (!nextSource || !nextTarget) {
      return;
    }

    const nextId = `term_${sessionUi.terms.length + 1}`;
    dispatchSessionUi({ type: "term.add.requested", source: nextSource, target: nextTarget });
    const timer = window.setTimeout(() => {
      dispatchSessionUi({ type: "term.add.synced", id: nextId });
    }, 700);
    syncTimersRef.current.push(timer);
    setSource("");
    setTarget("");
  }

  return (
    <section className="termQuickAdd">
      <h3>临时术语</h3>
      <form className="termForm" onSubmit={submitTerm}>
        <input aria-label="原文术语" onChange={(event) => setSource(event.target.value)} placeholder="latency" value={source} />
        <input aria-label="译文术语" onChange={(event) => setTarget(event.target.value)} placeholder="延迟" value={target} />
        <button type="submit">加入</button>
      </form>
      <div className="termList">
        {sessionUi.terms.length > 0 ? (
          sessionUi.terms.slice(-4).map((term) => (
            <div className="termItem" key={term.id}>
              <span>{term.source} -&gt; {term.target}</span>
              <strong className={`termStatus ${term.status}`}>{termStatusLabel(term.status)}</strong>
            </div>
          ))
        ) : (
          <p className="statusBox">新术语会先同步，完成后从后续片段开始生效。</p>
        )}
      </div>
    </section>
  );
}

function SessionSummaryPanel({
  lines,
  sessionUi
}: {
  lines: CaptionLine[];
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
}) {
  return (
    <div className="summaryMetrics">
      <HealthMetric label="片段数" value={`${sessionUi.summary?.segmentCount ?? lines.length}`} />
      <HealthMetric label="修订次数" value={`${sessionUi.summary?.patchCount ?? 0}`} />
      <HealthMetric label="总字数" value={`${sessionUi.summary?.wordCount ?? 0}`} />
      <HealthMetric label="平均延迟" value={`${sessionUi.summary?.averageLatencyMs ?? 0} ms`} />
    </div>
  );
}

type SessionRecordListItem = {
  id: string;
  title: string;
  endedAt: string;
  duration: string;
  sourceText: string;
  targetText: string;
};

const recentSessionRecords: SessionRecordListItem[] = [
  {
    id: "record_2",
    title: "2026年06月06日_记录_2",
    endedAt: "2026年06月06日 09:57",
    duration: "4分钟",
    sourceText: "The speaker is explaining how live captions work.",
    targetText: "演讲者正在解释实时字幕的工作方式。"
  },
  {
    id: "record_1",
    title: "2026年06月06日_记录_1",
    endedAt: "2026年06月06日 09:26",
    duration: "15分钟",
    sourceText: "Latency matters for simultaneous interpretation.",
    targetText: "延迟对同声传译体验非常关键。"
  },
  {
    id: "record_0",
    title: "2026年06月06日_记录",
    endedAt: "2026年06月06日 09:10",
    duration: "1分钟",
    sourceText: "The session has been saved locally.",
    targetText: "本次记录已保存在本地。"
  }
];

function RecentSessionsPanel() {
  return (
    <aside className="dashboardPanel recentRecordsPanel">
      <h2>会议记录</h2>
      <SessionRecordTable compact records={recentSessionRecords.slice(0, 2)} />
    </aside>
  );
}

function SessionRecordsWindow({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [records, setRecords] = useState(recentSessionRecords);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [reviewScale, setReviewScale] = useState(1);
  const selectedRecord = selectedId ? records.find((record) => record.id === selectedId) ?? null : null;
  const isDetailView = Boolean(selectedRecord);

  if (!isOpen) {
    return null;
  }

  function deleteRecord(recordId: string) {
    setRecords((current) => current.filter((record) => record.id !== recordId));
    setDeleteId(null);
    if (selectedId === recordId) {
      setSelectedId(null);
    }
  }

  return (
    <aside className="recordWindow" aria-label="会议记录">
      <header className={isDetailView ? "recordHeader detail" : "recordHeader"}>
        <div>
          <p>{isDetailView ? "内容自动保存 · 数据安全保护 · 译文由 AI 生成" : "记录"}</p>
          <h2>{selectedRecord?.title ?? "会议记录"}</h2>
        </div>
        {!isDetailView ? (
          <label>
            <span>搜索会议名称</span>
            <input aria-label="搜索会议名称" placeholder="搜索会议名称" />
          </label>
        ) : null}
        {isDetailView ? <button className="recordBackButton" onClick={() => setSelectedId(null)}>返回列表</button> : null}
        <button aria-label="关闭会议记录" onClick={onClose}>×</button>
      </header>
      {!isDetailView ? (
        <>
          <SessionRecordTable
            onDelete={(recordId) => setDeleteId(recordId)}
            onView={(recordId) => setSelectedId(recordId)}
            records={records}
          />
          {deleteId ? (
            <section className="recordDeleteConfirm" role="alert">
              <span>删除后将移除本地记录。</span>
              <button onClick={() => setDeleteId(null)}>取消</button>
              <button onClick={() => deleteRecord(deleteId)}>确认删除</button>
            </section>
          ) : null}
          {records.length === 0 ? <p className="archiveMissing">暂无已保存记录。</p> : null}
        </>
      ) : null}
      {selectedRecord ? (
        <section className="recordDetailPanel" aria-label="记录详情">
          <header>
            <div>
              <p>点击片段可定位回放，播放时会高亮对应文本。</p>
              <h3>双语复盘</h3>
            </div>
            <div className="recordDetailActions">
              <button onClick={() => setReviewScale((value) => Math.max(0.9, Number((value - 0.05).toFixed(2))))}>字号 -</button>
              <button onClick={() => setReviewScale((value) => Math.min(1.25, Number((value + 0.05).toFixed(2))))}>字号 +</button>
              <button className="primaryAction">导出</button>
            </div>
          </header>
          <div className="recordAudioPlayer" aria-label="原始音频回放">
            <button className="roundRecordButton" aria-label="播放原始音频">▶</button>
            <span>原始音频回放</span>
            <progress max={100} value={34} />
            <time>00:00 / {selectedRecord.duration}</time>
          </div>
          <div className="recordTranscriptPair" style={{ fontSize: `${reviewScale}em` }}>
            <article className="active">
              <h4>原文</h4>
              <time>00:00-00:18</time>
              <p>{selectedRecord.sourceText}</p>
            </article>
            <article className="active">
              <h4>译文</h4>
              <time>00:00-00:18</time>
              <p>{selectedRecord.targetText}</p>
            </article>
          </div>
          <details className="recordDiagnostics">
            <summary>诊断信息</summary>
            <div>
              <span>首字幕延迟：按需生成</span>
              <span>平均识别延迟：按需生成</span>
              <span>平均翻译延迟：按需生成</span>
              <span>字幕显示延迟：按需生成</span>
            </div>
          </details>
        </section>
      ) : null}
    </aside>
  );
}

function SessionRecordTable({
  compact = false,
  onDelete,
  onView,
  records,
  selectedId
}: {
  compact?: boolean;
  onDelete?: (recordId: string) => void;
  onView?: (recordId: string) => void;
  records: SessionRecordListItem[];
  selectedId?: string;
}) {
  return (
    <div className={compact ? "recordTable compact" : "recordTable"} role="table" aria-label="会议记录列表">
      <div className="recordTableHead" role="row">
        {RECORD_LIST_COLUMNS.map((column) => (
          <span key={column} role="columnheader">{column}</span>
        ))}
      </div>
      {records.map((record) => (
        <div className={record.id === selectedId ? "recordTableRow selected" : "recordTableRow"} key={record.id} role="row">
          <strong role="cell">{record.title}</strong>
          <span role="cell">{record.endedAt}</span>
          <span role="cell">{record.duration}</span>
          <span className="recordActions" role="cell">
            <button onClick={() => onView?.(record.id)}>查看</button>
            <button onClick={() => onDelete?.(record.id)}>删除</button>
          </span>
        </div>
      ))}
    </div>
  );
}

function OverlayWindow({
  activeLine,
  lines,
  onSourceStart,
  onStop,
  realtimeError,
  snapshot
}: {
  activeLine?: CaptionLine;
  lines: CaptionLine[];
  onSourceStart: (sourceId: DesktopAudioSourceId) => void;
  onStop: () => void;
  realtimeError: string | null;
  snapshot: DesktopCaptureSnapshot;
}) {
  const isListening = snapshot.state === "listening";
  const [interaction, setInteraction] = useState(createInitialOverlayInteractionState);
  const { subtitleStyle, updateSubtitleStyle } = useSharedSubtitleStyle();
  const isPinned = interaction.layer === "pinned";
  const showChrome = interaction.layer === "controls" || interaction.layer === "settings" || isPinned;
  const [displayBuffer, setDisplayBuffer] = useState<CaptionDisplayBuffer>(createInitialCaptionDisplayBuffer);
  const displayBufferRef = useRef<CaptionDisplayBuffer>(displayBuffer);
  const [displayNowMs, setDisplayNowMs] = useState(() => Date.now());
  const [sessionStartedAtMs, setSessionStartedAtMs] = useState<number | null>(null);
  const [sessionNowMs, setSessionNowMs] = useState(() => Date.now());
  const displaySelection = useMemo(
    () => selectDisplayCaptionLines(displayBuffer, lines, displayNowMs),
    [displayBuffer, displayNowMs, lines]
  );
  const displayMode = normalizeSubtitleDisplayMode(subtitleStyle.displayMode);
  const displayPresentation = useMemo(
    () => selectDisplayCaptionPresentation(displaySelection, displayMode),
    [displayMode, displaySelection]
  );
  const displayActiveLine = displayPresentation.activeLine ?? displayPresentation.settlingLines.at(-1);
  const captionLineForDisplay = displayActiveLine ?? activeLine;
  const historyLines = useMemo(
    () => selectOverlayHistoryLinesForDisplay(interaction.layer, displayPresentation.historyLines, displayActiveLine?.id, displayMode),
    [displayActiveLine?.id, displayMode, displayPresentation.historyLines, interaction.layer]
  );
  const settlingLines = useMemo(
    () => displayPresentation.settlingLines.filter((line) => line.id !== displayActiveLine?.id),
    [displayActiveLine?.id, displayPresentation.settlingLines]
  );
  const [overlayInteractionLocked, setOverlayInteractionLocked] = useState(false);
  const subtitleVars = {
    "--subtitle-bg-opacity": subtitleStyle.backgroundOpacity,
    "--subtitle-blur": `${subtitleStyle.backgroundBlur}px`,
    "--caption-shadow-alpha": subtitleStyle.windowShadow,
    "--source-size": `${subtitleStyle.sourceScale}px`,
    "--target-size": `${subtitleStyle.targetScale}px`,
    "--source-color": subtitleStyle.sourceColor,
    "--target-color": subtitleStyle.targetColor
  } as CSSProperties;

  function dispatchOverlay(event: OverlayInteractionEvent) {
    setInteraction((current) => reduceOverlayInteraction(current, event));
  }

  useEffect(() => {
    displayBufferRef.current = displayBuffer;
  }, [displayBuffer]);

  useEffect(() => {
    const nextSelection = selectDisplayCaptionLines(displayBufferRef.current, lines, Date.now());
    displayBufferRef.current = nextSelection.buffer;
    setDisplayBuffer(nextSelection.buffer);
  }, [lines]);

  useEffect(() => {
    if (displaySelection.pendingLineIds.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      const nowMs = Date.now();
      const nextSelection = selectDisplayCaptionLines(displayBufferRef.current, lines, nowMs);
      displayBufferRef.current = nextSelection.buffer;
      setDisplayBuffer(nextSelection.buffer);
      setDisplayNowMs(nowMs);
    }, 24);
    return () => window.clearTimeout(timer);
  }, [displaySelection.pendingLineIds.length, displayNowMs, lines]);

  useEffect(() => {
    const remove = window.echosyncDesktop?.onOverlayWake(() => {
      dispatchOverlay({ type: "fallback.wake" });
    });
    return () => remove?.();
  }, []);

  useEffect(() => {
    void window.echosyncDesktop?.setOverlayLayer(interaction.layer);
  }, [interaction.layer]);

  useEffect(() => {
    if (!isListening) {
      setSessionStartedAtMs(null);
      return;
    }

    const startedAt = Date.now();
    setSessionStartedAtMs((current) => current ?? startedAt);
    setSessionNowMs(startedAt);
    const timer = window.setInterval(() => setSessionNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [isListening]);

  const sessionDurationMs = selectSessionClockMs({
    isListening,
    lines,
    nowMs: sessionNowMs,
    startedAtMs: sessionStartedAtMs
  });

  async function toggleOverlayInteractionLock() {
    const nextLocked = !overlayInteractionLocked;
    setOverlayInteractionLocked(nextLocked);
    await window.echosyncDesktop?.setOverlayLocked(nextLocked);
    if (nextLocked) {
      dispatchOverlay({ type: "pointer.left", atMs: Date.now() });
    } else {
      dispatchOverlay({ type: "fallback.wake" });
    }
  }

  async function toggleOverlayCapture() {
    if (isListening) {
      onStop();
      return;
    }
    onSourceStart(snapshot.sourceId);
  }

  async function selectMicrophoneCapture() {
    onSourceStart("microphone");
  }

  return (
    <main className={`overlayShell pointer-${interaction.pointerMode}`}>
      <section
        className={`overlayStage layer-${interaction.layer}`}
        tabIndex={0}
        aria-label="EchoSync 实时双语字幕悬浮窗"
        onMouseEnter={() => {
          const atMs = Date.now();
          dispatchOverlay({ type: "pointer.entered", atMs });
          window.setTimeout(() => dispatchOverlay({ type: "hover.timer.elapsed", atMs: Date.now() }), 220);
        }}
        onMouseLeave={() => {
          const atMs = Date.now();
          dispatchOverlay({ type: "pointer.left", atMs });
          window.setTimeout(() => dispatchOverlay({ type: "collapse.timer.elapsed", atMs: Date.now() }), 340);
        }}
      >
        <section
          className={`floatingCaption captionWindow ${showChrome ? "withChrome" : ""} ${historyLines.length > 0 || settlingLines.length > 0 ? "hasHistory" : ""} mode-${displayMode} outline-${subtitleStyle.outlineStyle}`}
          style={subtitleVars}
        >
          {showChrome ? (
            <div className="captionTopChrome">
              <OverlayToolbar
                isPinned={isPinned}
                isSettingsOpen={false}
                isInteractionLocked={overlayInteractionLocked}
                onInteractionLockToggle={() => void toggleOverlayInteractionLock()}
                onPinToggle={() => {
                  const nextPinned = !isPinned;
                  dispatchOverlay(nextPinned ? { type: "pin.enabled" } : { type: "pin.disabled" });
                  if (nextPinned && overlayInteractionLocked) {
                    setOverlayInteractionLocked(false);
                  }
                  void window.echosyncDesktop?.setOverlayPinned(nextPinned);
                }}
                onRecenter={() => void window.echosyncDesktop?.recenterOverlay()}
                onSettingsToggle={() => void window.echosyncDesktop?.setSubtitleStyleWindowVisible(true)}
                onWakeHome={() => void window.echosyncDesktop?.wakeOverlayControls()}
                onClose={() => void window.echosyncDesktop?.setOverlayVisible(false)}
              />
            </div>
          ) : null}
          {historyLines.length > 0 ? <OverlayCaptionHistory lines={historyLines} subtitleStyle={subtitleStyle} /> : null}
          {settlingLines.length > 0 ? <OverlayCaptionHistory lines={settlingLines} subtitleStyle={subtitleStyle} variant="settling" /> : null}
          <CaptionText line={captionLineForDisplay} subtitleStyle={subtitleStyle} />
          {realtimeError ? <p className="overlayError">{realtimeError}</p> : null}
          <div className="overlayMeta">
            <span className={`liveDot state-${snapshot.state}`} />
            <span>{isListening ? "正在同传" : "实时字幕"}</span>
            <span>{displayActiveLine ? `${formatTime(displayActiveLine.startMs)}-${formatTime(displayActiveLine.endMs)}` : "等待时间帧"}</span>
            <span>{sourceLabel(snapshot.sourceId)}</span>
          </div>
          {showChrome ? (
            <div className="captionBottomChrome">
              <OverlaySessionBar
                durationMs={sessionDurationMs}
                isListening={isListening}
                onCaptureToggle={() => void toggleOverlayCapture()}
                onDisplayModeChange={(displayMode) => updateSubtitleStyle({ displayMode })}
                onMicrophoneSelect={() => void selectMicrophoneCapture()}
                snapshot={snapshot}
                subtitleStyle={subtitleStyle}
              />
            </div>
          ) : null}
          <OverlayResizeHandles
            onResizeEnd={() => dispatchOverlay({ type: "drag.ended" })}
            onResizeStart={() => dispatchOverlay({ type: "drag.started" })}
          />
        </section>
      </section>
    </main>
  );
}

type OverlayResizeDirection = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

function OverlayResizeHandles({ onResizeEnd, onResizeStart }: { onResizeEnd: () => void; onResizeStart: () => void }) {
  const directions: OverlayResizeDirection[] = ["n", "e", "s", "w", "ne", "nw", "se", "sw"];

  function startResize(direction: OverlayResizeDirection, event: ReactPointerEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    onResizeStart();
    const startX = event.screenX;
    const startY = event.screenY;
    let initialBounds: DesktopWindowBounds | null = null;
    let frame: number | null = null;
    let pendingBounds: Partial<DesktopWindowBounds> | null = null;
    let stopped = false;

    function scheduleResize(bounds: Partial<DesktopWindowBounds>) {
      pendingBounds = bounds;
      if (frame !== null) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const nextBounds = pendingBounds;
        pendingBounds = null;
        if (nextBounds) {
          void window.echosyncDesktop?.resizeOverlay(nextBounds);
        }
      });
    }

    function stopResize() {
      if (stopped) {
        return;
      }
      stopped = true;
      window.removeEventListener("pointermove", moveResize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      if (pendingBounds) {
        void window.echosyncDesktop?.resizeOverlay(pendingBounds);
        pendingBounds = null;
      }
      onResizeEnd();
    }

    function moveResize(moveEvent: PointerEvent) {
      if (!initialBounds) {
        return;
      }
      const dx = moveEvent.screenX - startX;
      const dy = moveEvent.screenY - startY;
      scheduleResize(resizeBoundsFromPointer(direction, initialBounds, dx, dy));
    }

    window.addEventListener("pointermove", moveResize);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", stopResize, { once: true });

    void window.echosyncDesktop?.getOverlayBounds().then((startBounds) => {
      if (!startBounds) {
        return;
      }
      initialBounds = startBounds;
    });
  }

  return (
    <div className="overlayResizeHandles" aria-hidden="true">
      {directions.map((direction) => (
        <span
          className={`resizeHandle resize-${direction}`}
          key={direction}
          onPointerDown={(event) => startResize(direction, event)}
        />
      ))}
    </div>
  );
}

function resizeBoundsFromPointer(
  direction: OverlayResizeDirection,
  bounds: DesktopWindowBounds,
  dx: number,
  dy: number
): Partial<DesktopWindowBounds> {
  const next: Partial<DesktopWindowBounds> = {};
  if (direction.includes("e")) {
    next.width = bounds.width + dx;
  }
  if (direction.includes("s")) {
    next.height = bounds.height + dy;
  }
  if (direction.includes("w")) {
    next.x = bounds.x + dx;
    next.width = bounds.width - dx;
  }
  if (direction.includes("n")) {
    next.y = bounds.y + dy;
    next.height = bounds.height - dy;
  }
  return next;
}

function CaptionText({ line, subtitleStyle }: { line?: CaptionLine; subtitleStyle: SubtitleStyleState }) {
  const parts = selectCaptionTextParts(line, subtitleStyle);
  const displayMode = normalizeSubtitleDisplayMode(subtitleStyle.displayMode);

  return (
    <div className={`captionText mode-${displayMode}`}>
      {parts.map((part) => {
        if (part.kind === "source") {
          return (
            <p
              className={`overlaySource ${part.state}`}
              key="source"
              style={{ fontFamily: fontFamilyValue(subtitleStyle.sourceFont), fontWeight: selectSubtitleFontWeight("source", subtitleStyle.sourceBold) }}
            >
              {part.text}
            </p>
          );
        }

        return (
          <h1
            aria-hidden={part.isPlaceholder ? true : undefined}
            className={`${part.state}${part.isPlaceholder ? " placeholderText" : ""}`}
            key="target"
            style={{ fontFamily: fontFamilyValue(subtitleStyle.targetFont), fontWeight: selectSubtitleFontWeight("target", subtitleStyle.targetBold) }}
          >
            {part.text}
          </h1>
        );
      })}
    </div>
  );
}

function OverlayCaptionHistory({
  lines,
  subtitleStyle,
  variant = "history"
}: {
  lines: CaptionLine[];
  subtitleStyle: SubtitleStyleState;
  variant?: "history" | "settling";
}) {
  const historyRef = useRef<HTMLDivElement | null>(null);
  const lineIds = lines.map((line) => line.id).join("|");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => scrollTranscriptToBottom(historyRef.current));
    return () => window.cancelAnimationFrame(frame);
  }, [lineIds]);

  return (
    <div className={`overlayCaptionHistory ${variant}`} ref={historyRef}>
      {lines.map((line, index, visibleLines) => (
        <article className={`historyLine ${line.state} ${index === visibleLines.length - 1 ? "current" : ""}`} key={line.id}>
          <CaptionText line={line} subtitleStyle={subtitleStyle} />
        </article>
      ))}
    </div>
  );
}

function OverlayToolbar({
  isPinned,
  isInteractionLocked,
  isSettingsOpen,
  onInteractionLockToggle,
  onClose,
  onPinToggle,
  onRecenter,
  onSettingsToggle,
  onWakeHome
}: {
  isPinned: boolean;
  isInteractionLocked: boolean;
  isSettingsOpen: boolean;
  onInteractionLockToggle: () => void;
  onClose: () => void;
  onPinToggle: () => void;
  onRecenter: () => void;
  onSettingsToggle: () => void;
  onWakeHome: () => void;
}) {
  return (
    <nav className="overlayToolbar" aria-label="字幕弹窗工具栏">
      <button className={isSettingsOpen ? "selected" : ""} title="字幕样式" onClick={onSettingsToggle}>
        <ToolbarIcon name="settings" />
      </button>
      <button className={isInteractionLocked ? "selected" : ""} title={isInteractionLocked ? "恢复鼠标交互" : "鼠标穿透"} onClick={onInteractionLockToggle}>
        <ToolbarIcon name="lock" />
      </button>
      <button className={isPinned ? "selected" : ""} title={isPinned ? "取消驻留" : "驻留字幕"} onClick={onPinToggle}>
        <ToolbarIcon name="pin" />
      </button>
      <button title="召回居中" onClick={onRecenter}>
        <ToolbarIcon name="target" />
      </button>
      <button title="唤醒控制" onClick={onWakeHome}>
        <ToolbarIcon name="more" />
      </button>
      <button title="隐藏字幕窗" onClick={onClose}>
        <ToolbarIcon name="close" />
      </button>
    </nav>
  );
}

function OverlaySessionBar({
  durationMs,
  isListening,
  onCaptureToggle,
  onDisplayModeChange,
  onMicrophoneSelect,
  snapshot,
  subtitleStyle
}: {
  durationMs: number;
  isListening: boolean;
  onCaptureToggle: () => void;
  onDisplayModeChange: (mode: SubtitleDisplayMode) => void;
  onMicrophoneSelect: () => void;
  snapshot: DesktopCaptureSnapshot;
  subtitleStyle: SubtitleStyleState;
}) {
  const displayMode = normalizeSubtitleDisplayMode(subtitleStyle.displayMode);
  return (
    <div className="overlaySessionBar">
      <button
        className={snapshot.sourceId === "microphone" ? "roundSessionButton active" : "roundSessionButton"}
        title="切换到麦克风"
        onClick={onMicrophoneSelect}
      >
        <ToolbarIcon name="mic" />
      </button>
      <button
        className={isListening ? "roundSessionButton active" : "roundSessionButton"}
        title={isListening ? "停止同传" : "开始同传"}
        onClick={onCaptureToggle}
      >
        <ToolbarIcon name="power" />
      </button>
      <span className="sessionTimer">{formatClock(durationMs)}</span>
      <span className="sessionPill">{isListening ? "同传中" : "待开始"}</span>
      <span className="sessionPill">{sourceLabel(snapshot.sourceId)}</span>
      <details className="displayModePicker">
        <summary>{subtitleDisplayModeLabel(displayMode)}</summary>
        <div className="displayModeMenu">
          <button className={displayMode === "sentencePair" ? "selected" : ""} onClick={() => onDisplayModeChange("sentencePair")}>
            逐句对照
          </button>
          <button className={displayMode === "zonedPair" ? "selected" : ""} onClick={() => onDisplayModeChange("zonedPair")}>
            分区对照
          </button>
        </div>
      </details>
    </div>
  );
}

function SubtitleStyleWindow() {
  const { subtitleStyle, updateSubtitleStyle } = useSharedSubtitleStyle();

  return (
    <main className="subtitleStyleWindowShell">
      <SubtitleStylePanel
        onChange={updateSubtitleStyle}
        onClose={() => void window.echosyncDesktop?.setSubtitleStyleWindowVisible(false)}
        subtitleStyle={subtitleStyle}
      />
    </main>
  );
}

function SubtitleStylePanel({
  onChange,
  onClose,
  subtitleStyle
}: {
  onChange: (next: Partial<SubtitleStyleState>) => void;
  onClose: () => void;
  subtitleStyle: SubtitleStyleState;
}) {
  return (
    <aside className="subtitleStylePanel" aria-label="字幕样式设置">
      <header className="subtitleStylePanelHandle">
        <div>
          <strong>字幕样式</strong>
          <span>独立窗口</span>
        </div>
        <button title="关闭设置" onClick={onClose}>
          <ToolbarIcon name="close" />
        </button>
      </header>
      <div className="subtitleStylePanelBody">
        <StyleSection title="原文字幕">
          <StepperRow label="字号" max={28} min={12} onChange={(sourceScale) => onChange({ sourceScale })} value={subtitleStyle.sourceScale} />
          <SwatchRow label="颜色" onChange={(sourceColor) => onChange({ sourceColor })} value={subtitleStyle.sourceColor} />
          <SelectRow label="字体" onChange={(sourceFont) => onChange({ sourceFont })} options={fontOptions} value={subtitleStyle.sourceFont} />
          <SwitchRow label="加粗" onChange={(sourceBold) => onChange({ sourceBold })} value={subtitleStyle.sourceBold} />
        </StyleSection>
        <StyleSection title="译文字幕">
          <StepperRow label="字号" max={40} min={20} onChange={(targetScale) => onChange({ targetScale })} value={subtitleStyle.targetScale} />
          <SwatchRow label="颜色" onChange={(targetColor) => onChange({ targetColor })} value={subtitleStyle.targetColor} />
          <SelectRow label="字体" onChange={(targetFont) => onChange({ targetFont })} options={fontOptions} value={subtitleStyle.targetFont} />
          <SwitchRow label="加粗" onChange={(targetBold) => onChange({ targetBold })} value={subtitleStyle.targetBold} />
        </StyleSection>
        <StyleSection title="其他设置">
          <StepperRow label="背景透明度" max={0.95} min={0.35} onChange={(backgroundOpacity) => onChange({ backgroundOpacity })} step={0.05} value={subtitleStyle.backgroundOpacity} />
          <StepperRow label="背景模糊" max={36} min={0} onChange={(backgroundBlur) => onChange({ backgroundBlur })} step={2} value={subtitleStyle.backgroundBlur} />
          <StepperRow label="窗口阴影" max={1} min={0} onChange={(windowShadow) => onChange({ windowShadow })} step={0.05} value={subtitleStyle.windowShadow} />
          <SelectRow
            label="描边样式"
            onChange={(outlineStyle) => onChange({ outlineStyle: outlineStyle as SubtitleOutlineStyle })}
            options={["shadow", "outline", "none"]}
            value={subtitleStyle.outlineStyle}
          />
          <SelectRow
            label="显示模式"
            onChange={(displayMode) => onChange({ displayMode: displayMode as SubtitleDisplayMode })}
            options={["sentencePair", "zonedPair"]}
            value={subtitleStyle.displayMode}
          />
          <ActionRow
            label="窗口位置"
            actions={[
              { label: "锁定位置", onClick: () => void window.echosyncDesktop?.setOverlayPinned(true) },
              { label: "重置位置", onClick: () => void window.echosyncDesktop?.recenterOverlay() }
            ]}
          />
          <ActionRow
            label="鼠标交互"
            actions={[
              { label: "鼠标穿透", onClick: () => void window.echosyncDesktop?.setOverlayLocked(true) },
              { label: "允许点击", onClick: () => void window.echosyncDesktop?.setOverlayLocked(false) }
            ]}
          />
        </StyleSection>
      </div>
    </aside>
  );
}

function StyleSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="styleSection">
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function StepperRow({
  label,
  max,
  min,
  onChange,
  step = 1,
  value
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  const displayValue = step < 1 ? value.toFixed(2) : Math.round(value).toString();
  return (
    <label className="settingRow">
      <span>{label}</span>
      <div className="stepper">
        <button type="button" onClick={() => onChange(Math.max(min, Number((value - step).toFixed(2))))}>-</button>
        <output>{displayValue}</output>
        <button type="button" onClick={() => onChange(Math.min(max, Number((value + step).toFixed(2))))}>+</button>
      </div>
    </label>
  );
}

function SwitchRow({ label, onChange, value }: { label: string; onChange: (value: boolean) => void; value: boolean }) {
  return (
    <label className="settingRow">
      <span>{label}</span>
      <button className={value ? "switchControl on" : "switchControl"} type="button" onClick={() => onChange(!value)} aria-pressed={value}>
        <span />
      </button>
    </label>
  );
}

function SwatchRow({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  const colors = ["#ffffff", "#f8e38c", "#9fe6ff", "#e4e7ee", "#6ff0c4"];
  return (
    <div className="settingRow">
      <span>{label}</span>
      <div className="swatchGroup">
        {colors.map((color) => (
          <button
            aria-label={`选择 ${color}`}
            className={color === value ? "colorSwatch selected" : "colorSwatch"}
            key={color}
            onClick={() => onChange(color)}
            style={{ background: color }}
            type="button"
          />
        ))}
      </div>
    </div>
  );
}

function SelectRow({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="settingRow">
      <span>{label}</span>
      <select className="selectValue" onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option} value={option}>
            {styleOptionLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ActionRow({
  actions,
  label
}: {
  actions: Array<{ label: string; onClick: () => void }>;
  label: string;
}) {
  return (
    <div className="settingRow actionSettingRow">
      <span>{label}</span>
      <div>
        {actions.map((action) => (
          <button key={action.label} onClick={action.onClick} type="button">
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToolbarIcon({ name }: { name: "settings" | "lock" | "pin" | "target" | "more" | "close" | "mic" | "power" }) {
  const common = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.9 };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {name === "settings" ? (
        <>
          <circle cx="12" cy="12" r="3.1" {...common} />
          <path d="M19 13.4v-2.8l-2.1-.5c-.2-.6-.4-1.1-.7-1.6l1.1-1.8-2-2-1.8 1.1c-.5-.3-1-.5-1.6-.7L11.4 3H8.6l-.5 2.1c-.6.2-1.1.4-1.6.7L4.7 4.7l-2 2 1.1 1.8c-.3.5-.5 1-.7 1.6l-2.1.5v2.8l2.1.5c.2.6.4 1.1.7 1.6l-1.1 1.8 2 2 1.8-1.1c.5.3 1 .5 1.6.7l.5 2.1h2.8l.5-2.1c.6-.2 1.1-.4 1.6-.7l1.8 1.1 2-2-1.1-1.8c.3-.5.5-1 .7-1.6Z" {...common} />
        </>
      ) : null}
      {name === "lock" ? (
        <>
          <rect x="5" y="10" width="14" height="10" rx="2.3" {...common} />
          <path d="M8.2 10V7.5a3.8 3.8 0 0 1 7.6 0V10" {...common} />
        </>
      ) : null}
      {name === "pin" ? <path d="M14.8 3.8 20.2 9l-3.1 1.1-3.8 3.8.4 4.2L12.4 19l-3.5-3.5-4.1-4.1 1.1-1.3 4.2.4 3.8-3.8Z M9 15l-4 4" {...common} /> : null}
      {name === "target" ? (
        <>
          <circle cx="12" cy="12" r="7.5" {...common} />
          <circle cx="12" cy="12" r="2.6" {...common} />
          <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3" {...common} />
        </>
      ) : null}
      {name === "more" ? (
        <>
          <circle cx="6" cy="12" r="1.4" fill="currentColor" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" />
          <circle cx="18" cy="12" r="1.4" fill="currentColor" />
        </>
      ) : null}
      {name === "close" ? <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" {...common} /> : null}
      {name === "mic" ? (
        <>
          <rect x="9" y="3.5" width="6" height="10" rx="3" {...common} />
          <path d="M5.8 11.5a6.2 6.2 0 0 0 12.4 0M12 17.8V21M8.8 21h6.4" {...common} />
        </>
      ) : null}
      {name === "power" ? (
        <>
          <path d="M12 3.5v8" {...common} />
          <path d="M7.4 6.8a7.2 7.2 0 1 0 9.2 0" {...common} />
        </>
      ) : null}
    </svg>
  );
}

function fontFamilyValue(value: string) {
  if (value === "System") {
    return undefined;
  }
  return value;
}

function styleOptionLabel(value: string) {
  const labels: Record<string, string> = {
    sentencePair: subtitleDisplayModeLabel("sentencePair"),
    zonedPair: subtitleDisplayModeLabel("zonedPair"),
    shadow: "阴影",
    outline: "描边",
    none: "无"
  };
  return labels[value] ?? value;
}

function sourceLabel(sourceId: DesktopAudioSourceId) {
  return DESKTOP_AUDIO_SOURCES.find((source: DesktopAudioSource) => source.id === sourceId)?.label ?? "未知来源";
}

function scrollTranscriptToBottom(element: HTMLDivElement | null) {
  if (!element) {
    return;
  }
  element.scrollTop = element.scrollHeight;
}

function audioActivityLabel(activity: ReturnType<typeof createInitialSessionUiState>["audioActivity"]) {
  const labels: Record<ReturnType<typeof createInitialSessionUiState>["audioActivity"], string> = {
    active: "有输入",
    clipping: "过载",
    device_missing: "设备缺失",
    permission_denied: "权限拒绝",
    silent: "静音"
  };
  return labels[activity];
}

function formatMetricMs(value: number | null) {
  if (value === null) {
    return "--";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} s`;
  }
  return `${value} ms`;
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "--";
  }
  return `${Math.round(value * 100)}%`;
}

function termStatusLabel(status: ReturnType<typeof createInitialSessionUiState>["terms"][number]["status"]) {
  const labels: Record<ReturnType<typeof createInitialSessionUiState>["terms"][number]["status"], string> = {
    active: "已生效",
    failed: "失败",
    syncing: "同步中"
  };
  return labels[status];
}

function transcriptLinesToEditableText(lines: CaptionLine[]) {
  return lines
    .map((line) => [`原文: ${line.sourceText}`, `译文: ${line.targetText}`].join("\n"))
    .join("\n\n");
}

function editableTextToTranscriptLines(text: string, fallbackLines: CaptionLine[]) {
  const blocks = text.split(/\n{2,}/);
  return fallbackLines.map((line, index) => {
    const block = blocks[index]?.trim();
    if (!block) {
      return line;
    }

    const sourceText = extractEditableTranscriptField(block, "原文") ?? line.sourceText;
    const targetText = extractEditableTranscriptField(block, "译文") ?? line.targetText;
    return { ...line, sourceText, targetText };
  });
}

function extractEditableTranscriptField(block: string, label: "原文" | "译文") {
  const line = block
    .split("\n")
    .find((item) => item.trimStart().startsWith(`${label}:`) || item.trimStart().startsWith(`${label}：`));
  if (!line) {
    return undefined;
  }
  return line.replace(new RegExp(`^\\s*${label}[:：]\\s*`), "").trim();
}

function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function formatClock(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

createRoot(document.getElementById("root")!).render(<App />);
