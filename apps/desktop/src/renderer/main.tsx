import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type UIEvent } from "react";
import { createRoot } from "react-dom/client";
import log from "electron-log/renderer";

import { DESKTOP_AUDIO_SOURCES, type DesktopAudioSource, type DesktopAudioSourceId } from "../shared/audio-source-catalog";
import {
  findAgentAsrProvider,
  findAgentTranslationProvider,
  findAgentTtsProvider,
  type AgentCapabilities
} from "../shared/agent-capabilities";
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
  type TranslationProviderId,
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
import {
  createInitialCaptionTextBlockBuffer,
  selectBufferedCaptionTextBlocks,
  selectCaptionTextBlocks,
  type CaptionTextBlockBuffer
} from "../shared/caption-text-view";
import {
  applyRealtimeEvent,
  isRealtimeEventForActiveSession,
  selectActiveCaptionLine,
  selectOverlayDisplayWindow,
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
  selectAverageCaptionLatencyMs,
  selectSessionHealthMetrics,
  type SessionSummary,
  type StartupUiState,
  type SessionUiEvent,
  type SessionUiState
} from "../shared/session-ui-state";
import type { SessionPreferencesState } from "../shared/session-preferences";
import { shouldSurfaceRealtimeError } from "../shared/realtime-error-policy";
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
  filterSessionRecordsByTitle,
  formatDateTimeForRecord,
  formatDurationForRecord,
  normalizeSessionRecordSegmentsTiming,
  selectSessionRecordPlaybackSegmentId,
  serializeSessionRecordMarkdown,
  type SessionRecord,
  type SessionRecordDraftInput,
  type SessionRecordExportFormat,
  type SessionRecordListItem,
  type SessionRecordSegment,
  type SessionRecordTimeline
} from "../shared/session-records";
import {
  buildReviewTimeline,
  reviewToRawMs,
  selectAutoSkipTargetRawMs,
  selectReviewPlaybackMs,
  selectSkippedSilenceMarker,
  type ReviewTimeline,
  type ReviewTimelineMode,
  type TimelineRange,
  type TimelineSpan
} from "../shared/review-timeline";
import {
  buildSessionArchiveDraft,
  selectPlaybackSegmentId,
  sessionArchiveTitleFromDate,
  type SessionArchiveDraft
} from "../shared/session-archive";
import { logRealtimeEventTelemetry } from "../shared/realtime-telemetry";
import {
  HOME_LAUNCHER_COPY,
  PREFERENCE_ADVANCED_ENTRY,
  PREFERENCE_SETTINGS_NAV,
  RECORD_LIST_COLUMNS,
  buildHomeReadinessSummary,
  productizeHomeDiagnostic
} from "../shared/home-launcher-copy";
import { createInitialCaptionLines } from "./initial-captions";
import { createRealtimeAudioClient, type RealtimeAudioClient } from "./realtime-audio-client";
import { ensureSeekableSessionRecording, type SessionRecording } from "./session-recorder";
import { createTtsAudioPlaybackQueue, type TtsAudioPlaybackQueue } from "./tts-audio-playback";
import { resolveDesktopWindowRole } from "./window-role";
import { AudioLoadingBars } from "./components/common/AudioLoadingBars";
import { PreferenceRow } from "./components/common/PreferenceRow";
import { HealthMetric } from "./components/common/HealthMetric";
import { LauncherRow } from "./components/home/LauncherRow";
import { PreferenceMiniCard } from "./components/home/PreferenceMiniCard";
import { RecordSummaryList } from "./components/records/RecordSummaryList";
import { StyleSection } from "./components/settings/StyleSection";
import { PreflightAudioVisualizer } from "./components/session/PreflightAudioVisualizer";
import { SessionSummaryPanel } from "./components/session/SessionSummaryPanel";
import { formatClock, formatMetricMs, formatPercent, formatPreciseTime, formatTime, formatTtsErrorNotice, compactStatusMessage, roundMetric } from "./utils/format";
import { engineOptionLabel, overlayDisplayModeAccessibleLabel, sessionRecordExportFormatLabel, sessionRecordSummaryStatusLabel, sourceLabel, styleOptionLabel, termStatusLabel } from "./utils/labels";
import { normalizeSessionRecordForReview, selectedRecordSegmentSourceText, selectedRecordSegmentTargetText } from "./utils/session-records";
import { fontFamilyValue } from "./utils/style";
import { editableTextToTranscriptLines, extractEditableTranscriptField, transcriptLinesToEditableText } from "./utils/transcript";
import { captionContentModes } from "./constants/caption";
import { languageDirectionOptions } from "./constants/language";
import { REVIEW_TIMELINE_COMPACT_GAP_MS, REVIEW_TIMELINE_THRESHOLD_MS, TRANSCRIPT_REVIEW_STACKED_WIDTH_PX } from "./constants/layout";
import { LANGUAGE_DIRECTION_STORAGE_KEY } from "./constants/storage-keys";
import { fontOptions } from "./constants/ui";
import type { CaptionContentMode } from "./types/caption";
import type { LanguageDirectionId, LanguageDirectionOption } from "./types/language";
import type { NavigationConfirmReason } from "./types/navigation";
import type { OverlayChromeMenu } from "./types/overlay";
import type { SessionArchiveSaveStatus } from "./types/session";

import "./styles.css";

function languageDirectionForId(id: string | null | undefined): LanguageDirectionOption {
  return languageDirectionOptions.find((option) => option.id === id) ?? languageDirectionOptions[0];
}

function readStoredLanguageDirectionId(): LanguageDirectionId {
  try {
    return languageDirectionForId(window.localStorage.getItem(LANGUAGE_DIRECTION_STORAGE_KEY)).id;
  } catch {
    return languageDirectionOptions[0].id;
  }
}

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
    const recording = await window.echosyncDesktop?.getPendingCaptureRecording(sessionId);
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

function buildSessionRecordTimeline({
  activityRanges,
  lines,
  rawDurationMs,
  sourceId
}: {
  activityRanges?: Array<{ startMs: number; endMs: number }>;
  lines: CaptionLine[];
  rawDurationMs: number;
  sourceId: DesktopAudioSourceId;
}): SessionRecordTimeline {
  const mode = reviewTimelineModeForSource(sourceId);
  const compressionEnabled = mode !== "meeting";
  const timeline = buildReviewTimeline({
    activeRanges: selectReviewTimelineActiveRanges(activityRanges, lines),
    compactGapMs: REVIEW_TIMELINE_COMPACT_GAP_MS,
    compressLongSilence: compressionEnabled,
    mode,
    rawDurationMs,
    thresholdMs: REVIEW_TIMELINE_THRESHOLD_MS
  });

  return {
    compressionEnabled,
    contentDurationMs: timeline.contentDurationMs,
    mode,
    rawDurationMs: timeline.rawDurationMs,
    reviewDurationMs: timeline.reviewDurationMs,
    spans: timeline.spans.map((span) => ({
      kind: span.type === "long_silence" ? "silence" : "content",
      rawEndMs: span.rawEndMs,
      rawStartMs: span.rawStartMs,
      reviewEndMs: span.reviewEndMs,
      reviewStartMs: span.reviewStartMs
    }))
  };
}

function selectReviewTimelineActiveRanges(
  activityRanges: Array<{ startMs: number; endMs: number }> | undefined,
  lines: CaptionLine[]
): TimelineRange[] {
  const recordingRanges = activityRanges
    ?.map((range) => ({
      rawEndMs: range.endMs,
      rawStartMs: range.startMs
    }))
    .filter((range) => range.rawEndMs > range.rawStartMs);
  if (recordingRanges && recordingRanges.length > 0) {
    return recordingRanges;
  }
  return lines
    .map((line) => ({
      rawEndMs: line.endMs,
      rawStartMs: line.startMs
    }))
    .filter((range) => range.rawEndMs > range.rawStartMs);
}

function reviewTimelineModeForSource(sourceId: DesktopAudioSourceId): ReviewTimelineMode {
  if (sourceId === "microphone" || sourceId === "mixed") {
    return "meeting";
  }
  if (sourceId === "file") {
    return "course";
  }
  return "video";
}

function reviewTimelineFromSessionTimeline(timeline: SessionRecordTimeline | undefined): ReviewTimeline | null {
  if (!timeline) {
    return null;
  }
  return {
    contentDurationMs: timeline.contentDurationMs,
    rawDurationMs: timeline.rawDurationMs,
    reviewDurationMs: timeline.reviewDurationMs,
    spans: timeline.spans.map((span): TimelineSpan => {
      if (span.kind === "silence") {
        return {
          compactMs: Math.max(0, span.reviewEndMs - span.reviewStartMs),
          rawEndMs: span.rawEndMs,
          rawStartMs: span.rawStartMs,
          reviewEndMs: span.reviewEndMs,
          reviewStartMs: span.reviewStartMs,
          type: "long_silence"
        };
      }
      return {
        rawEndMs: span.rawEndMs,
        rawStartMs: span.rawStartMs,
        reviewEndMs: span.reviewEndMs,
        reviewStartMs: span.reviewStartMs,
        type: "active_audio"
      };
    })
  };
}

function reviewDurationMsForTimeline(timeline: ReviewTimeline | null, fallbackMs: number) {
  return timeline?.reviewDurationMs ?? fallbackMs;
}

async function buildSessionRecordDraftInput(
  archive: SessionArchiveDraft,
  {
    averageCaptionLagMs,
    endedAt,
    languageDirection,
    startedAt
  }: {
    averageCaptionLagMs?: number;
    endedAt: string;
    languageDirection: LanguageDirectionOption;
    startedAt: string;
  }
): Promise<SessionRecordDraftInput> {
  return {
    id: archive.id,
    title: archive.title,
    createdAt: archive.createdAt,
    startedAt,
    endedAt,
    durationMs: archive.durationMs,
    sourceLang: languageDirection.sourceLang,
    targetLang: languageDirection.targetLang,
    averageCaptionLagMs,
    audio: archive.audio?.blob
      ? {
          data: await archive.audio.blob.arrayBuffer(),
          mimeType: archive.audio.mimeType
        }
      : undefined,
    timeline: archive.timeline,
    summary: {
      status: "pending",
      text: "",
      keywords: []
    },
    diagnostics: {
      hasTranslationGap: archive.segments.some(
        (segment) => Boolean(segment.sourceText.trim()) && !segment.targetText.trim()
      )
    },
    segments: archive.segments.map((segment): SessionRecordSegment => ({
      id: segment.segmentId,
      startMs: segment.startMs,
      endMs: segment.endMs,
      sourceText: segment.sourceText,
      targetText: segment.targetText,
      revisionState: sessionRecordRevisionState(segment.state),
      patchCount: segment.patchCount
    }))
  };
}

