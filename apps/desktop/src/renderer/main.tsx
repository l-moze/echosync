import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type UIEvent } from "react";
import { createRoot } from "react-dom/client";

import { DESKTOP_AUDIO_SOURCES, type DesktopAudioSource, type DesktopAudioSourceId } from "../shared/audio-source-catalog";
import {
  selectedTranslationProviderId,
  TRANSLATION_PROVIDER_OPTIONS,
  translationProviderLabel,
  type TranslationProviderSelection
} from "../shared/translation-provider-catalog";
import {
  createInitialCaptionDisplayBuffer,
  selectDisplayCaptionLines,
  type CaptionDisplayBuffer
} from "../shared/caption-display-buffer";
import {
  applyRealtimeEvent,
  isRealtimeEventForActiveSession,
  selectActiveCaptionLine,
  selectOverlayHistoryLines,
  type CaptionLine
} from "../shared/caption-store";
import type { DesktopCaptureSnapshot } from "../shared/desktop-api";
import {
  createInitialOverlayInteractionState,
  reduceOverlayInteraction,
  type OverlayInteractionEvent
} from "../shared/overlay-interaction";
import {
  createInitialSessionUiState,
  reduceSessionUiState,
  selectSessionHealthMetrics,
  type SessionSummary,
  type StartupUiState,
  type SessionUiEvent
} from "../shared/session-ui-state";
import {
  defaultSubtitleStyle,
  normalizeSubtitleDisplayMode,
  reduceSubtitleStyleState,
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
import { createInitialCaptionLines } from "./initial-captions";
import { createRealtimeAudioClient, type RealtimeAudioClient } from "./realtime-audio-client";
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
  const [translationProvider, setTranslationProvider] =
    useState<TranslationProviderSelection>("server-default");
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

  useEffect(() => {
    sessionUiRef.current = sessionUi;
  }, [sessionUi]);

  useEffect(() => {
    const removeCaptionListener = window.echosyncDesktop?.onRealtimeEvent((event) => {
      if (!isRealtimeEventForActiveSession(activeSessionIdRef.current, event)) {
        return;
      }
      if (event.type === "realtime.done") {
        activeSessionIdRef.current = null;
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

  const activeLine = useMemo(() => selectActiveCaptionLine(lines), [lines]);
  const currentSource = DESKTOP_AUDIO_SOURCES.find((source) => source.id === sourceId) ?? DESKTOP_AUDIO_SOURCES[1];

  function dispatchSessionUi(event: SessionUiEvent) {
    const next = reduceSessionUiState(sessionUiRef.current, event);
    sessionUiRef.current = next;
    setSessionUi(next);
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
    dispatchSessionUi({ type: "startup.started", phase: "preparing_audio", atMs: startedAtMs });
    if (realtimeClientRef.current) {
      await realtimeClientRef.current.stop();
      realtimeClientRef.current = null;
      activeSessionIdRef.current = null;
    }
    setRealtimeError(null);
    terminalRealtimeErrorRef.current = null;
    setSessionArchive(null);
    setLines(createInitialCaptionLines());
    const client = createRealtimeAudioClient({
      sourceId: nextSourceId,
      translationProvider: selectedTranslationProviderId(translationProvider)
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
    let nextSnapshot: DesktopCaptureSnapshot | undefined;

    try {
      await currentClient?.stop();
    } catch (error) {
      console.warn("[realtime] 停止失败会话音频流时出错:", error);
    }

    try {
      nextSnapshot = await window.echosyncDesktop?.stopCapture();
    } catch (error) {
      console.warn("[realtime] 更新失败会话采集状态时出错:", error);
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
        translationProvider={translationProvider}
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
        statusLabel={snapshot.state === "listening" ? "同传中" : hasRealEvents ? "Agent 已连接" : "免费 1 小时"}
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
          onTranslationProviderSelect={setTranslationProvider}
          onReturnHome={requestReturnHome}
          onStart={() => void startCapture()}
          onStop={() => void stopCapture()}
          overlayLocked={overlayLocked}
          dispatchSessionUi={dispatchSessionUi}
          sessionArchive={sessionArchive}
          sessionUi={sessionUi}
          sourceId={sourceId}
          toggleOverlayLocked={() => void toggleOverlayLocked()}
          translationProvider={translationProvider}
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
    detail: "系统正在准备音频或连接 Agent，取消后会关闭本次启动流程。",
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
    return "会话驾驶舱";
  }
  if (sessionUi.lifecycle === "finished") {
    return "会话复盘";
  }
  return "EchoSync";
}

function ControlCenter({
  activeLine,
  currentSource,
  lines,
  onShowOverlay,
  onSourceSelect,
  onTranslationProviderSelect,
  onReturnHome,
  onStart,
  onStop,
  overlayLocked,
  dispatchSessionUi,
  sessionArchive,
  sessionUi,
  sourceId,
  toggleOverlayLocked,
  translationProvider
}: {
  activeLine?: CaptionLine;
  currentSource: DesktopAudioSource;
  lines: CaptionLine[];
  onShowOverlay: () => void;
  onSourceSelect: (sourceId: DesktopAudioSourceId) => void;
  onTranslationProviderSelect: (provider: TranslationProviderSelection) => void;
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
}) {
  return (
    <section className={`controlCenter lifecycle-${sessionUi.lifecycle}`}>
      {sessionUi.lifecycle === "idle" ? (
        <IdleDashboard
          currentSource={currentSource}
          onShowOverlay={onShowOverlay}
          onSourceSelect={onSourceSelect}
          onTranslationProviderSelect={onTranslationProviderSelect}
          onStart={onStart}
          sessionUi={sessionUi}
          sourceId={sourceId}
          translationProvider={translationProvider}
        />
      ) : null}
      {sessionUi.lifecycle === "active" ? (
        <ActiveDashboard
          activeLine={activeLine}
          lines={lines}
          onStop={onStop}
          overlayLocked={overlayLocked}
          dispatchSessionUi={dispatchSessionUi}
          sessionUi={sessionUi}
          sourceId={sourceId}
          toggleOverlayLocked={toggleOverlayLocked}
          translationProvider={translationProvider}
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
  currentSource,
  onShowOverlay,
  onSourceSelect,
  onTranslationProviderSelect,
  onStart,
  sessionUi,
  sourceId,
  translationProvider
}: {
  currentSource: DesktopAudioSource;
  onShowOverlay: () => void;
  onSourceSelect: (sourceId: DesktopAudioSourceId) => void;
  onTranslationProviderSelect: (provider: TranslationProviderSelection) => void;
  onStart: () => void;
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
  sourceId: DesktopAudioSourceId;
  translationProvider: TranslationProviderSelection;
}) {
  return (
    <div className="dashboardGrid">
      <section className="heroStart">
        <p className="eyebrow">默认开箱</p>
        <h1>给当前视频挂上实时双语字幕</h1>
        <p>默认使用 {currentSource.label}，先确认电平条有响应，再开始同传。</p>
        <div className="sourceTabs horizontal">
          {DESKTOP_AUDIO_SOURCES.map((source) => (
            <button className={source.id === sourceId ? "selected" : ""} key={source.id} onClick={() => onSourceSelect(source.id)}>
              {source.label}
            </button>
          ))}
        </div>
        <div className="providerTabs" aria-label="翻译模型选择">
          {TRANSLATION_PROVIDER_OPTIONS.map((provider) => (
            <button
              className={provider.id === translationProvider ? "selected" : ""}
              key={provider.id}
              onClick={() => onTranslationProviderSelect(provider.id)}
            >
              <strong>{provider.label}</strong>
              <span>{provider.description}</span>
            </button>
          ))}
        </div>
        <div className="presetGrid">
          {["视频/网课", "远程会议", "技术分享", "文件回放"].map((label, index) => (
            <button className={index === 0 ? "presetCard selected" : "presetCard"} key={label}>
              <strong>{label}</strong>
              <span>{index === 0 ? "低风险开箱体验" : "专业场景预设"}</span>
            </button>
          ))}
        </div>
        <div className="startActions">
          <button className="primary" onClick={onStart}>开始同传</button>
          <button onClick={onShowOverlay}>打开字幕弹窗预览</button>
        </div>
        <PreflightAudioVisualizer sessionUi={sessionUi} />
      </section>
      <aside className="dashboardPanel">
        <h2>准备就绪检查</h2>
        <HealthMetric label="输入源" value={currentSource.label} />
        <HealthMetric label="音频活动" value={sessionUi.audioActivity} />
        <HealthMetric label="字幕窗" value="可打开" />
        <HealthMetric label="翻译模型" value={translationProviderLabel(translationProvider)} />
      </aside>
    </div>
  );
}

function ActiveDashboard({
  activeLine,
  lines,
  onStop,
  overlayLocked,
  dispatchSessionUi,
  sessionUi,
  sourceId,
  toggleOverlayLocked,
  translationProvider
}: {
  activeLine?: CaptionLine;
  lines: CaptionLine[];
  onStop: () => void;
  overlayLocked: boolean;
  dispatchSessionUi: (event: SessionUiEvent) => void;
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
  sourceId: DesktopAudioSourceId;
  toggleOverlayLocked: () => void;
  translationProvider: TranslationProviderSelection;
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
        <h2>会话驾驶舱</h2>
        <HealthMetric label="翻译模型" value={translationProviderLabel(translationProvider)} />
        <HealthPanel lines={lines} sessionUi={sessionUi} sourceId={sourceId} />
        <TermQuickAdd dispatchSessionUi={dispatchSessionUi} sessionUi={sessionUi} />
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
        <SessionSummaryPanel lines={lines} sessionUi={sessionUi} />
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
          <button className="primary" onClick={cleanUpTranscript}>快速清理</button>
          <button onClick={() => void copyMarkdown()}>复制 Markdown</button>
          <button onClick={() => void copySrt()}>复制 SRT</button>
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
          <span>{formatTime(line.startMs)}-{formatTime(line.endMs)} · {line.state.toUpperCase()}</span>
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
      <HealthMetric label="Patch" value={`${metrics.patchCount} 次`} />
      <HealthMetric label="稳定度" value={formatPercent(metrics.averageStability)} />
      <HealthMetric label="置信来源" value={metrics.confidenceLabel} />
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
      <h3>术语快加</h3>
      <form className="termForm" onSubmit={submitTerm}>
        <input aria-label="原文术语" onChange={(event) => setSource(event.target.value)} placeholder="agent" value={source} />
        <input aria-label="译文术语" onChange={(event) => setTarget(event.target.value)} placeholder="智能体" value={target} />
        <button type="submit">注入</button>
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
          <p className="statusBox">新术语会先显示注入中，完成后从后续片段开始生效。</p>
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

function RecentSessionsPanel() {
  return (
    <aside className="dashboardPanel">
      <h2>最近记录</h2>
      <article className="statusBox">技术分享 · 12 分钟 · 已生成双语转写</article>
      <article className="statusBox">网课回放 · 8 分钟 · 可导出 SRT</article>
    </aside>
  );
}

function OverlayWindow({
  activeLine,
  lines,
  onSourceStart,
  onStop,
  realtimeError,
  snapshot,
  translationProvider
}: {
  activeLine?: CaptionLine;
  lines: CaptionLine[];
  onSourceStart: (sourceId: DesktopAudioSourceId) => void;
  onStop: () => void;
  realtimeError: string | null;
  snapshot: DesktopCaptureSnapshot;
  translationProvider: TranslationProviderSelection;
}) {
  const isListening = snapshot.state === "listening";
  const [interaction, setInteraction] = useState(createInitialOverlayInteractionState);
  const { subtitleStyle, updateSubtitleStyle } = useSharedSubtitleStyle();
  const isPinned = interaction.layer === "pinned";
  const showChrome = interaction.layer === "controls" || interaction.layer === "settings" || isPinned;
  const [displayBuffer, setDisplayBuffer] = useState<CaptionDisplayBuffer>(createInitialCaptionDisplayBuffer);
  const [displayNowMs, setDisplayNowMs] = useState(() => Date.now());
  const displaySelection = useMemo(
    () => selectDisplayCaptionLines(displayBuffer, lines, displayNowMs),
    [displayBuffer, displayNowMs, lines]
  );
  const displayLines = displaySelection.lines;
  const displayActiveLine = useMemo(() => selectActiveCaptionLine(displayLines), [displayLines]);
  const historyLines = useMemo(
    () => selectOverlayHistoryLines(interaction.layer, displayLines),
    [displayLines, interaction.layer]
  );
  const [overlayInteractionLocked, setOverlayInteractionLocked] = useState(false);
  const subtitleVars = {
    "--subtitle-bg-opacity": subtitleStyle.backgroundOpacity,
    "--subtitle-blur": `${subtitleStyle.backgroundBlur}px`,
    "--source-size": `${subtitleStyle.sourceScale}px`,
    "--target-size": `${subtitleStyle.targetScale}px`,
    "--source-color": subtitleStyle.sourceColor,
    "--target-color": subtitleStyle.targetColor
  } as CSSProperties;

  function dispatchOverlay(event: OverlayInteractionEvent) {
    setInteraction((current) => reduceOverlayInteraction(current, event));
  }

  useEffect(() => {
    const nextSelection = selectDisplayCaptionLines(displayBuffer, lines, Date.now());
    setDisplayBuffer(nextSelection.buffer);
  }, [lines]);

  useEffect(() => {
    if (displaySelection.pendingLineIds.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      const nowMs = Date.now();
      const nextSelection = selectDisplayCaptionLines(displayBuffer, lines, nowMs);
      setDisplayBuffer(nextSelection.buffer);
      setDisplayNowMs(nowMs);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [displayBuffer, displaySelection.pendingLineIds.length, lines]);

  useEffect(() => {
    const remove = window.echosyncDesktop?.onOverlayWake(() => {
      dispatchOverlay({ type: "fallback.wake" });
    });
    return () => remove?.();
  }, []);

  useEffect(() => {
    void window.echosyncDesktop?.setOverlayLayer(interaction.layer);
  }, [interaction.layer]);

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
        {showChrome ? (
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
        ) : null}
        <section
          className={`floatingCaption mode-${subtitleStyle.displayMode} outline-${subtitleStyle.outlineStyle} ${
            subtitleStyle.translationFirst ? "translationFirst" : ""
          }`}
          style={subtitleVars}
        >
          <CaptionText line={displayActiveLine ?? activeLine} subtitleStyle={subtitleStyle} />
          {realtimeError ? <p className="overlayError">{realtimeError}</p> : null}
          {historyLines.length > 0 ? <OverlayCaptionHistory lines={historyLines} subtitleStyle={subtitleStyle} /> : null}
          <div className={isListening ? "focusMeter active" : "focusMeter"} aria-label={isListening ? "正在同传" : "实时字幕待命"}>
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="overlayMeta">
            <span className={`liveDot state-${snapshot.state}`} />
            <span>{isListening ? "正在同传" : "实时字幕"}</span>
            <span>{displayActiveLine ? `${formatTime(displayActiveLine.startMs)}-${formatTime(displayActiveLine.endMs)}` : "等待时间帧"}</span>
            <span>{sourceLabel(snapshot.sourceId)}</span>
          </div>
        </section>
        {showChrome ? (
          <OverlaySessionBar
            isListening={isListening}
            lines={displayLines}
            onCaptureToggle={() => void toggleOverlayCapture()}
            onDisplayModeChange={(displayMode) => updateSubtitleStyle({ displayMode })}
            onMicrophoneSelect={() => void selectMicrophoneCapture()}
            snapshot={snapshot}
            subtitleStyle={subtitleStyle}
            translationProvider={translationProvider}
          />
        ) : null}
      </section>
    </main>
  );
}

function CaptionText({ line, subtitleStyle }: { line?: CaptionLine; subtitleStyle: SubtitleStyleState }) {
  const displayMode = normalizeSubtitleDisplayMode(subtitleStyle.displayMode);
  const sourceText = line?.sourceText ?? "Waiting for audio stream...";
  const targetText = line?.targetText.trim() || (line ? "正在翻译..." : "等待 Windows 系统声音或麦克风输入");
  const source = (
    <p className={`overlaySource ${line?.state ?? "interim"}`} style={{ fontFamily: fontFamilyValue(subtitleStyle.sourceFont), fontWeight: subtitleStyle.sourceBold ? 760 : 540 }}>
      {sourceText}
    </p>
  );
  const target = (
    <h1 className={line?.state ?? "interim"} style={{ fontFamily: fontFamilyValue(subtitleStyle.targetFont), fontWeight: subtitleStyle.targetBold ? 800 : 620 }}>
      {targetText}
    </h1>
  );

  const bilingual = subtitleStyle.translationFirst ? (
    <>
      {target}
      {source}
    </>
  ) : (
    <>
      {source}
      {target}
    </>
  );

  return (
    <div className="captionText">
      {displayMode === "source" ? source : null}
      {displayMode === "translation" ? target : null}
      {displayMode === "bilingual" ? bilingual : null}
    </div>
  );
}

function OverlayCaptionHistory({ lines, subtitleStyle }: { lines: CaptionLine[]; subtitleStyle: SubtitleStyleState }) {
  return (
    <div className="overlayCaptionHistory">
      {lines.map((line, index, visibleLines) => (
        <article className={`historyLine ${line.state} ${index === visibleLines.length - 1 ? "current" : ""}`} key={line.id}>
          <span className="overlayStateBadge">{captionStateLabel(line.state)}</span>
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
  isListening,
  lines,
  onCaptureToggle,
  onDisplayModeChange,
  onMicrophoneSelect,
  snapshot,
  subtitleStyle,
  translationProvider
}: {
  isListening: boolean;
  lines: CaptionLine[];
  onCaptureToggle: () => void;
  onDisplayModeChange: (mode: SubtitleDisplayMode) => void;
  onMicrophoneSelect: () => void;
  snapshot: DesktopCaptureSnapshot;
  subtitleStyle: SubtitleStyleState;
  translationProvider: TranslationProviderSelection;
}) {
  const durationMs = Math.max(0, ...lines.map((line) => line.endMs)) + (isListening ? 10400 : 0);
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
      <span className="sessionPill">{translationProviderLabel(translationProvider)}</span>
      <span className="sessionPill">{sourceLabel(snapshot.sourceId)}</span>
      <details className="displayModePicker">
        <summary>{styleOptionLabel(displayMode)}</summary>
        <div className="displayModeMenu">
          <button className={displayMode === "bilingual" ? "selected" : ""} onClick={() => onDisplayModeChange("bilingual")}>
            双语字幕
          </button>
          <button className={displayMode === "source" ? "selected" : ""} onClick={() => onDisplayModeChange("source")}>
            主字幕
          </button>
          <button className={displayMode === "translation" ? "selected" : ""} onClick={() => onDisplayModeChange("translation")}>
            翻译字幕
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
        <StyleSection title="主字幕">
          <StepperRow label="字号" max={28} min={12} onChange={(sourceScale) => onChange({ sourceScale })} value={subtitleStyle.sourceScale} />
          <SwatchRow label="颜色" onChange={(sourceColor) => onChange({ sourceColor })} value={subtitleStyle.sourceColor} />
          <SelectRow label="字体" onChange={(sourceFont) => onChange({ sourceFont })} options={fontOptions} value={subtitleStyle.sourceFont} />
          <SwitchRow label="加粗" onChange={(sourceBold) => onChange({ sourceBold })} value={subtitleStyle.sourceBold} />
        </StyleSection>
        <StyleSection title="翻译字幕">
          <StepperRow label="字号" max={40} min={20} onChange={(targetScale) => onChange({ targetScale })} value={subtitleStyle.targetScale} />
          <SwatchRow label="颜色" onChange={(targetColor) => onChange({ targetColor })} value={subtitleStyle.targetColor} />
          <SelectRow label="字体" onChange={(targetFont) => onChange({ targetFont })} options={fontOptions} value={subtitleStyle.targetFont} />
          <SwitchRow label="加粗" onChange={(targetBold) => onChange({ targetBold })} value={subtitleStyle.targetBold} />
        </StyleSection>
        <StyleSection title="其他设置">
          <StepperRow label="背景透明度" max={0.95} min={0.35} onChange={(backgroundOpacity) => onChange({ backgroundOpacity })} step={0.05} value={subtitleStyle.backgroundOpacity} />
          <StepperRow label="背景模糊" max={36} min={0} onChange={(backgroundBlur) => onChange({ backgroundBlur })} step={2} value={subtitleStyle.backgroundBlur} />
          <SelectRow
            label="描边样式"
            onChange={(outlineStyle) => onChange({ outlineStyle: outlineStyle as SubtitleOutlineStyle })}
            options={["shadow", "outline", "none"]}
            value={subtitleStyle.outlineStyle}
          />
          <SwitchRow label="翻译字幕优先" onChange={(translationFirst) => onChange({ translationFirst })} value={subtitleStyle.translationFirst} />
          <SelectRow
            label="显示模式"
            onChange={(displayMode) => onChange({ displayMode: displayMode as SubtitleDisplayMode })}
            options={["bilingual", "source", "translation"]}
            value={subtitleStyle.displayMode}
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
    bilingual: "双语字幕",
    source: "主字幕",
    translation: "翻译字幕",
    shadow: "阴影",
    outline: "描边",
    none: "无"
  };
  return labels[value] ?? value;
}

function sourceLabel(sourceId: DesktopAudioSourceId) {
  return DESKTOP_AUDIO_SOURCES.find((source: DesktopAudioSource) => source.id === sourceId)?.label ?? "未知来源";
}

function captionStateLabel(state: CaptionLine["state"]) {
  const labels: Record<CaptionLine["state"], string> = {
    interim: "确认中",
    stable: "已稳定",
    revised: "已修订",
    locked: "已锁定"
  };
  return labels[state];
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
    syncing: "注入中"
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
