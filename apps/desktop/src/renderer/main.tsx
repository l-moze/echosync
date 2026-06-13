import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import log from "electron-log/renderer";

import "./styles.css";

import { DESKTOP_AUDIO_SOURCES, type DesktopAudioSourceId } from "../shared/audio-source-catalog";
import type { AgentCapabilities } from "../shared/agent-capabilities";
import { selectedAsrProviderId } from "../shared/asr-provider-catalog";
import { selectedTranslationProviderId } from "../shared/translation-provider-catalog";
import { selectedTtsProviderId } from "../shared/tts-provider-catalog";
import {
  applyRealtimeEvent,
  isRealtimeEventForActiveSession,
  selectActiveCaptionLine,
  type CaptionLine
} from "../shared/caption-store";
import type { DesktopCaptureSnapshot } from "../shared/desktop-api";
import { validateRealtimePreflight } from "../shared/realtime-preflight";
import {
  createInitialSessionUiState,
  reduceSessionUiState,
  selectAverageCaptionLatencyMs,
  type SessionSummary,
  type SessionUiEvent,
  type SessionUiState
} from "../shared/session-ui-state";
import { shouldSurfaceRealtimeError } from "../shared/realtime-error-policy";
import {
  type SubtitleStyleState
} from "../shared/subtitle-style-state";
import {
  formatDateTimeForRecord,
  type SessionRecordListItem
} from "../shared/session-records";
import {
  buildSessionArchiveDraft,
  sessionArchiveTitleFromDate,
  type SessionArchiveDraft
} from "../shared/session-archive";
import { logRealtimeEventTelemetry } from "../shared/realtime-telemetry";
import { createInitialCaptionLines } from "./initial-captions";
import { createRealtimeAudioClient, type RealtimeAudioClient } from "./realtime-audio-client";
import { ensureSeekableSessionRecording, type SessionRecording } from "./session-recorder";
import { createTtsAudioPlaybackQueue, type TtsAudioPlaybackQueue } from "./tts-audio-playback";
import { resolveDesktopWindowRole } from "./window-role";
import { OverlayWindow } from "./components/caption/OverlayWindow";
import { RecordSummaryList } from "./components/records/RecordSummaryList";
import { SessionSummaryPanel } from "./components/session/SessionSummaryPanel";
import { AppTitleBar } from "./components/shell/AppTitleBar";
import { ControlCenter } from "./components/shell/ControlCenter";
import { LeaveSessionDialog } from "./components/shell/LeaveSessionDialog";
import { SessionStartupOverlay } from "./components/shell/SessionStartupOverlay";
import { SubtitleStyleWindow } from "./components/style-panel/SubtitleStyleWindow";
import { getAgentCapabilities } from "./services/ipc/agent";
import {
  getCaptureState,
  getPendingCaptureRecording,
  onCaptureState,
  startDesktopCapture,
  stopDesktopCapture
} from "./services/ipc/capture";
import { onRealtimeEvent, getCaptionSnapshot } from "./services/ipc/realtime";
import {
  listSessionRecords,
  onSessionRecordChanged,
  saveSessionRecordDraft
} from "./services/ipc/session-records";
import {
  setOverlayLocked as setOverlayLockedIpc
} from "./services/ipc/subtitle-style";
import {
  setOverlayVisible,
  wakeOverlayControls
} from "./services/ipc/overlay";
import { useSessionPreferencesState } from "./hooks/useSessionPreferencesState";
import { formatClock, formatMetricMs, formatTime, formatTtsErrorNotice, compactStatusMessage, roundMetric } from "./utils/format";
import { sessionRecordSummaryStatusLabel, sourceLabel } from "./utils/labels";
import { pageTitleForSession } from "./utils/session-page-title";
import { buildSessionRecordDraftInput } from "./utils/session-record-draft";
import {
  buildSessionRecordTimeline,
  reviewDurationMsForTimeline,
  reviewTimelineFromSessionTimeline
} from "./utils/session-review-timeline";
import { extractEditableTranscriptField } from "./utils/transcript";
import type { NavigationConfirmReason } from "./types/navigation";
import type { SessionArchiveSaveStatus } from "./types/session";
function releaseSessionArchive(archive: SessionArchiveDraft | null) {
  if (!archive?.audio?.objectUrl) {
    return;
  }
  URL.revokeObjectURL(archive.audio.objectUrl);
}