function sessionRecordRevisionState(
  state: SessionArchiveDraft["segments"][number]["state"]
): SessionRecordSegment["revisionState"] {
  if (state === "locked") {
    return "final";
  }
  if (state === "revised") {
    return "edited";
  }
  return "draft";
}

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
  const [endToEndSourceBackfill, setEndToEndSourceBackfill] = useState(true);
  const [ttsProvider, setTtsProvider] = useState<TtsProviderSelection>("server-default");
  const [languageDirectionId, setLanguageDirectionId] = useState<LanguageDirectionId>(readStoredLanguageDirectionId);
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
  const languageDirection = languageDirectionForId(languageDirectionId);

  function updateSessionPreferences(patch: Partial<SessionPreferencesState>) {
    void window.echosyncDesktop?.updateSessionPreferences(patch).catch((error) => {
      log.warn("[session-preferences] 同步会话偏好失败:", error);
    });
  }

  function selectSource(nextSourceId: DesktopAudioSourceId) {
    setSourceId(nextSourceId);
    updateSessionPreferences({ sourceId: nextSourceId });
  }

  function selectAsrLatencyMode(nextMode: AsrLatencyMode) {
    setAsrLatencyMode(nextMode);
    updateSessionPreferences({ asrLatencyMode: nextMode });
  }

  function selectAsrProvider(nextProvider: AsrProviderSelection) {
    setAsrProvider(nextProvider);
    updateSessionPreferences({ asrProvider: nextProvider });
  }

  function selectTranslationProvider(nextProvider: TranslationProviderSelection) {
    setTranslationProvider(nextProvider);
    updateSessionPreferences({ translationProvider: nextProvider });
  }

  function selectEndToEndSourceBackfill(enabled: boolean) {
    setEndToEndSourceBackfill(enabled);
    updateSessionPreferences({ endToEndSourceBackfill: enabled });
  }

  function selectTtsProvider(nextProvider: TtsProviderSelection) {
    setTtsProvider(nextProvider);
    updateSessionPreferences({ ttsProvider: nextProvider });
  }

  function selectLanguageDirection(nextId: LanguageDirectionId) {
    setLanguageDirectionId(nextId);
    updateSessionPreferences({ languageDirectionId: nextId });
    try {
      window.localStorage.setItem(LANGUAGE_DIRECTION_STORAGE_KEY, nextId);
    } catch {
      // Non-persistent renderer contexts can still use the in-memory selection.
    }
  }

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
      const records = await window.echosyncDesktop?.sessionRecords.list();
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
        await window.echosyncDesktop?.sessionRecords.saveDraft(input);
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
    const remove = window.echosyncDesktop?.onSessionRecordChanged(async () => {
      await refreshSessionRecords();
    });
    return () => remove?.();
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
    const applyPreferences = (preferences: SessionPreferencesState) => {
      setAsrLatencyMode(preferences.asrLatencyMode);
      setAsrProvider(preferences.asrProvider);
      setEndToEndSourceBackfill(preferences.endToEndSourceBackfill);
      setSourceId(preferences.sourceId);
      setTranslationProvider(preferences.translationProvider);
      setTtsProvider(preferences.ttsProvider);
      const nextLanguageDirectionId = languageDirectionForId(preferences.languageDirectionId).id;
      setLanguageDirectionId(nextLanguageDirectionId);
      try {
        window.localStorage.setItem(LANGUAGE_DIRECTION_STORAGE_KEY, nextLanguageDirectionId);
      } catch {
        // 非持久化 renderer 上下文仍可使用主进程同步过来的内存状态。
      }
    };
    const remove = window.echosyncDesktop?.onSessionPreferences(applyPreferences);
    void window.echosyncDesktop?.getSessionPreferences().then((preferences) => {
      if (preferences) {
        applyPreferences(preferences);
      }
    });
    return () => remove?.();
  }, []);

  useEffect(() => {
    const removeCaptionListener = window.echosyncDesktop?.onRealtimeEvent((event) => {
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
    const removeCaptureListener = window.echosyncDesktop?.onCaptureState((nextSnapshot) => {
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
      setSourceId(nextSnapshot.sourceId);
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
    void window.echosyncDesktop?.getCaptureState().then((currentSnapshot) => {
      setSnapshot(currentSnapshot);
      setSourceId(currentSnapshot.sourceId);
      activeSessionIdRef.current = currentSnapshot.sessionId ?? null;
      if (currentSnapshot.sessionId) {
        void replayCaptionSnapshot(currentSnapshot.sessionId);
      }
    });
    return () => {
      removeCaptionListener?.();
      removeCaptureListener?.();
    };
  }, []);

  async function replayCaptionSnapshot(sessionId: string) {
    try {
      const snapshotEvents = await window.echosyncDesktop?.getCaptionSnapshot(sessionId);
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
    const nextSnapshot = await window.echosyncDesktop?.startCapture({
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
        await window.echosyncDesktop?.setOverlayVisible(true);
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
      nextSnapshot = await window.echosyncDesktop?.stopCapture();
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
      const nextSnapshot = await window.echosyncDesktop?.stopCapture();
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
    await window.echosyncDesktop?.setOverlayLocked(next);
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
          onReturnHome={requestReturnHome}
          onSessionRecordsChanged={refreshSessionRecords}
          onShowOverlay={() => void window.echosyncDesktop?.wakeOverlayControls()}
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

function AppTitleBar({
  canNavigateBack,
  onBack,
  pageTitle,
  statusLabel
}: {
  canNavigateBack: boolean;
  onBack: () => void;
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
          <span aria-hidden="true" className="appBrandMark" />
          <strong>{pageTitle}</strong>
        </div>
      </div>
      <div className="centerPill">{statusLabel}</div>
      <div className="windowActions">
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

function pageTitleForSession(sessionUi: SessionUiState) {
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
  endToEndSourceBackfill,
  languageDirection,
  lines,
  onAsrLatencyModeSelect,
  onAsrProviderSelect,
  onEndToEndSourceBackfillSelect,
  onLanguageDirectionSelect,
  onSourceSelect,
  onTranslationProviderSelect,
  onTtsProviderSelect,
  onReturnHome,
  onSessionRecordsChanged,
  onShowOverlay,
  onStart,
  onStop,
  overlayLocked,
  dispatchSessionUi,
  sessionArchive,
  sessionArchiveSaveStatus,
  sessionRecords,
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
  endToEndSourceBackfill: boolean;
  languageDirection: LanguageDirectionOption;
  lines: CaptionLine[];
  onAsrLatencyModeSelect: (mode: AsrLatencyMode) => void;
  onAsrProviderSelect: (provider: AsrProviderSelection) => void;
  onEndToEndSourceBackfillSelect: (enabled: boolean) => void;
  onLanguageDirectionSelect: (directionId: LanguageDirectionId) => void;
  onSourceSelect: (sourceId: DesktopAudioSourceId) => void;
  onTranslationProviderSelect: (provider: TranslationProviderSelection) => void;
  onTtsProviderSelect: (provider: TtsProviderSelection) => void;
  onReturnHome: () => void;
  onSessionRecordsChanged: () => Promise<void>;
  onShowOverlay: () => void;
  onStart: () => void;
  onStop: () => void;
  overlayLocked: boolean;
  dispatchSessionUi: (event: SessionUiEvent) => void;
  sessionArchive: SessionArchiveDraft | null;
  sessionArchiveSaveStatus: SessionArchiveSaveStatus;
  sessionRecords: SessionRecordListItem[];
  sessionUi: SessionUiState;
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
          endToEndSourceBackfill={endToEndSourceBackfill}
          languageDirection={languageDirection}
          onAsrLatencyModeSelect={onAsrLatencyModeSelect}
          onAsrProviderSelect={onAsrProviderSelect}
          onEndToEndSourceBackfillSelect={onEndToEndSourceBackfillSelect}
          onLanguageDirectionSelect={onLanguageDirectionSelect}
          onSourceSelect={onSourceSelect}
          onTranslationProviderSelect={onTranslationProviderSelect}
          onTtsProviderSelect={onTtsProviderSelect}
          onSessionRecordsChanged={onSessionRecordsChanged}
          onStart={onStart}
          sessionRecords={sessionRecords}
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
          onShowOverlay={onShowOverlay}
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
          sessionArchiveSaveStatus={sessionArchiveSaveStatus}
          sessionRecords={sessionRecords}
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
  endToEndSourceBackfill,
  languageDirection,
  onAsrLatencyModeSelect,
  onAsrProviderSelect,
  onEndToEndSourceBackfillSelect,
  onLanguageDirectionSelect,
  onSourceSelect,
  onTranslationProviderSelect,
  onTtsProviderSelect,
  onSessionRecordsChanged,
  onStart,
  sessionRecords,
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
  endToEndSourceBackfill: boolean;
  languageDirection: LanguageDirectionOption;
  onAsrLatencyModeSelect: (mode: AsrLatencyMode) => void;
  onAsrProviderSelect: (provider: AsrProviderSelection) => void;
  onEndToEndSourceBackfillSelect: (enabled: boolean) => void;
  onLanguageDirectionSelect: (directionId: LanguageDirectionId) => void;
  onSourceSelect: (sourceId: DesktopAudioSourceId) => void;
  onTranslationProviderSelect: (provider: TranslationProviderSelection) => void;
  onTtsProviderSelect: (provider: TtsProviderSelection) => void;
  onSessionRecordsChanged: () => Promise<void>;
  onStart: () => void;
  sessionRecords: SessionRecordListItem[];
  sessionUi: SessionUiState;
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
          <LauncherRow label="目标语言" value={languageDirection.label}>
            <div className="choiceGroup languageDirectionGroup" role="group" aria-label="目标语言">
              {languageDirectionOptions.map((option) => (
                <button
                  className={option.id === languageDirection.id ? "selected" : ""}
                  key={option.id}
                  onClick={() => onLanguageDirectionSelect(option.id)}
                  title={option.label}
                >
                  {option.shortLabel}
                </button>
              ))}
            </div>
          </LauncherRow>
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
        </div>

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
        endToEndSourceBackfill={endToEndSourceBackfill}
        isOpen={preferencesOpen}
        languageDirection={languageDirection}
        onAsrLatencyModeSelect={onAsrLatencyModeSelect}
        onAsrProviderSelect={onAsrProviderSelect}
        onClose={() => setPreferencesOpen(false)}
        onEndToEndSourceBackfillSelect={onEndToEndSourceBackfillSelect}
        onTranslationProviderSelect={onTranslationProviderSelect}
        onTtsProviderSelect={onTtsProviderSelect}
        translationProvider={translationProvider}
        ttsProvider={ttsProvider}
      />
      <SessionRecordsWindow
        isOpen={recordsOpen}
        onClose={() => setRecordsOpen(false)}
        onRecordsChanged={onSessionRecordsChanged}
        records={sessionRecords}
      />
    </div>
  );
}


function PreferenceSettingsPanel({
  agentCapabilities,
  asrLatencyMode,
  asrProvider,
  currentSource,
  endToEndSourceBackfill,
  isOpen,
  languageDirection,
  onAsrLatencyModeSelect,
  onAsrProviderSelect,
  onClose,
  onEndToEndSourceBackfillSelect,
  onTranslationProviderSelect,
  onTtsProviderSelect,
  translationProvider,
  ttsProvider
}: {
  agentCapabilities: AgentCapabilities | null;
  asrLatencyMode: AsrLatencyMode;
  asrProvider: AsrProviderSelection;
  currentSource: DesktopAudioSource;
  endToEndSourceBackfill: boolean;
  isOpen: boolean;
  languageDirection: LanguageDirectionOption;
  onAsrLatencyModeSelect: (mode: AsrLatencyMode) => void;
  onAsrProviderSelect: (provider: AsrProviderSelection) => void;
  onClose: () => void;
  onEndToEndSourceBackfillSelect: (enabled: boolean) => void;
  onTranslationProviderSelect: (provider: TranslationProviderSelection) => void;
  onTtsProviderSelect: (provider: TtsProviderSelection) => void;
  translationProvider: TranslationProviderSelection;
  ttsProvider: TtsProviderSelection;
}) {
  const [activeSection, setActiveSection] = useState<(typeof PREFERENCE_SETTINGS_NAV)[number]["id"]>("general");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [terminologyFileName, setTerminologyFileName] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const asrOptions = ASR_PROVIDER_OPTIONS.filter((provider) => provider.id !== "mock");
  const translationOptions = TRANSLATION_PROVIDER_OPTIONS.filter((provider) => provider.id !== "mock");
  const ttsOptions = TTS_PROVIDER_OPTIONS;
  const asrStatus = asrProviderLabel(asrProvider, agentCapabilities?.defaults.asr_provider).replace("后端默认", "自动");
  const translationStatus = translationProviderLabel(
    translationProvider,
    agentCapabilities?.defaults.translation_provider
  ).replace("通用模型", "自动");
  const ttsStatus = ttsProviderLabel(ttsProvider, agentCapabilities?.defaults.tts_provider);
  const providerChoiceState = {
    asr: (providerId: typeof asrOptions[number]["providerId"], fallbackDescription: string) => {
      if (!providerId || !agentCapabilities) {
        return { description: fallbackDescription, disabled: false };
      }
      const provider = findAgentAsrProvider(agentCapabilities, providerId);
      return {
        description:
          provider?.real_audio_supported === false
            ? "当前调试识别方案不能处理真实音频。"
            : provider?.reason || fallbackDescription,
        disabled: provider ? !provider.available || !provider.real_audio_supported : true
      };
    },
    translation: (
      providerId: typeof translationOptions[number]["providerId"],
      fallbackDescription: string
    ) => {
      if (!providerId || !agentCapabilities) {
        return { description: fallbackDescription, disabled: false };
      }
      const provider = findAgentTranslationProvider(agentCapabilities, providerId);
      return {
        description: provider?.reason || fallbackDescription,
        disabled: provider ? !provider.available : true
      };
    },
    tts: (providerId: typeof ttsOptions[number]["providerId"], fallbackDescription: string) => {
      if (!providerId || !agentCapabilities) {
        return { description: fallbackDescription, disabled: false };
      }
      const provider = findAgentTtsProvider(agentCapabilities, providerId);
      return {
        description: provider?.reason || fallbackDescription,
        disabled: provider ? !provider.available : true
      };
    }
  };

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
          <PreferenceRow label="默认语言方向" value={languageDirection.label} />
          <PreferenceRow label="默认同传节奏" value={asrLatencyModeLabel(asrLatencyMode)} />
          <div className="choiceGroup qualityGroup">
            {ASR_LATENCY_OPTIONS.map((mode) => (
              <button
                className={mode.id === asrLatencyMode ? "selected" : ""}
                key={mode.id}
                onClick={() => onAsrLatencyModeSelect(mode.id)}
                title={mode.description}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <PreferenceRow label="启动时打开字幕窗" value="开启" />
        </section>
      ) : null}
      {activeSection === "models" ? (
        <section className="engineSettingsGroup">
          <div className="settingsSectionLead">
            <h3>模型方案</h3>
            <p>把识别、翻译和播报拆成可扫描的方案，后续可以扩展多套翻译模型。</p>
          </div>
          <div className="modelPlanGrid" aria-label="模型方案">
            <PreferenceMiniCard
              label="当前方案"
              title={translationStatus}
              values={[`识别 ${asrStatus}`, `播报 ${ttsStatus}`]}
            />
            <PreferenceMiniCard
              label="预留方案"
              title="GPT-4o 翻译"
              values={["会议长上下文", "等待接口接入"]}
            />
          </div>
          <EngineChoiceRow
            label="语音识别"
            options={asrOptions.map((option) => {
              const providerId = option.providerId ?? agentCapabilities?.defaults.asr_provider;
              const choiceState = providerChoiceState.asr(providerId, option.description);
              return {
                id: option.id,
                description: choiceState.description,
                disabled: choiceState.disabled,
                label: engineOptionLabel(option.label, option.id),
                selected: option.id === asrProvider,
                onSelect: () => onAsrProviderSelect(option.id)
              };
            })}
            status={asrStatus}
          />
          <EngineChoiceRow
            label="翻译模型"
            options={translationOptions.map((option) => {
              const providerId = option.providerId ?? agentCapabilities?.defaults.translation_provider;
              const choiceState = providerChoiceState.translation(providerId, option.description);
              return {
                id: option.id,
                description: choiceState.description,
                disabled: choiceState.disabled,
                label: engineOptionLabel(option.label, option.id),
                selected: option.id === translationProvider,
                onSelect: () => onTranslationProviderSelect(option.id)
              };
            })}
            status={translationStatus}
          />
          <EngineChoiceRow
            label="端到端补原文"
            options={[
              {
                id: "on",
                description: "Qwen 端到端同传输出译文，同时用当前识别模型补原文，支持双语显示。",
                disabled: !isEndToEndTranslationSelected(translationProvider, agentCapabilities?.defaults.translation_provider),
                label: "开",
                selected: endToEndSourceBackfill,
                onSelect: () => onEndToEndSourceBackfillSelect(true)
              },
              {
                id: "off",
                description: "只运行端到端同传译文链路，降低成本；原文/双语可能为空。",
                disabled: !isEndToEndTranslationSelected(translationProvider, agentCapabilities?.defaults.translation_provider),
                label: "关",
                selected: !endToEndSourceBackfill,
                onSelect: () => onEndToEndSourceBackfillSelect(false)
              }
            ]}
            status={endToEndSourceBackfill ? "开启" : "关闭"}
          />
          <EngineChoiceRow
            label="语音播报"
            options={ttsOptions.map((option) => {
              const providerId = option.providerId ?? agentCapabilities?.defaults.tts_provider;
              const choiceState = providerChoiceState.tts(providerId, option.description);
              return {
                id: option.id,
                description: choiceState.description,
                disabled: choiceState.disabled,
                label: engineOptionLabel(option.label, option.id),
                selected: option.id === ttsProvider,
                onSelect: () => onTtsProviderSelect(option.id)
              };
            })}
            status={ttsStatus}
          />
        </section>
      ) : null}
      {activeSection === "terminology" ? (
        <section className="engineSettingsGroup">
          <section className="terminologyImportPanel">
            <div>
              <h4>术语库</h4>
              <p>导入会议、产品、品牌或行业词汇，翻译模型优先采用这些固定表达。</p>
            </div>
            <label className="terminologyImportButton">
              导入术语
              <input
                accept=".csv,.txt,.json"
                aria-label="导入术语文件"
                onChange={(event) => setTerminologyFileName(event.currentTarget.files?.[0]?.name ?? null)}
                type="file"
              />
            </label>
          </section>
          <div className="terminologyStatusLine">
            <span>{terminologyFileName ? `已选择 ${terminologyFileName}` : "支持 CSV、TXT、JSON，推荐一行一个术语或术语对。"}</span>
          </div>
          <div className="terminologyFormats" aria-label="术语导入格式">
            <span>产品名 → 固定译名</span>
            <span>缩写 → 完整解释</span>
            <span>禁译词 → 原样保留</span>
          </div>
        </section>
      ) : null}
      {activeSection === "captions" ? (
        <section className="engineSettingsGroup">
          <div className="settingsSectionLead">
            <h3>字幕窗口</h3>
            <p>字幕窗口只管理显示体验，不承载模型、日志或接口配置。</p>
          </div>
          <PreferenceRow label="默认显示模式" value="逐句对照" />
          <PreferenceRow label="分区对照" value="上下独立滚动" />
          <PreferenceRow label="字幕选中" value="禁止选中文本" />
          <PreferenceRow label="悬浮栏收起" value="延迟淡出" />
          <PreferenceRow label="字号与透明度" value="在字幕窗设置" />
        </section>
      ) : null}
      {activeSection === "privacy" ? (
        <section className="engineSettingsGroup">
          <h3>记录与隐私</h3>
          <PreferenceRow label="保存原始音频" value="本次会话后询问" />
          <PreferenceRow label="保存双语记录" value="开启" />
          <PreferenceRow label="自动清理" value="关闭" />
          <PreferenceRow label="诊断信息" value="按需导出" />
        </section>
      ) : null}
      <details
        className="developerSettings advancedSettings"
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        open={advancedOpen}
      >
        <summary>{PREFERENCE_ADVANCED_ENTRY.label}</summary>
        {advancedOpen ? (
          <section className="advancedDebugBlock" aria-label="开发者调试">
            <div className="settingsSectionLead">
              <h3>开发者调试</h3>
              <p>只保留链路调试项；模型、术语、字幕窗口和记录隐私在上方分组维护。</p>
            </div>
            <PreferenceRow label="WebSocket 地址" value="由桌面端管理" />
            <PreferenceRow label="事件调试" value="开发者模式" />
            <div className="choiceGroup">
              <button
                className={asrProvider === "mock" ? "selected" : ""}
                onClick={() => onAsrProviderSelect("mock")}
              >
                调试识别
              </button>
              <button
                className={translationProvider === "mock" ? "selected" : ""}
                onClick={() => onTranslationProviderSelect("mock")}
              >
                调试翻译
              </button>
            </div>
          </section>
        ) : null}
      </details>
    </aside>
  );
}



function EngineChoiceRow({
  label,
  options,
  status
}: {
  label: string;
  options: Array<{ id: string; description: string; disabled: boolean; label: string; selected: boolean; onSelect: () => void }>;
  status: string;
}) {
  return (
    <div className="engineChoiceRow">
      <span>{label}</span>
      <strong>{status}</strong>
      <div className="choiceGroup">
        {options.map((option) => (
          <button
            className={option.selected ? "selected" : ""}
            disabled={option.disabled}
            key={option.id}
            onClick={option.onSelect}
            title={option.description}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function isEndToEndTranslationSelected(
  selection: TranslationProviderSelection,
  defaultProvider?: TranslationProviderId
): boolean {
  return (selection === "server-default" ? defaultProvider : selection) === "qwen-livetranslate";
}


function ActiveDashboard({
  activeLine,
  agentCapabilities,
  asrLatencyMode,
  asrProvider,
  lines,
  onShowOverlay,
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
  onShowOverlay: () => void;
  onStop: () => void;
  overlayLocked: boolean;
  dispatchSessionUi: (event: SessionUiEvent) => void;
  sessionUi: SessionUiState;
  sourceId: DesktopAudioSourceId;
  toggleOverlayLocked: () => void;
}) {
  return (
    <div className="dashboardGrid">
      <section className="dashboardPanel">
        <div className="activeToolbar">
          <span className="centerPill">同传中</span>
          <button onClick={onShowOverlay} title="恢复字幕悬浮窗">
            恢复悬浮窗
          </button>
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
  sessionArchiveSaveStatus,
  sessionRecords,
  sessionUi
}: {
  dispatchSessionUi: (event: SessionUiEvent) => void;
  lines: CaptionLine[];
  onStart: () => void;
  sessionArchive: SessionArchiveDraft | null;
  sessionArchiveSaveStatus: SessionArchiveSaveStatus;
  sessionRecords: SessionRecordListItem[];
  sessionUi: SessionUiState;
}) {
  const [editableTranscript, setEditableTranscript] = useState(() => transcriptLinesToEditableText(lines));
  const [exportStatus, setExportStatus] = useState("等待导出");
  const [playbackMs, setPlaybackMs] = useState(0);
  const [archiveAudioPlaying, setArchiveAudioPlaying] = useState(false);
  const [archiveAudioError, setArchiveAudioError] = useState("");
  const [archiveAudioStatus, setArchiveAudioStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const archiveReviewTimeline = useMemo(
    () => reviewTimelineFromSessionTimeline(sessionArchive?.timeline),
    [sessionArchive?.timeline]
  );
  const archiveReviewDurationMs = reviewDurationMsForTimeline(archiveReviewTimeline, sessionArchive?.durationMs ?? 0);
  const archiveReviewPlaybackMs = archiveReviewTimeline ? selectReviewPlaybackMs(archiveReviewTimeline, playbackMs) : playbackMs;
  const archiveSkippedSilenceMarker = archiveReviewTimeline
    ? selectSkippedSilenceMarker(archiveReviewTimeline, archiveReviewPlaybackMs)
    : null;
  const cleanedLines = useMemo(() => editableTextToTranscriptLines(editableTranscript, lines), [editableTranscript, lines]);
  const activePlaybackSegmentId = useMemo(
    () => selectPlaybackSegmentId(cleanedLines, playbackMs),
    [cleanedLines, playbackMs]
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingArchiveSeekMsRef = useRef<number | null>(null);
  const pendingArchivePlayRef = useRef(false);

  function cleanUpTranscript() {
    const nextLines = cleanTranscriptLines(cleanedLines);
    setEditableTranscript(transcriptLinesToEditableText(nextLines));
    dispatchSessionUi({ type: "pre_export.edited" });
    setExportStatus("已完成快速清理");
  }

  function seekToSegment(line: CaptionLine) {
    pendingArchiveSeekMsRef.current = line.startMs;
    pendingArchivePlayRef.current = true;
    setPlaybackMs(line.startMs);
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.readyState === 0) {
      audio.load();
      return;
    }
    applyPendingArchiveSeek(audio);
  }

  function scrubArchiveAudio(nextReviewMs: number) {
    pendingArchivePlayRef.current = false;
    seekArchiveAudio(archiveReviewTimeline ? reviewToRawMs(archiveReviewTimeline, nextReviewMs) : nextReviewMs);
  }

  function seekArchiveAudio(nextRawMs: number) {
    const durationMs = sessionArchive?.durationMs ?? 0;
    const boundedMs = Math.min(Math.max(nextRawMs, 0), Math.max(durationMs, 0));
    pendingArchiveSeekMsRef.current = boundedMs;
    setPlaybackMs(boundedMs);
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.readyState === 0) {
      setArchiveAudioStatus("loading");
      audio.load();
      return;
    }
    applyPendingArchiveSeek(audio);
  }

  function applyPendingArchiveSeek(audio: HTMLAudioElement) {
    const pendingSeekMs = pendingArchiveSeekMsRef.current;
    if (pendingSeekMs === null) {
      return;
    }
    if (!seekAudioElement(audio, pendingSeekMs)) {
      return;
    }
    pendingArchiveSeekMsRef.current = null;
    setArchiveAudioStatus("ready");
    setPlaybackMs(pendingSeekMs);
    if (!pendingArchivePlayRef.current) {
      return;
    }
    pendingArchivePlayRef.current = false;
    setArchiveAudioError("");
    void audio.play()
      .then(() => {
        setArchiveAudioPlaying(true);
      })
      .catch(() => {
        setArchiveAudioPlaying(false);
        setArchiveAudioError("音频无法播放");
      });
  }

  function toggleArchiveAudioPlayback() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (archiveAudioPlaying) {
      audio.pause();
      setArchiveAudioPlaying(false);
      return;
    }
    setArchiveAudioError("");
    pendingArchivePlayRef.current = true;
    pendingArchiveSeekMsRef.current = playbackMs;
    if (audio.readyState < 2) {
      setArchiveAudioStatus("loading");
      audio.load();
      return;
    }
    applyPendingArchiveSeek(audio);
  }

  function updateArchivePlayback(currentMs: number) {
    const skipTargetRawMs = archiveReviewTimeline ? selectAutoSkipTargetRawMs(archiveReviewTimeline, currentMs) : null;
    if (skipTargetRawMs !== null && archiveAudioPlaying) {
      pendingArchivePlayRef.current = false;
      pendingArchiveSeekMsRef.current = skipTargetRawMs;
      setPlaybackMs(skipTargetRawMs);
      const audio = audioRef.current;
      if (audio && seekAudioElement(audio, skipTargetRawMs)) {
        pendingArchiveSeekMsRef.current = null;
      }
      return;
    }
    const durationMs = sessionArchive?.durationMs ?? currentMs;
    setPlaybackMs(Math.min(currentMs, durationMs));
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
        {sessionArchive?.audio ? (
          <section className="archivePlaybackPanel" aria-label="会话录音回放">
            <audio
              hidden
              preload="auto"
              ref={audioRef}
              src={sessionArchive.audio.objectUrl}
              onCanPlay={(event) => {
                setArchiveAudioStatus("ready");
                applyPendingArchiveSeek(event.currentTarget);
              }}
              onEnded={() => {
                setArchiveAudioPlaying(false);
                updateArchivePlayback(sessionArchive.durationMs);
              }}
              onError={() => {
                setArchiveAudioPlaying(false);
                setArchiveAudioStatus("failed");
                setArchiveAudioError("音频加载失败");
              }}
              onLoadedMetadata={(event) => {
                setArchiveAudioStatus("ready");
                applyPendingArchiveSeek(event.currentTarget);
              }}
              onPause={() => setArchiveAudioPlaying(false)}
              onPlay={() => setArchiveAudioPlaying(true)}
              onTimeUpdate={(event) => updateArchivePlayback(Math.round(event.currentTarget.currentTime * 1000))}
            />
            <div className="archiveAudioControls">
              <button onClick={toggleArchiveAudioPlayback} type="button">
                {archiveAudioPlaying ? "暂停" : "播放"}
              </button>
              <input
                aria-label="本次复盘音频进度"
                max={archiveReviewDurationMs}
                min={0}
                onChange={(event) => scrubArchiveAudio(Number(event.target.value))}
                step={250}
                type="range"
                value={Math.min(archiveReviewPlaybackMs, archiveReviewDurationMs)}
              />
              <span className="archiveAudioTime">{formatTime(archiveReviewPlaybackMs)} / {formatTime(archiveReviewDurationMs)}</span>
            </div>
            {archiveAudioStatus === "loading" ? <span className="archiveAudioStatus" role="status">音频加载中...</span> : null}
            {archiveAudioError ? <span className="archiveAudioError" role="status">{archiveAudioError}</span> : null}
            {archiveSkippedSilenceMarker ? (
              <span className="archiveAudioStatus" role="status">
                已压缩 {formatDurationForRecord(archiveSkippedSilenceMarker.skippedMs)} 静音
              </span>
            ) : null}
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
        <p className="exportStatus">
          {exportStatus}{sessionUi.preExportEdit.dirty ? " · 已编辑" : ""} · {sessionArchiveSaveStatus.message}
        </p>
      </section>
      <RecentSessionsPanel records={sessionRecords} />
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
  const gridRef = useRef<HTMLElement | null>(null);
  const [layoutMode, setLayoutMode] = useState<"balanced" | "stacked">("balanced");
  const columnTemplate = useMemo(() => selectTranscriptReviewColumnTemplate(lines), [lines]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }
    const updateLayoutMode = () => {
      setLayoutMode(grid.clientWidth < TRANSCRIPT_REVIEW_STACKED_WIDTH_PX ? "stacked" : "balanced");
    };
    updateLayoutMode();
    if (!("ResizeObserver" in window)) {
      return;
    }
    const observer = new ResizeObserver(updateLayoutMode);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  function handleReviewSegmentKeyDown(line: CaptionLine, event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    onLineClick(line);
  }

  return (
    <section
      className={`transcriptReviewGrid ${layoutMode === "stacked" ? "stacked" : ""}`}
      style={{ "--review-column-template": columnTemplate } as CSSProperties}
      ref={gridRef}
      aria-label="双语会话记录"
    >
      <div className="reviewHeader" aria-hidden="true">
        <span>时间</span>
        <span>原文</span>
        <span>译文</span>
      </div>
      {lines.map((line) => (
        <article
          className={line.id === activeSegmentId ? "reviewPair active" : "reviewPair"}
          key={line.id}
          onClick={() => onLineClick(line)}
          onKeyDown={(event) => handleReviewSegmentKeyDown(line, event)}
          role="button"
          tabIndex={0}
        >
          <span className="reviewTimestamp">{formatPreciseTime(line.startMs)}-{formatPreciseTime(line.endMs)}</span>
          <span className="reviewSegment reviewSource">
            <span className="reviewText reviewSource">{line.sourceText || "原文为空"}</span>
          </span>
          <span className="reviewSegment reviewTarget">
            <span className="reviewText reviewTarget">{line.targetText || "译文待补全"}</span>
          </span>
        </article>
      ))}
    </section>
  );
}

function selectTranscriptReviewColumnTemplate(lines: CaptionLine[]) {
  const sourceWeight = selectReviewTextWeight(lines.map((line) => line.sourceText));
  const targetWeight = selectReviewTextWeight(lines.map((line) => line.targetText));
  const totalWeight = Math.max(sourceWeight + targetWeight, 1);
  const sourceRatio = Math.min(0.62, Math.max(0.38, sourceWeight / totalWeight));
  const targetRatio = 1 - sourceRatio;
  return `84px minmax(0, ${sourceRatio.toFixed(2)}fr) minmax(0, ${targetRatio.toFixed(2)}fr)`;
}

function selectReviewTextWeight(texts: string[]) {
  return texts.reduce((sum, text) => {
    const asciiCount = (text.match(/[\w'-]+/g) ?? []).length;
    const wideCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    return sum + asciiCount * 1.15 + wideCount * 0.62 + text.length * 0.05;
  }, 0);
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
  sessionUi: SessionUiState;
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
  sessionUi: SessionUiState;
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
  sessionUi: SessionUiState;
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


function TermQuickAdd({
  dispatchSessionUi,
  sessionUi
}: {
  dispatchSessionUi: (event: SessionUiEvent) => void;
  sessionUi: SessionUiState;
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


function RecentSessionsPanel({ records }: { records: SessionRecordListItem[] }) {
  const visibleRecords = records.slice(0, 2);
  return (
    <aside className="dashboardPanel recentRecordsPanel">
      <h2>会议记录</h2>
      <SessionRecordTable compact records={visibleRecords} />
      {visibleRecords.length === 0 ? <p className="archiveMissing">暂无已保存记录。</p> : null}
    </aside>
  );
}

function SessionRecordsWindow({
  isOpen,
  onClose,
  onRecordsChanged,
  records
}: {
  isOpen: boolean;
  onClose: () => void;
  onRecordsChanged: () => Promise<void>;
  records: SessionRecordListItem[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<SessionRecord | null>(null);
  const [selectedRecordLoading, setSelectedRecordLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [renameStatus, setRenameStatus] = useState("");
  const [reviewScale, setReviewScale] = useState(1);
  const [recordAudioUrl, setRecordAudioUrl] = useState<string | null>(null);
  const [recordAudioPlaying, setRecordAudioPlaying] = useState(false);
  const [recordAudioError, setRecordAudioError] = useState("");
  const [recordAudioStatus, setRecordAudioStatus] = useState<"idle" | "loading" | "ready" | "missing" | "failed">("idle");
  const [playbackMs, setPlaybackMs] = useState(0);
  const [activeRecordSegmentId, setActiveRecordSegmentId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const recordAudioRef = useRef<HTMLAudioElement | null>(null);
  const recordAudioObjectUrlRef = useRef<string | null>(null);
  const pendingRecordSeekMsRef = useRef<number | null>(null);
  const pendingRecordPlayRef = useRef(false);
  const recordSegmentRefs = useRef<Record<string, HTMLElement | null>>({});
  const filteredRecords = useMemo(() => filterSessionRecordsByTitle(records, searchQuery), [records, searchQuery]);
  const selectedListRecord = selectedId ? records.find((record) => record.id === selectedId) ?? null : null;
  const isDetailView = Boolean(selectedId);
  const selectedReviewTimeline = useMemo(
    () => reviewTimelineFromSessionTimeline(selectedRecord?.timeline),
    [selectedRecord?.timeline]
  );
  const reviewDurationMs = reviewDurationMsForTimeline(selectedReviewTimeline, selectedRecord?.durationMs ?? 0);
  const reviewPlaybackMs = selectedReviewTimeline ? selectReviewPlaybackMs(selectedReviewTimeline, playbackMs) : playbackMs;
  const skippedSilenceMarker = selectedReviewTimeline
    ? selectSkippedSilenceMarker(selectedReviewTimeline, reviewPlaybackMs)
    : null;

  useEffect(() => {
    if (!isOpen || !selectedId) {
      setSelectedRecord(null);
      setRecordAudioPlaybackUrl(null);
      setRecordAudioPlaying(false);
      setRecordAudioError("");
      setRecordAudioStatus("idle");
      setPlaybackMs(0);
      setActiveRecordSegmentId(null);
      setTitleDraft("");
      pendingRecordSeekMsRef.current = null;
      pendingRecordPlayRef.current = false;
      return;
    }

    let cancelled = false;
    const recordId = selectedId;
    async function loadRecord() {
      setSelectedRecordLoading(true);
      setExportStatus("");
      setRenameStatus("");
      setSelectedRecord(null);
      setRecordAudioPlaybackUrl(null);
      setRecordAudioPlaying(false);
      setRecordAudioError("");
      setRecordAudioStatus("loading");
      try {
        const record = await window.echosyncDesktop?.sessionRecords.get(recordId);
        if (cancelled) {
          return;
        }
        if (!record) {
          setSelectedRecord(null);
          setRecordAudioPlaybackUrl(null);
          setRecordAudioPlaying(false);
          setRecordAudioError("");
          setRecordAudioStatus("missing");
          setExportStatus("记录不存在");
          return;
        }
        const normalizedRecord = normalizeSessionRecordForReview(record);
        setSelectedRecord(normalizedRecord);
        setTitleDraft(normalizedRecord.title);
        const firstSegmentId = normalizedRecord.segments[0]?.id ?? null;
        setActiveRecordSegmentId(firstSegmentId);
        setPlaybackMs(normalizedRecord.segments[0]?.startMs ?? 0);
        const audioData = await window.echosyncDesktop?.sessionRecords.getAudioData(recordId);
        if (!cancelled) {
          if (audioData) {
            const audioBlob = new Blob([audioData.data], { type: audioData.mimeType || "audio/webm" });
            const seekableRecording = await ensureSeekableSessionRecording(
              { blob: audioBlob, mimeType: audioData.mimeType || audioBlob.type },
              normalizedRecord.durationMs
            );
            const objectUrl = URL.createObjectURL(seekableRecording?.blob ?? audioBlob);
            if (cancelled) {
              URL.revokeObjectURL(objectUrl);
              return;
            }
            setRecordAudioPlaybackUrl(objectUrl, true);
            setRecordAudioStatus("loading");
          } else {
            const audioUrl = await window.echosyncDesktop?.sessionRecords.getAudioUrl(recordId);
            if (!cancelled) {
              setRecordAudioPlaybackUrl(audioUrl ?? null);
              setRecordAudioStatus(audioUrl ? "loading" : "missing");
            }
          }
        }
      } catch (error) {
        log.warn("[session-records] 读取会议记录详情失败:", error);
        if (!cancelled) {
          setSelectedRecord(null);
          setRecordAudioPlaybackUrl(null);
          setRecordAudioPlaying(false);
          setRecordAudioError("");
          setRecordAudioStatus("failed");
          setExportStatus("加载失败");
        }
      } finally {
        if (!cancelled) {
          setSelectedRecordLoading(false);
        }
      }
    }

    void loadRecord();
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedId]);

  useEffect(() => () => {
    if (recordAudioObjectUrlRef.current) {
      URL.revokeObjectURL(recordAudioObjectUrlRef.current);
      recordAudioObjectUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    const remove = window.echosyncDesktop?.onSessionRecordChanged(async (recordId) => {
      await onRecordsChanged();
      if (!isOpen || selectedId !== recordId) {
        return;
      }
      try {
        const record = await window.echosyncDesktop?.sessionRecords.get(recordId);
        if (record) {
          setSelectedRecord(normalizeSessionRecordForReview(record));
        }
      } catch (error) {
        log.warn("[session-records] 刷新会议摘要失败:", error);
      }
    });
    return () => remove?.();
  }, [isOpen, onRecordsChanged, selectedId]);

  useEffect(() => {
    if (!activeRecordSegmentId) {
      return;
    }
    const node = recordSegmentRefs.current[activeRecordSegmentId];
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeRecordSegmentId]);

  if (!isOpen) {
    return null;
  }

  async function deleteRecord(recordId: string) {
    try {
      await window.echosyncDesktop?.sessionRecords.delete(recordId);
      await onRecordsChanged();
      setExportStatus("");
    } catch (error) {
      log.warn("[session-records] 删除会议记录失败:", error);
      setExportStatus("删除失败");
    }
    setDeleteId(null);
    if (selectedId === recordId) {
      setSelectedId(null);
      setSelectedRecord(null);
      setRecordAudioPlaybackUrl(null);
      setRecordAudioPlaying(false);
      setRecordAudioError("");
      setRecordAudioStatus("idle");
    }
  }

  async function exportSelectedRecord(format: SessionRecordExportFormat = "markdown") {
    if (!selectedRecord) {
      return;
    }
    try {
      const result = await window.echosyncDesktop?.sessionRecords.export(selectedRecord.id, format);
      const fallbackText = format === "markdown" ? serializeSessionRecordMarkdown(selectedRecord) : "";
      await window.echosyncDesktop?.copyText(result?.text ?? fallbackText);
      setExportStatus(format === "markdown" ? "Markdown 已复制" : `${sessionRecordExportFormatLabel(format)} 已复制`);
    } catch (error) {
      log.warn("[session-records] 导出会议记录失败:", error);
      setExportStatus("导出失败");
    }
  }

  async function regenerateSelectedSummary() {
    if (!selectedRecord) {
      return;
    }
    try {
      setExportStatus("摘要生成中...");
      await window.echosyncDesktop?.sessionRecords.generateSummary(selectedRecord.id);
      await onRecordsChanged();
      const record = await window.echosyncDesktop?.sessionRecords.get(selectedRecord.id);
      if (record) {
        setSelectedRecord(normalizeSessionRecordForReview(record));
      }
      setExportStatus("摘要已更新");
    } catch (error) {
      log.warn("[session-records] 重新生成会议摘要失败:", error);
      setExportStatus("摘要生成失败");
    }
  }

  async function renameSelectedRecord() {
    if (!selectedRecord) {
      return;
    }
    const nextTitle = titleDraft.trim();
    if (!nextTitle || nextTitle === selectedRecord.title) {
      setTitleDraft(selectedRecord.title);
      setRenameStatus("");
      return;
    }
    try {
      setRenameStatus("保存中...");
      const renamed = await window.echosyncDesktop?.sessionRecords.rename(selectedRecord.id, nextTitle);
      if (renamed) {
        const normalizedRecord = normalizeSessionRecordForReview(renamed);
        setSelectedRecord(normalizedRecord);
        setTitleDraft(normalizedRecord.title);
      }
      await onRecordsChanged();
      setRenameStatus("已重命名");
    } catch (error) {
      log.warn("[session-records] 重命名会议记录失败:", error);
      setTitleDraft(selectedRecord.title);
      setRenameStatus("重命名失败");
    }
  }

  function handleRecordTitleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void renameSelectedRecord();
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setTitleDraft(selectedRecord?.title ?? "");
      setRenameStatus("");
      event.currentTarget.blur();
    }
  }

  function handleRecordSegmentKeyDown(segment: SessionRecordSegment, event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    seekToRecordSegment(segment);
  }

  function seekToRecordSegment(segment: SessionRecordSegment) {
    setActiveRecordSegmentId(segment.id);
    pendingRecordPlayRef.current = true;
    seekRecordAudio(segment.startMs);
  }

  function setRecordAudioPlaybackUrl(nextUrl: string | null, ownsObjectUrl = false) {
    const currentObjectUrl = recordAudioObjectUrlRef.current;
    if (currentObjectUrl && currentObjectUrl !== nextUrl) {
      URL.revokeObjectURL(currentObjectUrl);
    }
    recordAudioObjectUrlRef.current = ownsObjectUrl ? nextUrl : null;
    setRecordAudioUrl(nextUrl);
  }

  function applyPendingRecordSeek(audio: HTMLAudioElement) {
    const pendingSeekMs = pendingRecordSeekMsRef.current;
    if (pendingSeekMs === null) {
      return;
    }
    if (!seekAudioElement(audio, pendingSeekMs)) {
      return;
    }
    pendingRecordSeekMsRef.current = null;
    setRecordAudioStatus("ready");
    setPlaybackMs(pendingSeekMs);
    if (!pendingRecordPlayRef.current) {
      return;
    }
    pendingRecordPlayRef.current = false;
    setRecordAudioError("");
    void audio.play()
      .then(() => {
        setRecordAudioPlaying(true);
      })
      .catch(() => {
        setRecordAudioPlaying(false);
        setRecordAudioError("音频无法播放");
      });
  }

  function scrubRecordAudio(nextMs: number) {
    pendingRecordPlayRef.current = false;
    seekRecordAudio(reviewToRawRecordMs(nextMs));
  }

  function seekRecordAudio(nextMs: number) {
    const durationMs = selectedRecord?.durationMs ?? 0;
    const boundedMs = Math.min(Math.max(nextMs, 0), Math.max(durationMs, 0));
    pendingRecordSeekMsRef.current = boundedMs;
    setPlaybackMs(boundedMs);
    const audio = recordAudioRef.current;
    if (!audio) {
      return;
    }
    if (audio.readyState === 0) {
      setRecordAudioStatus("loading");
      audio.load();
      return;
    }
    applyPendingRecordSeek(audio);
  }

  function reviewToRawRecordMs(nextReviewMs: number) {
    if (!selectedReviewTimeline) {
      return nextReviewMs;
    }
    return reviewToRawMs(selectedReviewTimeline, nextReviewMs);
  }

  function toggleRecordAudioPlayback() {
    const audio = recordAudioRef.current;
    if (!audio) {
      if (recordAudioStatus === "loading") {
        setRecordAudioError("音频仍在加载，请稍候");
      } else if (recordAudioStatus === "missing") {
        setRecordAudioError("本地没有保存可回放音频");
      }
      return;
    }
    if (recordAudioPlaying) {
      audio.pause();
      setRecordAudioPlaying(false);
      return;
    }
    setRecordAudioError("");
    pendingRecordPlayRef.current = true;
    pendingRecordSeekMsRef.current = playbackMs;
    if (audio.readyState < 2) {
      setRecordAudioStatus("loading");
      audio.load();
      return;
    }
    applyPendingRecordSeek(audio);
  }

  function updateRecordPlayback(currentMs: number) {
    const skipTargetRawMs = selectedReviewTimeline ? selectAutoSkipTargetRawMs(selectedReviewTimeline, currentMs) : null;
    if (skipTargetRawMs !== null && recordAudioPlaying) {
      const audio = recordAudioRef.current;
      pendingRecordPlayRef.current = false;
      pendingRecordSeekMsRef.current = skipTargetRawMs;
      setPlaybackMs(skipTargetRawMs);
      if (audio) {
        if (!seekAudioElement(audio, skipTargetRawMs)) {
          return;
        }
        pendingRecordSeekMsRef.current = null;
      }
      if (selectedRecord) {
        const segmentId = selectSessionRecordPlaybackSegmentId(selectedRecord.segments, skipTargetRawMs);
        setActiveRecordSegmentId(segmentId);
      }
      return;
    }
    const boundedMs = selectedRecord ? Math.min(currentMs, selectedRecord.durationMs) : currentMs;
    setPlaybackMs(boundedMs);
    if (!selectedRecord) {
      return;
    }
    setActiveRecordSegmentId(selectSessionRecordPlaybackSegmentId(selectedRecord.segments, boundedMs));
  }

  return (
    <aside className={isDetailView ? "recordWindow detail" : "recordWindow"} aria-label="会议记录">
      <header className={isDetailView ? "recordHeader detail" : "recordHeader"}>
        <div>
          <p>{isDetailView ? "内容自动保存 · 数据安全保护 · 译文由 AI 生成" : "记录"}</p>
          {isDetailView ? (
            <div className="recordTitleEditor">
              <input
                aria-label="会议记录名称"
                className="recordTitleInput"
                onBlur={() => void renameSelectedRecord()}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={handleRecordTitleKeyDown}
                value={titleDraft || selectedListRecord?.title || ""}
              />
              {renameStatus ? <span role="status">{renameStatus}</span> : null}
            </div>
          ) : (
            <h2>会议记录</h2>
          )}
        </div>
        {!isDetailView ? (
          <label>
            <span>搜索会议名称</span>
            <input
              aria-label="搜索会议名称"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索会议名称"
              value={searchQuery}
            />
          </label>
        ) : null}
        {isDetailView ? <button className="recordBackButton" aria-label="返回记录列表" onClick={() => setSelectedId(null)}>←</button> : null}
        <button aria-label="关闭会议记录" onClick={onClose}>×</button>
      </header>
      {!isDetailView ? (
        <>
          <SessionRecordTable
            onDelete={(recordId) => setDeleteId(recordId)}
            onView={(recordId) => {
              setSelectedId(recordId);
              setExportStatus("");
            }}
            records={filteredRecords}
          />
          {deleteId ? (
            <section className="recordDeleteConfirm" role="alert">
              <span>删除后将移除本地记录。</span>
              <button onClick={() => setDeleteId(null)}>取消</button>
              <button onClick={() => void deleteRecord(deleteId)}>确认删除</button>
            </section>
          ) : null}
          {records.length === 0 ? <p className="archiveMissing">暂无已保存记录。</p> : null}
          {records.length > 0 && filteredRecords.length === 0 ? <p className="archiveMissing">没有匹配的会议记录。</p> : null}
        </>
      ) : null}
      {isDetailView && selectedRecordLoading ? (
        <section className="recordDetailPanel" aria-label="记录详情">
          <p className="archiveMissing">正在加载记录...</p>
        </section>
      ) : null}
      {isDetailView && !selectedRecordLoading && !selectedRecord ? (
        <section className="recordDetailPanel" aria-label="记录详情">
          <p className="archiveMissing">{exportStatus || "没有找到这条会议记录。"}</p>
        </section>
      ) : null}
      {selectedRecord ? (
        <section className="recordDetailPanel" aria-label="记录详情">
          <header>
            <div>
              <p>点击片段可定位回放，播放时会高亮并自然滚动。</p>
              <h3>双语复盘</h3>
            </div>
            <div className="recordDetailActions">
              <button onClick={() => setReviewScale((value) => Math.max(0.9, Number((value - 0.05).toFixed(2))))}>字号 -</button>
              <button onClick={() => setReviewScale((value) => Math.min(1.25, Number((value + 0.05).toFixed(2))))}>字号 +</button>
              <button onClick={() => void exportSelectedRecord("txt")}>TXT</button>
              <button onClick={() => void exportSelectedRecord("srt")}>SRT</button>
              <button className="primaryAction" onClick={() => void exportSelectedRecord()}>导出</button>
              {exportStatus ? <span className="recordExportStatus" role="status">{exportStatus}</span> : null}
            </div>
          </header>
          <div className="recordAudioPlayer" aria-label="原始音频回放">
            {recordAudioUrl ? (
              <>
                <audio
                  preload="auto"
                  ref={recordAudioRef}
                  src={recordAudioUrl}
                  onEnded={() => {
                    setRecordAudioPlaying(false);
                    updateRecordPlayback(selectedRecord.durationMs);
                  }}
                  onError={() => {
                    setRecordAudioPlaying(false);
                    setRecordAudioStatus("failed");
                    setRecordAudioError("音频加载失败");
                  }}
                  onCanPlay={(event) => {
                    setRecordAudioStatus("ready");
                    applyPendingRecordSeek(event.currentTarget);
                  }}
                  onLoadedMetadata={(event) => {
                    setRecordAudioStatus("ready");
                    applyPendingRecordSeek(event.currentTarget);
                  }}
                  onPause={() => setRecordAudioPlaying(false)}
                  onPlay={() => setRecordAudioPlaying(true)}
                  onTimeUpdate={(event) => updateRecordPlayback(Math.round(event.currentTarget.currentTime * 1000))}
                />
                <div className="recordAudioControls">
                  <button onClick={toggleRecordAudioPlayback} type="button">
                    {recordAudioPlaying ? "暂停" : "播放"}
                  </button>
                  <input
                    aria-label="音频回放进度"
                    max={reviewDurationMs}
                    min={0}
                    onChange={(event) => scrubRecordAudio(Number(event.target.value))}
                    step={250}
                    type="range"
                    value={Math.min(reviewPlaybackMs, reviewDurationMs)}
                  />
                </div>
                {recordAudioStatus === "loading" ? <span className="recordAudioStatus" role="status">音频加载中...</span> : null}
                {recordAudioError ? <span className="recordAudioError" role="status">{recordAudioError}</span> : null}
                {skippedSilenceMarker ? (
                  <span className="recordAudioStatus" role="status">
                    已压缩 {formatDurationForRecord(skippedSilenceMarker.skippedMs)} 静音
                  </span>
                ) : null}
              </>
            ) : (
              <span>
                {recordAudioStatus === "loading"
                  ? "音频加载中..."
                  : recordAudioStatus === "failed"
                    ? "音频加载失败"
                    : "本地没有保存可回放音频。"}
              </span>
            )}
            <time>{formatTime(reviewPlaybackMs)} / {formatTime(reviewDurationMs)}</time>
          </div>
          <div className="recordDetailLayout">
            <div className="recordTranscriptList" style={{ fontSize: `${reviewScale}em` }} aria-label="双语片段">
              {selectedRecord.segments.length > 0 ? (
                selectedRecord.segments.map((segment) => (
                  <article
                    className={segment.id === activeRecordSegmentId ? "recordSegmentPair active" : "recordSegmentPair"}
                    key={segment.id}
                    onClick={() => seekToRecordSegment(segment)}
                    onKeyDown={(event) => handleRecordSegmentKeyDown(segment, event)}
                    ref={(node) => {
                      recordSegmentRefs.current[segment.id] = node;
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <time>{formatTime(segment.startMs)}-{formatTime(segment.endMs)}</time>
                    <p className="recordSegmentSource">{selectedRecordSegmentSourceText(segment) || "原文为空"}</p>
                    <p className="recordSegmentTarget">{selectedRecordSegmentTargetText(segment) || "译文待补全"}</p>
                  </article>
                ))
              ) : (
                <p className="archiveMissing">这条记录没有可复盘文本。</p>
              )}
            </div>
            <aside className="recordSummaryAside" aria-label="摘要与元数据">
              <section>
                <p className="eyebrow">摘要</p>
                <h3>{sessionRecordSummaryStatusLabel(selectedRecord.summary.status)}</h3>
                <p>{selectedRecord.summary.text || "摘要暂未生成。保存后仍可先查看完整双语记录。"}</p>
                {selectedRecord.summary.status === "failed" && selectedRecord.summary.errorMessage ? (
                  <p className="recordSummaryError">{selectedRecord.summary.errorMessage}</p>
                ) : null}
                {selectedRecord.summary.status !== "ready" ? (
                  <button className="recordSummaryRetry" onClick={() => void regenerateSelectedSummary()} type="button">
                    {selectedRecord.summary.status === "failed" ? "重新生成摘要" : "生成摘要"}
                  </button>
                ) : null}
                {selectedRecord.summary.keywords.length > 0 ? (
                  <div className="recordKeywordList">
                    {selectedRecord.summary.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
                  </div>
                ) : null}
                <RecordSummaryList title="行动项" items={selectedRecord.summary.actionItems} />
                <RecordSummaryList title="主题" items={selectedRecord.summary.topics} />
                <RecordSummaryList title="风险" items={selectedRecord.summary.risks} />
                <RecordSummaryList title="术语建议" items={selectedRecord.summary.terminologySuggestions} />
              </section>
              <section className="recordMetadataGrid">
                <span>开始</span><strong>{formatDateTimeForRecord(selectedRecord.startedAt)}</strong>
                <span>结束</span><strong>{formatDateTimeForRecord(selectedRecord.endedAt)}</strong>
                <span>复盘时长</span><strong>{formatDurationForRecord(reviewDurationMs)}</strong>
                <span>总录制时长</span><strong>{formatDurationForRecord(selectedRecord.durationMs)}</strong>
                <span>语言</span><strong>{selectedRecord.sourceLang} → {selectedRecord.targetLang}</strong>
                <span>片段</span><strong>{selectedRecord.metadata.segmentCount}</strong>
                <span>修订</span><strong>{selectedRecord.metadata.patchCount}</strong>
                <span>字符</span><strong>{selectedRecord.metadata.sourceCharCount} / {selectedRecord.metadata.targetCharCount}</strong>
                <span>平均延迟</span><strong>{formatMetricMs(selectedRecord.metadata.averageCaptionLagMs ?? null)}</strong>
              </section>
              <details className="recordDiagnostics">
                <summary>诊断信息</summary>
                <div>
                  <span>时间轴异常：{selectedRecord.diagnostics?.hasTimingAnomaly ? "已校正" : "未发现"}</span>
                  <span>翻译缺口：{selectedRecord.diagnostics?.hasTranslationGap ? "存在" : "未发现"}</span>
                  <span>音频：{selectedRecord.audio ? `${Math.round(selectedRecord.audio.sizeBytes / 1024)} KB` : "未保存"}</span>
                  <span>更新时间：{formatDateTimeForRecord(selectedRecord.updatedAt)}</span>
                </div>
              </details>
            </aside>
          </div>
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
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const totalPages = Math.ceil(records.length / pageSize);
  const visibleRecords = records.slice(page * pageSize, (page + 1) * pageSize);
  const hasRecordActions = Boolean(onView || onDelete);

  return (
    <>
      <div className={compact ? "recordTable compact" : "recordTable"} role="table" aria-label="会议记录列表">
        <div className="recordTableHead" role="row">
          {RECORD_LIST_COLUMNS.map((column) => (
            <span key={column} role="columnheader">{column}</span>
          ))}
        </div>
        <div className="recordTableBody">
          {visibleRecords.map((record) => (
            <div className={record.id === selectedId ? "recordTableRow selected" : "recordTableRow"} key={record.id} role="row">
              <strong role="cell">{record.title}</strong>
              <span role="cell">{record.endedAt}</span>
              <span role="cell">{record.duration}</span>
              {hasRecordActions ? (
                <span className="recordActions" role="cell">
                  {onView ? <button onClick={() => onView(record.id)}>查看</button> : null}
                  {onDelete ? <button onClick={() => onDelete(record.id)}>删除</button> : null}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      {totalPages > 1 ? (
        <div className="recordPagination">
          <button disabled={page === 0} onClick={() => setPage(0)} type="button">首页</button>
          <button disabled={page === 0} onClick={() => setPage(page - 1)} type="button">上一页</button>
          <span>{page + 1} / {totalPages}</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} type="button">下一页</button>
          <button disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} type="button">末页</button>
        </div>
      ) : null}
    </>
  );
}

function OverlayWindow({
  activeLine,
  agentCapabilities,
  languageDirection,
  lines,
  onLanguageDirectionSelect,
  onSourceStart,
  onStop,
  onTranslationProviderSelect,
  snapshot,
  translationProvider
}: {
  activeLine?: CaptionLine;
  agentCapabilities: AgentCapabilities | null;
  languageDirection: LanguageDirectionOption;
  lines: CaptionLine[];
  onLanguageDirectionSelect: (directionId: LanguageDirectionId) => void;
  onSourceStart: (sourceId: DesktopAudioSourceId) => void;
  onStop: () => void;
  onTranslationProviderSelect: (provider: TranslationProviderSelection) => void;
  snapshot: DesktopCaptureSnapshot;
  translationProvider: TranslationProviderSelection;
}) {
  const isListening = snapshot.state === "listening";
  const [interaction, setInteraction] = useState(createInitialOverlayInteractionState);
  const { subtitleStyle, updateSubtitleStyle } = useSharedSubtitleStyle();
  const isPinned = interaction.layer === "pinned";
  const [overlayExitConfirmOpen, setOverlayExitConfirmOpen] = useState(false);
  const [displayBuffer, setDisplayBuffer] = useState<CaptionDisplayBuffer>(createInitialCaptionDisplayBuffer);
  const displayBufferRef = useRef<CaptionDisplayBuffer>(displayBuffer);
  const overlayRenderMetricsLoggedAtRef = useRef(0);
  const overlayRenderMetricsEventName = "caption_overlay_render_metrics";
  const [displayNowMs, setDisplayNowMs] = useState(() => Date.now());
  const [sessionStartedAtMs, setSessionStartedAtMs] = useState<number | null>(null);
  const [sessionNowMs, setSessionNowMs] = useState(() => Date.now());
  const overlayDisplayLines = useMemo(
    () => selectOverlayDisplayWindow(lines, activeLine?.id),
    [activeLine?.id, lines]
  );
  const displaySelectionResult = useMemo(() => {
    const selectStartedAt = performance.now();
    const selection = selectDisplayCaptionLines(displayBuffer, overlayDisplayLines, displayNowMs);
    return {
      selection,
      selectDisplayMs: performance.now() - selectStartedAt
    };
  }, [displayBuffer, displayNowMs, overlayDisplayLines]);
  const displaySelection = displaySelectionResult.selection;
  const pendingLineCount = displaySelection.pendingLineIds.length;
  const displayMode = normalizeSubtitleDisplayMode(subtitleStyle.displayMode);
  const displayPresentationResult = useMemo(() => {
    const presentationStartedAt = performance.now();
    const presentation = selectDisplayCaptionPresentation(displaySelection, displayMode);
    return {
      presentation,
      presentationMs: performance.now() - presentationStartedAt
    };
  }, [displayMode, displaySelection]);
  const displayPresentation = displayPresentationResult.presentation;
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
  const combinedHistoryLines = useMemo(
    () => [...historyLines, ...settlingLines],
    [historyLines, settlingLines]
  );
  const zonedCaptionLines = useMemo(
    () => selectOverlayCaptionRailLines(combinedHistoryLines, captionLineForDisplay),
    [captionLineForDisplay, combinedHistoryLines]
  );
  const [overlayInteractionLocked, setOverlayInteractionLocked] = useState(false);
  const [subtitleSettingsOpen, setSubtitleSettingsOpen] = useState(false);
  const [chromeMenu, setChromeMenu] = useState<OverlayChromeMenu>(null);
  const [captionContentMode, setCaptionContentMode] = useState<CaptionContentMode>("bilingual");
  const bottomMenuOpen = chromeMenu === "plan" || chromeMenu === "language";
  const showChrome = interaction.layer === "controls" || interaction.layer === "settings" || isPinned || overlayExitConfirmOpen || bottomMenuOpen;
  const showZonedCaptionRail = displayMode === "zonedPair" && captionContentMode === "bilingual";
  const captionRailLines = useMemo(
    () => selectOverlayCaptionRailLines(combinedHistoryLines, captionLineForDisplay),
    [captionLineForDisplay, combinedHistoryLines]
  );
  const hasCaptionHistory = false;
  const planLabel = translationProviderLabel(
    translationProvider,
    agentCapabilities?.defaults.translation_provider
  ).replace("通用模型", "自动");
  const translationPlanOptions = useMemo(
    () => TRANSLATION_PROVIDER_OPTIONS.filter((option) => option.id !== "mock").map((option) => {
      const providerId = option.providerId ?? agentCapabilities?.defaults.translation_provider;
      const capabilities = agentCapabilities;
      const provider = providerId && capabilities ? findAgentTranslationProvider(capabilities, providerId) : null;
      return {
        id: option.id,
        description: option.id === "server-default" ? "使用当前默认翻译方案" : provider?.reason || option.description,
        disabled: provider ? !provider.available : false,
        label: engineOptionLabel(option.label, option.id),
        selected: option.id === translationProvider
      };
    }),
    [agentCapabilities, translationProvider]
  );
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
    const nextSelection = selectDisplayCaptionLines(displayBufferRef.current, overlayDisplayLines, Date.now());
    displayBufferRef.current = nextSelection.buffer;
    setDisplayBuffer(nextSelection.buffer);
  }, [overlayDisplayLines]);

  useEffect(() => {
    if (pendingLineCount === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      const nowMs = Date.now();
      const nextSelection = selectDisplayCaptionLines(displayBufferRef.current, overlayDisplayLines, nowMs);
      displayBufferRef.current = nextSelection.buffer;
      setDisplayBuffer(nextSelection.buffer);
      setDisplayNowMs(nowMs);
    }, 24);
    return () => window.clearTimeout(timer);
  }, [displayNowMs, overlayDisplayLines, pendingLineCount]);

  useEffect(() => {
    const nowMs = Date.now();
    const selectDisplayMs = displaySelectionResult.selectDisplayMs;
    const presentationMs = displayPresentationResult.presentationMs;
    const metricLogAgeMs = nowMs - overlayRenderMetricsLoggedAtRef.current;
    const shouldLog =
      ((selectDisplayMs >= 2 || presentationMs >= 2 || displaySelection.displayLag.max >= 16) && metricLogAgeMs >= 250) ||
      metricLogAgeMs >= 1000;
    if (!shouldLog) {
      return;
    }
    overlayRenderMetricsLoggedAtRef.current = nowMs;
    log.debug(overlayRenderMetricsEventName, {
      linesCount: lines.length,
      displayLagMax: displaySelection.displayLag.max,
      displayLagSourceMax: displaySelection.displayLag.sourceMax,
      displayLagTargetMax: displaySelection.displayLag.targetMax,
      displayLagTotal: displaySelection.displayLag.total,
      pendingLineCount,
      presentationMs: roundMetric(presentationMs),
      selectDisplayMs: roundMetric(selectDisplayMs),
      sessionId: snapshot.sessionId,
      windowLineCount: overlayDisplayLines.length
    });
  }, [
    displayPresentationResult.presentationMs,
    displaySelection.displayLag.max,
    displaySelection.displayLag.sourceMax,
    displaySelection.displayLag.targetMax,
    displaySelection.displayLag.total,
    pendingLineCount,
    displaySelectionResult.selectDisplayMs,
    lines.length,
    overlayDisplayLines.length,
    snapshot.sessionId
  ]);

  useEffect(() => {
    const remove = window.echosyncDesktop?.onOverlayWake(() => {
      dispatchOverlay({ type: "fallback.wake" });
    });
    return () => remove?.();
  }, []);

  useEffect(() => {
    const remove = window.echosyncDesktop?.onOverlaySettingsWake(() => {
      void openSubtitleSettings();
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

  async function toggleSubtitleSettings() {
    const nextOpen = !subtitleSettingsOpen;
    setOverlayExitConfirmOpen(false);
    if (nextOpen) {
      await openSubtitleSettings();
      return;
    }

    setChromeMenu(null);
    setSubtitleSettingsOpen(false);
    dispatchOverlay({ type: "settings.closed" });
    await window.echosyncDesktop?.setSubtitleStyleWindowVisible(false);
  }

  async function openSubtitleSettings() {
    setOverlayExitConfirmOpen(false);
    setChromeMenu(null);
    setSubtitleSettingsOpen(true);
    dispatchOverlay({ type: "settings.opened" });
    await window.echosyncDesktop?.setSubtitleStyleWindowVisible(true);
  }

  function toggleChromeMenu(nextMenu: Exclude<OverlayChromeMenu, null>) {
    setOverlayExitConfirmOpen(false);
    setSubtitleSettingsOpen(false);
    void window.echosyncDesktop?.setSubtitleStyleWindowVisible(false);
    setChromeMenu((currentMenu) => {
      const shouldClose = currentMenu === nextMenu;
      dispatchOverlay(shouldClose ? { type: "settings.closed" } : { type: "settings.opened" });
      return shouldClose ? null : nextMenu;
    });
  }

  function closeChromeMenu() {
    setChromeMenu((currentMenu) => {
      if (currentMenu) {
        dispatchOverlay({ type: "settings.closed" });
      }
      return null;
    });
  }

  function selectOverlayDisplayMode(nextDisplayMode: SubtitleDisplayMode) {
    updateSubtitleStyle({ displayMode: nextDisplayMode });
    closeChromeMenu();
  }

  function selectOverlayTranslationProvider(nextProvider: TranslationProviderSelection) {
    onTranslationProviderSelect(nextProvider);
    closeChromeMenu();
  }

  function selectOverlayLanguageDirection(nextDirectionId: LanguageDirectionId) {
    onLanguageDirectionSelect(nextDirectionId);
    closeChromeMenu();
  }

  async function toggleOverlayCapture() {
    if (isListening) {
      onStop();
      return;
    }
    onSourceStart(snapshot.sourceId);
  }

  async function minimizeOverlay() {
    setOverlayExitConfirmOpen(false);
    closeChromeMenu();
    setSubtitleSettingsOpen(false);
    await window.echosyncDesktop?.setSubtitleStyleWindowVisible(false);
    await window.echosyncDesktop?.setOverlayVisible(false);
  }

  async function requestOverlayClose() {
    closeChromeMenu();
    setSubtitleSettingsOpen(false);
    await window.echosyncDesktop?.setSubtitleStyleWindowVisible(false);
    if (snapshot.state === "listening" || snapshot.state === "requesting") {
      setOverlayExitConfirmOpen(true);
      if (!isPinned) {
        dispatchOverlay({ type: "settings.opened" });
      }
      return;
    }
    await window.echosyncDesktop?.setOverlayVisible(false);
  }

  function cancelOverlayExit() {
    setOverlayExitConfirmOpen(false);
    if (!isPinned) {
      dispatchOverlay({ type: "settings.closed" });
    }
  }

  async function confirmOverlayExit() {
    setOverlayExitConfirmOpen(false);
    closeChromeMenu();
    setSubtitleSettingsOpen(false);
    await window.echosyncDesktop?.setSubtitleStyleWindowVisible(false);
    if (snapshot.state === "listening" || snapshot.state === "requesting") {
      onStop();
    }
    await window.echosyncDesktop?.setOverlayVisible(false);
  }

  async function selectMicrophoneCapture() {
    onSourceStart("microphone");
  }

  async function selectSystemCapture() {
    onSourceStart("windows-system");
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
          window.setTimeout(
            () => dispatchOverlay({ type: "hover.timer.elapsed", atMs: Date.now() }),
            interaction.hoverIntentDelayMs + 20
          );
        }}
        onMouseLeave={() => {
          const atMs = Date.now();
          dispatchOverlay({ type: "pointer.left", atMs });
          window.setTimeout(
            () => dispatchOverlay({ type: "collapse.timer.elapsed", atMs: Date.now() }),
            interaction.collapseDelayMs + 40
          );
        }}
      >
        <section
          className={`floatingCaption captionWindow ${showChrome ? "withChrome" : ""} ${hasCaptionHistory ? "hasHistory" : ""} ${bottomMenuOpen ? "hasBottomMenu" : ""} ${overlayExitConfirmOpen ? "hasExitConfirm" : ""} mode-${displayMode} outline-${subtitleStyle.outlineStyle}`}
          style={subtitleVars}
        >
          {showChrome ? (
            <div className="captionTopChrome">
              <OverlayToolbar
                displayMode={displayMode}
                activeMenu={chromeMenu}
                isPinned={isPinned}
                isSettingsOpen={subtitleSettingsOpen}
                isInteractionLocked={overlayInteractionLocked}
                onDisplayModeChange={selectOverlayDisplayMode}
                onInteractionLockToggle={() => void toggleOverlayInteractionLock()}
                onMenuToggle={toggleChromeMenu}
                onPinToggle={() => {
                  const nextPinned = !isPinned;
                  dispatchOverlay(nextPinned ? { type: "pin.enabled" } : { type: "pin.disabled" });
                  void window.echosyncDesktop?.setOverlayPinned(nextPinned);
                }}
                onMinimize={() => void minimizeOverlay()}
                onSettingsToggle={() => void toggleSubtitleSettings()}
                onClose={() => void requestOverlayClose()}
              />
            </div>
          ) : null}
          {showZonedCaptionRail ? (
            <ZonedCaptionRail lines={zonedCaptionLines} subtitleStyle={subtitleStyle} />
          ) : (
            <OverlayCaptionHistory
              contentMode={captionContentMode}
              lines={captionRailLines}
              subtitleStyle={subtitleStyle}
            />
          )}
          {bottomMenuOpen ? (
            <OverlayBottomMenuDock
              activeMenu={chromeMenu}
              languageDirection={languageDirection}
              onLanguageDirectionSelect={selectOverlayLanguageDirection}
              onPlanSelect={selectOverlayTranslationProvider}
              planOptions={translationPlanOptions}
            />
          ) : null}
          <div className="overlayMeta">
            <span className={`liveDot state-${snapshot.state}`} />
            <span>{isListening ? "正在同传" : "实时字幕"}</span>
            <span>{displayActiveLine ? `${formatTime(displayActiveLine.startMs)}-${formatTime(displayActiveLine.endMs)}` : "等待时间帧"}</span>
            <span>{sourceLabel(snapshot.sourceId)}</span>
          </div>
          {showChrome ? (
            <div className="captionBottomChrome">
              <OverlaySessionBar
                captionContentMode={captionContentMode}
                activeMenu={chromeMenu}
                durationMs={sessionDurationMs}
                isListening={isListening}
                languageDirection={languageDirection}
                onCaptureToggle={() => void toggleOverlayCapture()}
                onContentModeChange={setCaptionContentMode}
                onMenuToggle={toggleChromeMenu}
                onMicrophoneSelect={() => void selectMicrophoneCapture()}
                onSystemSelect={() => void selectSystemCapture()}
                planLabel={planLabel}
                snapshot={snapshot}
              />
            </div>
          ) : null}
          {overlayExitConfirmOpen ? (
            <OverlayExitConfirmDialog
              onCancel={cancelOverlayExit}
              onConfirm={() => void confirmOverlayExit()}
            />
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

function CaptionText({
  contentMode = "bilingual",
  line,
  subtitleStyle,
  useBufferedBlocks = false
}: {
  contentMode?: CaptionContentMode;
  line?: CaptionLine;
  subtitleStyle: SubtitleStyleState;
  useBufferedBlocks?: boolean;
}) {
  const blocks = useCaptionTextBlocks(line, subtitleStyle, useBufferedBlocks);
  const displayMode = normalizeSubtitleDisplayMode(subtitleStyle.displayMode);
  const showSource = contentMode !== "target";
  const showTarget = contentMode !== "source";

  return (
    <div className={`captionText mode-${displayMode} content-${contentMode}`}>
      {blocks.map((block) => (
        <article className={`captionTextBlock${block.isSplitPending ? " splitPending" : ""}`} key={block.id}>
          {showSource ? (
            <p
              aria-hidden={block.isSourcePlaceholder ? true : undefined}
              className={`overlaySource ${block.state}${block.isSourcePlaceholder ? " placeholderText" : ""}`}
              style={{ fontFamily: fontFamilyValue(subtitleStyle.sourceFont), fontWeight: selectSubtitleFontWeight("source", subtitleStyle.sourceBold) }}
            >
              {block.sourceText}
            </p>
          ) : null}
          {showTarget ? (
            <h1
              aria-hidden={block.isTargetPlaceholder ? true : undefined}
              className={`${block.state}${block.isTargetPlaceholder ? " placeholderText" : ""}`}
              style={{ fontFamily: fontFamilyValue(subtitleStyle.targetFont), fontWeight: selectSubtitleFontWeight("target", subtitleStyle.targetBold) }}
            >
              {block.targetText}
            </h1>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function useCaptionTextBlocks(
  line: CaptionLine | undefined,
  subtitleStyle: SubtitleStyleState,
  useBufferedBlocks: boolean
) {
  const blockBufferRef = useRef<CaptionTextBlockBuffer>(createInitialCaptionTextBlockBuffer());
  const [blockTickMs, setBlockTickMs] = useState(() => Date.now());
  const nowMs = Date.now();
  const bufferedSelection = useBufferedBlocks
    ? selectBufferedCaptionTextBlocks(blockBufferRef.current, line, subtitleStyle, nowMs)
    : null;
  if (bufferedSelection) {
    blockBufferRef.current = bufferedSelection.buffer;
  }
  const blocks = bufferedSelection?.blocks ?? selectCaptionTextBlocks(line, subtitleStyle);

  useEffect(() => {
    if (!bufferedSelection?.pending) {
      return;
    }
    const timer = window.setTimeout(() => setBlockTickMs(Date.now()), 48);
    return () => window.clearTimeout(timer);
  }, [bufferedSelection?.pending, blockTickMs]);

  return blocks;
}

function selectOverlayCaptionRailLines(historyLines: CaptionLine[], activeLine: CaptionLine | undefined): CaptionLine[] {
  const selectedLines: CaptionLine[] = [];

  function upsertLine(line: CaptionLine | undefined) {
    if (!line) {
      return;
    }
    const existingIndex = selectedLines.findIndex((item) => item.id === line.id);
    if (existingIndex >= 0) {
      selectedLines[existingIndex] = line;
      return;
    }
    selectedLines.push(line);
  }

  historyLines.forEach(upsertLine);
  upsertLine(activeLine);
  return selectedLines;
}

function ZonedCaptionRail({ lines, subtitleStyle }: { lines: CaptionLine[]; subtitleStyle: SubtitleStyleState }) {
  return (
    <div className="zonedCaptionRail" aria-label="分区对照字幕">
      <ZonedCaptionLane kind="source" lines={lines} subtitleStyle={subtitleStyle} />
      <ZonedCaptionLane kind="target" lines={lines} subtitleStyle={subtitleStyle} />
    </div>
  );
}

function ZonedCaptionLane({
  kind,
  lines,
  subtitleStyle
}: {
  kind: "source" | "target";
  lines: CaptionLine[];
  subtitleStyle: SubtitleStyleState;
}) {
  const laneRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<HTMLElement | null>(null);
  const isSource = kind === "source";
  const zonedStyle: SubtitleStyleState = { ...subtitleStyle, displayMode: "zonedPair" };
  const fallbackBlock = selectCaptionTextBlocks(undefined, zonedStyle)[0];
  const fallbackText = isSource ? fallbackBlock.sourceText : fallbackBlock.targetText;
  const selectedChunks = lines.length > 0
    ? selectZonedCaptionLaneChunks(kind, lines, zonedStyle)
    : [];
  const chunks = lines.length > 0
    ? selectedChunks
    : [createZonedCaptionFallbackChunk(fallbackText)];
  const streamState = chunks.at(-1)?.state ?? "interim";
  const isPlaceholder = chunks.length > 0 && chunks.every((chunk) => chunk.isPlaceholder);
  const itemKey = chunks.map((chunk) => `${chunk.key}:${chunk.text.length}`).join("|");
  const layoutKey = chunks.map((chunk) => `${chunk.key}:${chunk.text.length}:${zonedCaptionTextFingerprint(chunk.text)}`).join("|");
  useZonedCaptionLaneViewport(laneRef, streamRef, `${kind}:${layoutKey}`);

  return (
    <div
      aria-label={isSource ? "原文字幕区" : "译文字幕区"}
      className={`zonedCaptionLane ${kind}Lane`}
      ref={laneRef}
    >
      <article
        className={`zonedCaptionStream ${streamState} current${isPlaceholder ? " placeholderText" : ""}`}
        data-caption-item-key={itemKey || "placeholder"}
        ref={streamRef}
      >
        <p
          aria-hidden={isPlaceholder ? true : undefined}
          className={`zonedCaptionText ${kind}Text ${streamState}${isPlaceholder ? " placeholderText" : ""}`}
          style={{
            fontFamily: fontFamilyValue(isSource ? subtitleStyle.sourceFont : subtitleStyle.targetFont),
            fontWeight: selectSubtitleFontWeight(isSource ? "source" : "target", isSource ? subtitleStyle.sourceBold : subtitleStyle.targetBold)
          }}
        >
          {chunks.map((chunk, index) => (
            <span
              aria-hidden={chunk.isPlaceholder ? true : undefined}
              className={`zonedCaptionChunk ${chunk.state}${chunk.isPlaceholder ? " placeholderText" : ""}`}
              data-caption-item-key={chunk.key}
              key={chunk.key}
            >
              {chunk.text}{index < chunks.length - 1 ? " " : ""}
            </span>
          ))}
        </p>
      </article>
    </div>
  );
}

function useZonedCaptionLaneViewport(
  laneRef: { current: HTMLDivElement | null },
  streamRef: { current: HTMLElement | null },
  layoutKey: string
) {
  const scheduleUpdateRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const lane = laneRef.current;
    const stream = streamRef.current;
    if (!lane || !stream) {
      return;
    }

    let frame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const updateViewport = () => {
      frame = null;
      const laneStyle = window.getComputedStyle(lane);
      const textElement = stream.querySelector<HTMLElement>(".zonedCaptionText") ?? stream;
      const textStyle = window.getComputedStyle(textElement);
      const lineHeight = resolveZonedCaptionLineHeight(textStyle);
      const verticalPadding = cssPixelValue(laneStyle.paddingTop) + cssPixelValue(laneStyle.paddingBottom);
      const availableHeight = Math.max(0, lane.clientHeight - verticalPadding);
      const visibleLines = Math.max(1, Math.floor(availableHeight / lineHeight));
      const visibleHeight = visibleLines * lineHeight;
      lane.style.setProperty("--zoned-visible-lines", String(visibleLines));
      lane.style.setProperty("--zoned-visible-height", `${visibleHeight}px`);
      const scrollTop = selectZonedCaptionAlignedScrollTop(stream, textElement, visibleLines, lineHeight);
      if (Math.abs(stream.scrollTop - scrollTop) > 1) {
        stream.scrollTop = scrollTop;
      }
    };

    const scheduleUpdate = () => {
      if (frame !== null) {
        return;
      }
      frame = window.requestAnimationFrame(updateViewport);
    };

    scheduleUpdateRef.current = scheduleUpdate;
    scheduleUpdate();
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleUpdate);
      resizeObserver.observe(lane);
      resizeObserver.observe(stream);
    }

    return () => {
      scheduleUpdateRef.current = () => {};
      resizeObserver?.disconnect();
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [laneRef, streamRef]);

  useLayoutEffect(() => {
    scheduleUpdateRef.current();
  }, [layoutKey]);
}

function selectZonedCaptionAlignedScrollTop(
  stream: HTMLElement,
  textElement: HTMLElement,
  visibleLines: number,
  lineHeight: number
) {
  const maxScrollTop = Math.max(0, stream.scrollHeight - stream.clientHeight);
  const lineOffsets = measureZonedCaptionLineOffsets(textElement);
  if (lineOffsets.length > visibleLines) {
    const firstVisibleLineTop = lineOffsets[Math.max(0, lineOffsets.length - visibleLines)] ?? 0;
    return Math.max(0, Math.min(maxScrollTop, Math.round(firstVisibleLineTop)));
  }

  const rawScrollTop = Math.max(0, stream.scrollHeight - stream.clientHeight);
  return Math.max(0, Math.min(rawScrollTop, Math.floor(rawScrollTop / Math.max(lineHeight, 1)) * lineHeight));
}

function measureZonedCaptionLineOffsets(textElement: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(textElement);
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  range.detach();
  if (rects.length === 0) {
    return [];
  }

  const tops: number[] = [];
  for (const rect of rects.sort((a, b) => a.top - b.top)) {
    const previousTop = tops.at(-1);
    if (previousTop === undefined || Math.abs(rect.top - previousTop) > 2) {
      tops.push(rect.top);
    }
  }

  const firstTop = tops[0] ?? 0;
  return tops.map((top) => top - firstTop);
}

function resolveZonedCaptionLineHeight(style: CSSStyleDeclaration) {
  const parsedLineHeight = cssPixelValue(style.lineHeight);
  if (parsedLineHeight > 0) {
    return parsedLineHeight;
  }
  const fontSize = cssPixelValue(style.fontSize);
  return Math.max(1, fontSize * 1.25);
}

function cssPixelValue(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function zonedCaptionTextFingerprint(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 31) + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

type ZonedCaptionLaneChunk = {
  key: string;
  text: string;
  state: CaptionLine["state"];
  isPlaceholder: boolean;
};

function createZonedCaptionFallbackChunk(text: string): ZonedCaptionLaneChunk {
  return {
    key: "placeholder",
    text,
    state: "interim",
    isPlaceholder: true
  };
}

function selectZonedCaptionLaneChunks(
  kind: "source" | "target",
  lines: CaptionLine[],
  subtitleStyle: SubtitleStyleState
): ZonedCaptionLaneChunk[] {
  const isSource = kind === "source";
  const chunks: ZonedCaptionLaneChunk[] = [];

  for (const line of lines) {
    const block = selectCaptionTextBlocks(line, subtitleStyle)[0];
    const rawText = isSource ? block.sourceText : block.targetText;
    const text = rawText.replace(/\s+/g, " ").trim();
    const blockIsPlaceholder = isSource ? block.isSourcePlaceholder : block.isTargetPlaceholder;
    if (!text || blockIsPlaceholder) {
      continue;
    }
    chunks.push({
      key: `${kind}:${line.id}`,
      text,
      state: line.state,
      isPlaceholder: false
    });
  }

  return chunks;
}

function OverlayCaptionHistory({
  contentMode,
  lines,
  subtitleStyle
}: {
  contentMode: CaptionContentMode;
  lines: CaptionLine[];
  subtitleStyle: SubtitleStyleState;
}) {
  const historyRef = useRef<HTMLDivElement | null>(null);
  const lineRenderKey = lines.map((line) => `${line.id}:${line.rev}:${line.state}:${line.sourceText.length}:${line.targetText.length}`).join("|");
  const hiddenItemKeys = useCompleteCaptionItemVisibility(historyRef, ".historyLine", lineRenderKey);

  useLayoutEffect(() => {
    scrollCaptionRailToStableEdge(historyRef.current, ".historyLine", "smooth");
  }, [lineRenderKey]);

  return (
    <div className="overlayCaptionHistory" ref={historyRef}>
      {lines.length > 0 ? lines.map((line, index, visibleLines) => (
        <article
          className={`historyLine ${line.state} ${index === visibleLines.length - 1 ? "current" : ""}${hiddenItemKeys.has(line.id) ? " clipped" : ""}`}
          data-caption-item-key={line.id}
          key={line.id}
        >
          <CaptionText
            contentMode={contentMode}
            line={line}
            subtitleStyle={subtitleStyle}
            useBufferedBlocks={index === visibleLines.length - 1}
          />
        </article>
      )) : (
        <article
          className={`historyLine interim current${hiddenItemKeys.has("placeholder") ? " clipped" : ""}`}
          data-caption-item-key="placeholder"
        >
          <CaptionText contentMode={contentMode} line={undefined} subtitleStyle={subtitleStyle} useBufferedBlocks />
        </article>
      )}
    </div>
  );
}

function OverlayToolbar({
  activeMenu,
  displayMode,
  isPinned,
  isInteractionLocked,
  isSettingsOpen,
  onDisplayModeChange,
  onInteractionLockToggle,
  onClose,
  onMenuToggle,
  onPinToggle,
  onMinimize,
  onSettingsToggle,
}: {
  activeMenu: OverlayChromeMenu;
  displayMode: SubtitleDisplayMode;
  isPinned: boolean;
  isInteractionLocked: boolean;
  isSettingsOpen: boolean;
  onDisplayModeChange: (mode: SubtitleDisplayMode) => void;
  onInteractionLockToggle: () => void;
  onClose: () => void;
  onMenuToggle: (menu: Exclude<OverlayChromeMenu, null>) => void;
  onPinToggle: () => void;
  onMinimize: () => void;
  onSettingsToggle: () => void;
}) {
  const displayModes: SubtitleDisplayMode[] = ["sentencePair", "zonedPair"];
  return (
    <nav className="overlayToolbar" aria-label="字幕弹窗工具栏">
      <div className="overlayMenuCluster">
        <button
          aria-expanded={activeMenu === "display"}
          className={activeMenu === "display" ? "overlayMenuTrigger selected" : "overlayMenuTrigger"}
          onClick={() => onMenuToggle("display")}
          title="双语显示方式"
          type="button"
        >
          <ToolbarIcon name="target" />
          <span>{displayMode === "sentencePair" ? "逐句" : "分区"}</span>
          <span className="menuChevron">⌄</span>
        </button>
        {activeMenu === "display" ? (
          <div className="overlayDropdown top" role="menu" aria-label="双语显示方式">
            <span className="overlayDropdownHint">仅在双语模式下生效</span>
            {displayModes.map((mode) => (
              <button
                className={displayMode === mode ? "selected" : ""}
                aria-label={overlayDisplayModeAccessibleLabel(mode)}
                key={mode}
                onClick={() => onDisplayModeChange(mode)}
                role="menuitemradio"
                title={subtitleDisplayModeLabel(mode)}
                type="button"
              >
                <span className={`modePreview ${mode}`} aria-hidden="true">
                  <i />
                  <i />
                </span>
                <span>
                  <strong>{mode === "sentencePair" ? "逐句对照" : "分区对照"}</strong>
                  <small>{mode === "sentencePair" ? "按句分段，语意清晰" : "转写翻译，分区显示"}</small>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="overlayIconGroup">
        <div className={isInteractionLocked ? "lockToggleWrap locked" : "lockToggleWrap"}>
          <button
            aria-label={isInteractionLocked ? "解锁字幕" : "锁定字幕"}
            className={isInteractionLocked ? "lockToggleButton selected" : "lockToggleButton"}
            title={isInteractionLocked ? "解锁字幕" : "锁定字幕"}
            onClick={onInteractionLockToggle}
            type="button"
          >
            <ToolbarIcon name={isInteractionLocked ? "unlock" : "lock"} />
          </button>
          <span className="lockToggleHint">{isInteractionLocked ? "解锁字幕" : "锁定字幕"}</span>
        </div>
        <button className={isPinned ? "selected" : ""} title={isPinned ? "取消置顶" : "置于顶层"} onClick={onPinToggle} type="button">
          <ToolbarIcon name="pin" />
        </button>
        <button className={isSettingsOpen ? "selected" : ""} title="设置" onClick={onSettingsToggle} type="button">
          <ToolbarIcon name="settings" />
        </button>
        <button title="最小化" onClick={onMinimize} type="button">
          <ToolbarIcon name="minimize" />
        </button>
        <button title="关闭" onClick={onClose} type="button">
          <ToolbarIcon name="close" />
        </button>
      </div>
    </nav>
  );
}


function OverlaySessionBar({
  activeMenu,
  captionContentMode,
  durationMs,
  isListening,
  languageDirection,
  onCaptureToggle,
  onContentModeChange,
  onMenuToggle,
  onMicrophoneSelect,
  onSystemSelect,
  planLabel,
  snapshot
}: {
  activeMenu: OverlayChromeMenu;
  captionContentMode: CaptionContentMode;
  durationMs: number;
  isListening: boolean;
  languageDirection: LanguageDirectionOption;
  onCaptureToggle: () => void;
  onContentModeChange: (mode: CaptionContentMode) => void;
  onMenuToggle: (menu: Exclude<OverlayChromeMenu, null>) => void;
  onMicrophoneSelect: () => void;
  onSystemSelect: () => void;
  planLabel: string;
  snapshot: DesktopCaptureSnapshot;
}) {
  return (
    <div className="overlaySessionBar">
      <div className="inputSwitchGroup" aria-label="输入切换" role="group">
        <button
          className={snapshot.sourceId === "microphone" ? "roundSessionButton active" : "roundSessionButton"}
          title="麦克风"
          onClick={onMicrophoneSelect}
          type="button"
        >
          <ToolbarIcon name="mic" />
        </button>
        <button
          className={snapshot.sourceId === "windows-system" ? "roundSessionButton active" : "roundSessionButton"}
          title="Windows 系统声音"
          onClick={onSystemSelect}
          type="button"
        >
          <ToolbarIcon name="system" />
        </button>
      </div>
      <button
        className={isListening ? "roundSessionButton active" : "roundSessionButton"}
        title={isListening ? "停止同传" : "开始同传"}
        onClick={onCaptureToggle}
        type="button"
      >
        <ToolbarIcon name="power" />
      </button>
      <span className="sessionTimer">{formatClock(durationMs)}</span>
      <div className="overlaySessionMenuWrap planMenuWrap">
        <button
          aria-expanded={activeMenu === "plan"}
          className={activeMenu === "plan" ? "sessionPill actionPill planPill selected" : "sessionPill actionPill planPill"}
          onClick={() => onMenuToggle("plan")}
          title="模型或方案设置"
          type="button"
        >
          <ToolbarIcon name="model" />
          <span>{planLabel}</span>
          <span className="menuChevron">⌄</span>
        </button>
      </div>
      <div className="overlaySessionMenuWrap languageMenuWrap">
        <button
          aria-expanded={activeMenu === "language"}
          className={activeMenu === "language" ? "sessionPill actionPill languagePill selected" : "sessionPill actionPill languagePill"}
          onClick={() => onMenuToggle("language")}
          title={languageDirection.label}
          type="button"
        >
          <span>{languageDirection.shortLabel}</span>
          <span className="menuChevron">⌄</span>
        </button>
      </div>
      <div className="captionContentSwitch" role="group" aria-label="字幕内容">
        {captionContentModes.map((mode) => (
          <button
            className={captionContentMode === mode.id ? "selected" : ""}
            key={mode.id}
            onClick={() => onContentModeChange(mode.id)}
            type="button"
          >
            {mode.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function OverlayBottomMenuDock({
  activeMenu,
  languageDirection,
  onLanguageDirectionSelect,
  onPlanSelect,
  planOptions
}: {
  activeMenu: OverlayChromeMenu;
  languageDirection: LanguageDirectionOption;
  onLanguageDirectionSelect: (directionId: LanguageDirectionId) => void;
  onPlanSelect: (provider: TranslationProviderSelection) => void;
  planOptions: Array<{ id: TranslationProviderSelection; description: string; disabled: boolean; label: string; selected: boolean }>;
}) {
  if (activeMenu === "plan") {
    return (
      <div className="captionMenuDock menu-plan">
        <div className="overlayDropdown dockedOverlayMenu planMenu" role="menu" aria-label="模型或方案设置">
          <span className="overlayDropdownHint">切换后用于下一次启动或重启同传</span>
          {planOptions.map((option) => (
            <button
              className={option.selected ? "selected" : ""}
              disabled={option.disabled}
              key={option.id}
              onClick={() => onPlanSelect(option.id)}
              role="menuitemradio"
              title={option.description}
              type="button"
            >
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (activeMenu === "language") {
    return (
      <div className="captionMenuDock menu-language">
        <div className="overlayDropdown dockedOverlayMenu languageMenu" role="menu" aria-label="语言设置">
          {languageDirectionOptions.map((option) => (
            <button
              className={option.id === languageDirection.id ? "selected" : ""}
              key={option.id}
              onClick={() => onLanguageDirectionSelect(option.id)}
              role="menuitemradio"
              title={option.label}
              type="button"
            >
              <span>
                <strong>{option.shortLabel}</strong>
                <small>{option.label}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

function OverlayExitConfirmDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="overlayExitConfirmScrim" role="presentation">
      <section aria-modal="true" className="overlayExitConfirm" role="dialog" aria-labelledby="overlayExitConfirmTitle">
        <h2 id="overlayExitConfirmTitle">退出同传？</h2>
        <p>将停止当前识别并保存本次字幕记录，之后可在会议记录中查看。</p>
        <div className="overlayExitConfirmActions">
          <button onClick={onCancel} type="button">
            取消
          </button>
          <button className="danger" onClick={onConfirm} type="button">
            退出同传
          </button>
        </div>
      </section>
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

type ToolbarIconName =
  | "settings"
  | "lock"
  | "unlock"
  | "pin"
  | "target"
  | "more"
  | "close"
  | "mic"
  | "system"
  | "power"
  | "minimize"
  | "model";

function ToolbarIcon({ name }: { name: ToolbarIconName }) {
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
      {name === "unlock" ? (
        <>
          <rect x="5" y="10" width="14" height="10" rx="2.3" {...common} />
          <path d="M8.2 10V7.5a3.8 3.8 0 0 1 6.7-2.4" {...common} />
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
      {name === "minimize" ? <path d="M6 12h12" {...common} /> : null}
      {name === "mic" ? (
        <>
          <rect x="9" y="3.5" width="6" height="10" rx="3" {...common} />
          <path d="M5.8 11.5a6.2 6.2 0 0 0 12.4 0M12 17.8V21M8.8 21h6.4" {...common} />
        </>
      ) : null}
      {name === "system" ? (
        <>
          <rect x="4" y="5" width="16" height="11" rx="2" {...common} />
          <path d="M9 20h6M12 16v4M7.5 9.2h9" {...common} />
        </>
      ) : null}
      {name === "power" ? (
        <>
          <path d="M12 3.5v8" {...common} />
          <path d="M7.4 6.8a7.2 7.2 0 1 0 9.2 0" {...common} />
        </>
      ) : null}
      {name === "model" ? (
        <>
          <rect x="4" y="5" width="16" height="14" rx="3" {...common} />
          <path d="M8 9h8M8 13h5M16.5 13.5l1.3 1.3M18 12.2v2.6" {...common} />
        </>
      ) : null}
    </svg>
  );
}


function useCompleteCaptionItemVisibility(
  containerRef: { current: HTMLDivElement | null },
  itemSelector: string,
  layoutKey: string
) {
  const [hiddenItemKeys, setHiddenItemKeys] = useState<ReadonlySet<string>>(() => new Set());

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) {
      setHiddenItemKeys(new Set());
      return;
    }

    let frame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const edgeTolerancePx = 1;

    function measure() {
      frame = null;
      const container = containerRef.current;
      if (!container) {
        setHiddenItemKeys(new Set());
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const nextHiddenKeys = new Set<string>();
      const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
      for (const item of items) {
        const key = item.dataset.captionItemKey;
        if (!key) {
          continue;
        }

        const itemRect = item.getBoundingClientRect();
        const itemFitsInViewport = itemRect.height <= containerRect.height + edgeTolerancePx;
        const isFullyVisible =
          itemRect.top >= containerRect.top - edgeTolerancePx &&
          itemRect.bottom <= containerRect.bottom + edgeTolerancePx;
        if (itemFitsInViewport && !isFullyVisible) {
          nextHiddenKeys.add(key);
        }
      }

      setHiddenItemKeys((current) => (setsEqual(current, nextHiddenKeys) ? current : nextHiddenKeys));
    }

    function scheduleMeasure() {
      if (frame !== null) {
        return;
      }
      frame = window.requestAnimationFrame(measure);
    }

    scheduleMeasure();
    element.addEventListener("scroll", scheduleMeasure, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleMeasure);
      resizeObserver.observe(element);
      for (const item of element.querySelectorAll<HTMLElement>(itemSelector)) {
        resizeObserver.observe(item);
      }
    }

    return () => {
      element.removeEventListener("scroll", scheduleMeasure);
      resizeObserver?.disconnect();
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [containerRef, itemSelector, layoutKey]);

  return hiddenItemKeys;
}

function setsEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>) {
  if (left.size !== right.size) {
    return false;
  }
  for (const item of left) {
    if (!right.has(item)) {
      return false;
    }
  }
  return true;
}

function scrollTranscriptToBottom(element: HTMLDivElement | null, behavior: ScrollBehavior = "auto") {
  if (!element) {
    return;
  }
  element.scrollTo({ behavior, top: element.scrollHeight });
}

function scrollCaptionRailToStableEdge(
  element: HTMLDivElement | null,
  itemSelector: string,
  behavior: ScrollBehavior = "auto"
) {
  if (!element) {
    return;
  }

  const items = Array.from(element.querySelectorAll<HTMLElement>(itemSelector));
  const lastItem = items.at(-1);
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  const paddingBottom = Number.parseFloat(window.getComputedStyle(element).paddingBottom) || 0;
  const targetTop = lastItem
    ? Math.min(maxScrollTop, Math.max(0, lastItem.offsetTop + lastItem.offsetHeight + paddingBottom - element.clientHeight))
    : maxScrollTop;
  element.scrollTo({ behavior, top: targetTop });
}

function seekAudioElement(audio: HTMLAudioElement, nextMs: number) {
  const nextSeconds = nextMs / 1000;
  if (!Number.isFinite(nextSeconds)) {
    return false;
  }
  try {
    const boundedSeconds = Math.max(0, nextSeconds);
    if (typeof audio.fastSeek === "function") {
      audio.fastSeek(boundedSeconds);
    } else {
      audio.currentTime = boundedSeconds;
    }
    return true;
  } catch {
    return false;
  }
}

function audioActivityLabel(activity: SessionUiState["audioActivity"]) {
  const labels: Record<SessionUiState["audioActivity"], string> = {
    active: "有输入",
    clipping: "过载",
    device_missing: "设备缺失",
    permission_denied: "权限拒绝",
    silent: "静音"
  };
  return labels[activity];
}


createRoot(document.getElementById("root")!).render(<App />);