function createNativeWasapiRealtimeClient(): RealtimeAudioClient {
  const sessionId = createNativeRealtimeSessionId();
  return {
    sessionId,
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(null)
  };
}

async function getPendingNativeCaptureRecording(sessionId: string | null | undefined): Promise<SessionRecording | null> {
  if (!sessionId) {
    return null;
  }
  try {
    const recording = await getPendingCaptureRecording(sessionId);
    if (!recording?.data) {
      return null;
    }
    const mimeType = recording.mimeType || "audio/wav";
    return {
      activityRanges: recording.activityRanges,
      blob: new Blob([recording.data], { type: mimeType }),
      mimeType
    };
  } catch (error) {
    log.warn("[realtime] 读取 Windows 系统声录音失败:", error);
    return null;
  }
}

function createNativeRealtimeSessionId() {
  if (globalThis.crypto?.randomUUID) {
    return `sess_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  }
  return `sess_${Date.now().toString(36)}`;
}

function App() {
  const role = resolveDesktopWindowRole(window.location.hash);
  const [lines, setLines] = useState<CaptionLine[]>(createInitialCaptionLines);
  const {
    asrLatencyMode,
    asrProvider,
    endToEndSourceBackfill,
    languageDirection,
    selectAsrLatencyMode,
    selectAsrProvider,
    selectEndToEndSourceBackfill,
    selectLanguageDirection,
    selectSource,
    selectTranslationProvider,
    selectTtsProvider,
    sourceId,
    syncSourceFromCaptureState,
    translationProvider,
    ttsProvider
  } = useSessionPreferencesState();
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
  const [sessionRecords, setSessionRecords] = useState<SessionRecordListItem[]>([]);
  const [sessionArchive, setSessionArchive] = useState<SessionArchiveDraft | null>(null);
  const [sessionArchiveSaveStatus, setSessionArchiveSaveStatus] = useState<SessionArchiveSaveStatus>({
    message: "等待会话结束后保存",
    state: "idle"
  });
  const [navigationConfirmReason, setNavigationConfirmReason] = useState<NavigationConfirmReason>(null);
  const realtimeClientRef = useRef<RealtimeAudioClient | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const startupRunIdRef = useRef(0);
  const sessionUiRef = useRef(sessionUi);
  const sessionArchiveRef = useRef<SessionArchiveDraft | null>(null);
  const terminalRealtimeErrorRef = useRef<string | null>(null);
  const stoppingSessionIdsRef = useRef<Set<string>>(new Set());
  const ttsPlaybackRef = useRef<TtsAudioPlaybackQueue | null>(null);
  ttsPlaybackRef.current ??= createTtsAudioPlaybackQueue({ logger: log });
  const ttsPlayback = ttsPlaybackRef.current;

  const setSessionArchiveDraft = useCallback((nextArchive: SessionArchiveDraft | null) => {
    const currentArchive = sessionArchiveRef.current;
    if (currentArchive?.audio?.objectUrl !== nextArchive?.audio?.objectUrl) {
      releaseSessionArchive(currentArchive);
    }
    sessionArchiveRef.current = nextArchive;
    setSessionArchive(nextArchive);
  }, []);

  const refreshSessionRecords = useCallback(async () => {
    try {
      const records = await listSessionRecords();
      setSessionRecords(records ?? []);
    } catch (error) {
      log.warn("[session-records] 读取会议记录失败:", error);
    }
  }, []);

  const saveSessionArchiveDraft = useCallback(
    async (
      archive: SessionArchiveDraft,
      {
        averageCaptionLagMs,
        endedAt,
        startedAt
      }: {
        averageCaptionLagMs?: number;
        endedAt: string;
        startedAt: string;
      }
    ) => {
      try {
        setSessionArchiveSaveStatus({ message: "正在保存到会议记录...", state: "saving" });
        const input = await buildSessionRecordDraftInput(archive, { averageCaptionLagMs, endedAt, languageDirection, startedAt });
        await saveSessionRecordDraft(input);
        await refreshSessionRecords();
        setSessionArchiveSaveStatus({ message: "已保存到会议记录", state: "saved" });
      } catch (error) {
        log.warn("[session-records] 保存会议记录草稿失败:", error);
        setSessionArchiveSaveStatus({ message: "保存失败，可先复制导出文本", state: "failed" });
      }
    },
    [languageDirection, refreshSessionRecords]
  );

  useEffect(() => {
    const remove = onSessionRecordChanged(async () => {
      await refreshSessionRecords();
    });
    return () => remove();
  }, [refreshSessionRecords]);

  useEffect(() => {
    sessionUiRef.current = sessionUi;
  }, [sessionUi]);

  useEffect(() => {
    return () => {
      releaseSessionArchive(sessionArchiveRef.current);
      sessionArchiveRef.current = null;
    };
  }, []);

  useEffect(() => {
    const removeCaptionListener = onRealtimeEvent((event) => {
      if (!isRealtimeEventForActiveSession(activeSessionIdRef.current, event)) {
        logRealtimeEventTelemetry(log, event, Date.now());
        if (event.type === "realtime.done") {
          stoppingSessionIdsRef.current.delete(event.session_id);
          log.debug("caption_event_renderer_ignored", {
            activeSessionId: activeSessionIdRef.current,
            eventSessionId: event.session_id,
            reason: "inactive_done",
            type: event.type
          });
          return;
        }
        if (event.type === "realtime.error" && !shouldSurfaceRealtimeError(event, { stoppingSessionIds: stoppingSessionIdsRef.current })) {
          log.debug("caption_event_renderer_suppressed", {
            message: event.message,
            reason: "user_stop",
            sessionId: event.session_id
          });
          stoppingSessionIdsRef.current.delete(event.session_id);
          return;
        }
        log.debug("caption_event_renderer_ignored", {
          activeSessionId: activeSessionIdRef.current,
          eventSessionId: event.session_id,
          reason: "inactive_session",
          type: event.type
        });
        return;
      }
      logRealtimeEventTelemetry(log, event, Date.now());
      if (event.type === "realtime.done") {
        stoppingSessionIdsRef.current.delete(event.session_id);
        activeSessionIdRef.current = null;
        return;
      }
      if (event.type === "tts.audio") {
        if (role === "control") {
          void ttsPlayback.enqueue(event);
        }
        setRealtimeError(null);
        setHasRealEvents(true);
        return;
      }
      if (event.type === "tts.error") {
        if (role === "control") {
          ttsPlayback.skip(event);
        }
        const notice = formatTtsErrorNotice(event);
        log.warn("tts_error_received", {
          code: event.code,
          message: event.message,
          provider: event.provider,
          retryable: event.retryable,
          segmentId: event.segment_id,
          sessionId: event.session_id
        });
        setRealtimeError(notice);
        setHasRealEvents(true);
        return;
      }
      setLines((current) => {
        const applyStartedAt = performance.now();
        const nextLines = applyRealtimeEvent(current, event);
        const applyEventMs = performance.now() - applyStartedAt;
        log.debug("caption_event_renderer_processed", {
          applyEventMs: roundMetric(applyEventMs),
          eventType: event.type,
          linesCount: current.length,
          nextLinesCount: nextLines.length,
          pendingGrowth: nextLines.length - current.length,
          segmentId: "segment_id" in event ? event.segment_id : undefined,
          sessionId: event.session_id
        });
        return nextLines;
      });
      setHasRealEvents(true);
      if (event.type === "realtime.error") {
        if (!shouldSurfaceRealtimeError(event, { stoppingSessionIds: stoppingSessionIdsRef.current })) {
          log.debug("caption_event_renderer_suppressed", {
            reason: "user_stop",
            sessionId: event.session_id,
            message: event.message
          });
          stoppingSessionIdsRef.current.delete(event.session_id);
          return;
        }
        setRealtimeError(event.message);
        setSnapshot((current) => ({
          ...current,
          state: "error",
          message: event.message
        }));
        void stopRealtimeAfterError(event.message);
      }
    });
    const removeCaptureListener = onCaptureState((nextSnapshot) => {
      const terminalError = terminalRealtimeErrorRef.current;
      const previousSessionId = activeSessionIdRef.current;
      const newListeningSession =
        nextSnapshot.state === "listening" &&
        Boolean(nextSnapshot.sessionId) &&
        nextSnapshot.sessionId !== previousSessionId;
      setSnapshot(
        terminalError && nextSnapshot.state === "stopped"
          ? { ...nextSnapshot, state: "error", message: terminalError, sessionId: undefined }
          : nextSnapshot
      );
      syncSourceFromCaptureState(nextSnapshot.sourceId);
      if (newListeningSession) {
        setLines(createInitialCaptionLines());
        setRealtimeError(null);
        terminalRealtimeErrorRef.current = null;
      }
      activeSessionIdRef.current = nextSnapshot.sessionId ?? null;
      if (nextSnapshot.state === "listening") {
        if (nextSnapshot.sessionId) {
          stoppingSessionIdsRef.current.delete(nextSnapshot.sessionId);
        }
        terminalRealtimeErrorRef.current = null;
        dispatchSessionUi({ type: "session.started", atMs: Date.now() });
      }
      if (nextSnapshot.state === "error") {
        setRealtimeError(nextSnapshot.message);
      }
      if (nextSnapshot.state === "stopped" || nextSnapshot.state === "error") {
        const currentClient = realtimeClientRef.current;
        markSessionStopping(currentClient?.sessionId ?? previousSessionId);
        realtimeClientRef.current = null;
        activeSessionIdRef.current = null;
        void currentClient?.stop();
      }
    });
    void getCaptureState().then((currentSnapshot) => {
      if (!currentSnapshot) {
        return;
      }
      setSnapshot(currentSnapshot);
      syncSourceFromCaptureState(currentSnapshot.sourceId);
      activeSessionIdRef.current = currentSnapshot.sessionId ?? null;
      if (currentSnapshot.sessionId) {
        void replayCaptionSnapshot(currentSnapshot.sessionId);
      }
    });
    return () => {
      removeCaptionListener();
      removeCaptureListener();
    };
  }, []);

  async function replayCaptionSnapshot(sessionId: string) {
    try {
      const snapshotEvents = await getCaptionSnapshot(sessionId);
      if (!snapshotEvents?.length) {
        return;
      }
      const events = snapshotEvents.filter((event) => isRealtimeEventForActiveSession(activeSessionIdRef.current, event, sessionId));
      if (!events.length) {
        return;
      }
      setLines((current) => events.reduce((nextLines, event) => applyRealtimeEvent(nextLines, event), current));
      setHasRealEvents(true);
      log.info("caption_event_renderer_snapshot_replayed", {
        eventCount: events.length,
        sessionId
      });
    } catch (error) {
      log.warn("caption_event_renderer_snapshot_failed", error);
    }
  }

  useEffect(() => {
    void refreshAgentCapabilities();
  }, []);

  useEffect(() => {
    void refreshSessionRecords();
  }, [refreshSessionRecords]);

  const activeLine = useMemo(() => selectActiveCaptionLine(lines), [lines]);
  const currentSource = DESKTOP_AUDIO_SOURCES.find((source) => source.id === sourceId) ?? DESKTOP_AUDIO_SOURCES[1];

  function dispatchSessionUi(event: SessionUiEvent) {
    const next = reduceSessionUiState(sessionUiRef.current, event);
    sessionUiRef.current = next;
    setSessionUi(next);
  }

  function markSessionStopping(sessionId: string | null | undefined) {
    if (sessionId) {
      stoppingSessionIdsRef.current.add(sessionId);
      log.debug("realtime_session_marked_stopping", { sessionId });
    }
  }

  async function refreshAgentCapabilities() {
    try {
      const capabilities = await getAgentCapabilities();
      if (!capabilities) {
        throw new Error("未能获取同传服务能力信息。请确保后端 Agent 服务正在运行（端口 8766）。");
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
      markSessionStopping(realtimeClientRef.current.sessionId);
      await realtimeClientRef.current.stop();
      realtimeClientRef.current = null;
      activeSessionIdRef.current = null;
    }
    setRealtimeError(null);
    terminalRealtimeErrorRef.current = null;
    setSessionArchiveDraft(null);
    setSessionArchiveSaveStatus({ message: "等待会话结束后保存", state: "idle" });
    ttsPlayback.clear();
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
    const selectedAsrProvider = selectedAsrProviderId(asrProvider);
    const selectedTranslationProvider = selectedTranslationProviderId(translationProvider);
    const selectedTtsProvider = selectedTtsProviderId(ttsProvider);
    log.info("[realtime] 准备启动会话", {
      asrLatencyMode,
      asrProvider: selectedAsrProvider ?? "server-default",
      endToEndSourceBackfill,
      languageDirection: languageDirection.id,
      sessionSourceId: nextSourceId,
      translationProvider: selectedTranslationProvider ?? "server-default",
      ttsProvider: selectedTtsProvider ?? "server-default"
    });
    const client = nextSourceId === "windows-system"
      ? createNativeWasapiRealtimeClient()
      : createRealtimeAudioClient({
          asrLatencyMode,
          asrProvider: selectedAsrProvider,
          endToEndSourceBackfill,
          sourceId: nextSourceId,
          sourceLang: languageDirection.sourceLang,
          telemetryLogger: log,
          translationProvider: selectedTranslationProvider,
          ttsProvider: selectedTtsProvider
        });
    realtimeClientRef.current = client;
    activeSessionIdRef.current = client.sessionId;
    const nextSnapshot = await startDesktopCapture({
      asrLatencyMode,
      asrProvider: selectedAsrProvider,
      endToEndSourceBackfill,
      sessionId: client.sessionId,
      sourceId: nextSourceId,
      sourceLang: languageDirection.sourceLang,
      translationProvider: selectedTranslationProvider,
      ttsProvider: selectedTtsProvider
    });
    if (nextSnapshot) {
      try {
        dispatchSessionUi({ type: "startup.phase.changed", phase: "connecting_agent", atMs: Date.now() });
        await client.start();
        if (startupRunIdRef.current !== runId) {
          markSessionStopping(client.sessionId);
          await client.stop();
          return;
        }
        setSnapshot(nextSnapshot);
        dispatchSessionUi({ type: "startup.phase.changed", phase: "opening_overlay", atMs: Date.now() });
        await setOverlayVisible(true);
        if (startupRunIdRef.current !== runId) {
          return;
        }
        dispatchSessionUi({ type: "startup.completed" });
        dispatchSessionUi({ type: "session.started", atMs: Date.now() });
      } catch (error) {
        if (startupRunIdRef.current !== runId) {
          return;
        }
        realtimeClientRef.current = null;
        activeSessionIdRef.current = null;
        ttsPlayback.clear();
        await stopDesktopCapture();
        const message = error instanceof Error ? error.message : "实时音频采集启动失败。";
        setSnapshot({
          sourceId: nextSourceId,
          state: "error",
          message
        });
        dispatchSessionUi({ type: "startup.failed", message });
      }
    } else {
      const message = "桌面端没有返回音频采集状态。";
      markSessionStopping(client.sessionId);
      realtimeClientRef.current = null;
      activeSessionIdRef.current = null;
      ttsPlayback.clear();
      await client.stop();
      setSnapshot({
        sourceId: nextSourceId,
        state: "error",
        message
      });
      dispatchSessionUi({ type: "startup.failed", message });
    }
  }

  async function stopRealtimeAfterError(message: string) {
    startupRunIdRef.current += 1;
    terminalRealtimeErrorRef.current = message;
    const currentClient = realtimeClientRef.current;
    realtimeClientRef.current = null;
    activeSessionIdRef.current = null;
    ttsPlayback.clear();
    let nextSnapshot: DesktopCaptureSnapshot | undefined;

    try {
      await currentClient?.stop();
    } catch (error) {
      log.warn("[realtime] 停止失败会话音频流时出错:", error);
    }

    try {
      nextSnapshot = await stopDesktopCapture();
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
    const stoppedSessionId = currentClient?.sessionId ?? activeSessionIdRef.current;
    markSessionStopping(stoppedSessionId);
    realtimeClientRef.current = null;
    activeSessionIdRef.current = null;
    ttsPlayback.clear();
    let recording: Awaited<ReturnType<RealtimeAudioClient["stop"]>> | undefined;
    try {
      recording = await currentClient?.stop();
    } catch (error) {
      log.warn("[realtime] 停止会话音频流时出错:", error);
    }
    let nextSnapshot: DesktopCaptureSnapshot | undefined;
    try {
      nextSnapshot = await stopDesktopCapture();
    } catch (error) {
      log.warn("[realtime] 更新停止采集状态时出错:", error);
    }
    if (nextSnapshot) {
      setSnapshot(nextSnapshot);
    }
    const endedAt = new Date();
    const endedAtIso = endedAt.toISOString();
    const startedAtMs = sessionUiRef.current.sessionStartedAtMs;
    const elapsedDurationMs = startedAtMs === null ? 0 : Math.max(0, endedAt.getTime() - startedAtMs);
    const durationMs = Math.max(...lines.map((line) => line.endMs), elapsedDurationMs, 0);
    const averageCaptionLagMs = selectAverageCaptionLatencyMs(lines, startedAtMs) ?? undefined;
    const nativeRecording = recording ? null : await getPendingNativeCaptureRecording(stoppedSessionId);
    const seekableRecording = await ensureSeekableSessionRecording(recording ?? nativeRecording, durationMs);
    const timeline = buildSessionRecordTimeline({
      activityRanges: seekableRecording?.activityRanges,
      lines,
      rawDurationMs: durationMs,
      sourceId
    });
    const hasSessionContent = Boolean(seekableRecording) || lines.some((line) => line.sourceText.trim() || line.targetText.trim());
    if (hasSessionContent) {
      const archive = buildSessionArchiveDraft({
        audioBlob: seekableRecording?.blob,
        audioMimeType: seekableRecording?.mimeType,
        audioObjectUrl: seekableRecording ? URL.createObjectURL(seekableRecording.blob) : undefined,
        createdAt: endedAtIso,
        durationMs,
        id: stoppedSessionId ?? nextSnapshot?.sessionId ?? `sess_${endedAt.getTime()}`,
        lines,
        timeline,
        title: sessionArchiveTitleFromDate(endedAt)
      });
      setSessionArchiveDraft(archive);
      void saveSessionArchiveDraft(archive, {
        averageCaptionLagMs,
        endedAt: endedAtIso,
        startedAt: startedAtMs === null ? endedAtIso : new Date(startedAtMs).toISOString()
      });
    } else {
      setSessionArchiveSaveStatus({ message: "本次没有可保存内容", state: "idle" });
    }
    const summary: SessionSummary = {
      durationMs: timeline.reviewDurationMs,
      segmentCount: lines.length,
      patchCount: lines.reduce((sum, line) => sum + line.patchCount, 0),
      averageLatencyMs: averageCaptionLagMs ?? 0,
      wordCount: lines.reduce((sum, line) => sum + line.targetText.length, 0)
    };
    dispatchSessionUi({ type: "session.finished", summary });
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
    ttsPlayback.clear();
    if (realtimeClientRef.current || snapshot.state === "listening" || snapshot.state === "requesting" || sessionUi.startup.phase !== "idle") {
      const currentClient = realtimeClientRef.current;
      markSessionStopping(currentClient?.sessionId ?? activeSessionIdRef.current);
      realtimeClientRef.current = null;
      activeSessionIdRef.current = null;
      await currentClient?.stop();
      const nextSnapshot = await stopDesktopCapture();
      if (nextSnapshot) {
        setSnapshot(nextSnapshot);
      }
    }
    setNavigationConfirmReason(null);
    setRealtimeError(null);
    setSessionArchiveDraft(null);
    setSessionArchiveSaveStatus({ message: "等待会话结束后保存", state: "idle" });
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
    await setOverlayLockedIpc(next);
  }

  if (role === "overlay") {
    return (
      <OverlayWindow
        activeLine={activeLine}
        agentCapabilities={agentCapabilities}
        languageDirection={languageDirection}
        lines={lines}
        onLanguageDirectionSelect={selectLanguageDirection}
        onSourceStart={(nextSourceId) => void startCapture(nextSourceId)}
        onStop={() => void stopCapture()}
        onTranslationProviderSelect={selectTranslationProvider}
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
        statusLabel={
          realtimeError ??
          (snapshot.state === "listening"
            ? "同传中"
            : hasRealEvents
              ? "同传服务已连接"
              : "待开始")
        }
        onBack={requestReturnHome}
      />

      <section className="homeShell">
        <ControlCenter
          activeLine={activeLine}
          currentSource={currentSource}
          languageDirection={languageDirection}
          lines={lines}
          onLanguageDirectionSelect={selectLanguageDirection}
          onSourceSelect={selectSource}
          onAsrLatencyModeSelect={selectAsrLatencyMode}
          onAsrProviderSelect={selectAsrProvider}
          onTranslationProviderSelect={selectTranslationProvider}
          onTtsProviderSelect={selectTtsProvider}
          onSessionRecordsChanged={refreshSessionRecords}
          onShowOverlay={() => void wakeOverlayControls()}
          onStart={() => void startCapture()}
          onStop={() => void stopCapture()}
          overlayLocked={overlayLocked}
          dispatchSessionUi={dispatchSessionUi}
          sessionArchive={sessionArchive}
          sessionArchiveSaveStatus={sessionArchiveSaveStatus}
          sessionRecords={sessionRecords}
          sessionUi={sessionUi}
          agentCapabilities={agentCapabilities}
          agentCapabilitiesError={agentCapabilitiesError}
          asrLatencyMode={asrLatencyMode}
          asrProvider={asrProvider}
          endToEndSourceBackfill={endToEndSourceBackfill}
          sourceId={sourceId}
          onEndToEndSourceBackfillSelect={selectEndToEndSourceBackfill}
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


createRoot(document.getElementById("root")!).render(<App />);
