import type { DesktopAudioSourceId } from "./audio-source-catalog";
import type { CaptionLine } from "./caption-store";

export type RuntimePlatform = "windows" | "mac" | "web";
export type SessionLifecycle = "idle" | "active" | "finished";
export type ScenarioPresetId = "video-course" | "remote-meeting" | "tech-talk" | "file-replay";
export type AudioActivityState = "silent" | "active" | "clipping" | "device_missing" | "permission_denied";
export type AutoScrollMode = "following" | "locked";
export type TermSyncStatus = "syncing" | "active" | "failed";
export type ConfidenceDisplaySource = "native_confidence" | "derived_stability" | "unavailable";
export type StartupPhase = "idle" | "preparing_audio" | "connecting_agent" | "opening_overlay" | "recovering" | "failed";

export type SessionSummary = {
  durationMs: number;
  segmentCount: number;
  patchCount: number;
  averageLatencyMs: number;
  wordCount: number;
};

export type SessionTerm = {
  id: string;
  source: string;
  target: string;
  status: TermSyncStatus;
};

export type StartupUiState = {
  phase: StartupPhase;
  startedAtMs: number | null;
  message: string;
  detail: string | null;
  canCancel: boolean;
};

export type SessionUiState = {
  lifecycle: SessionLifecycle;
  selectedPreset: ScenarioPresetId;
  selectedSourceId: DesktopAudioSourceId | "tab";
  audioActivity: AudioActivityState;
  preflight: {
    audioReady: boolean;
    warning: string | null;
    level: {
      peak: number;
      rms: number;
    };
  };
  controlBarVisible: boolean;
  activePanel: "start" | "transcript-monitor" | "summary";
  autoScroll: {
    mode: AutoScrollMode;
    newContentAvailable: boolean;
  };
  terms: SessionTerm[];
  confidence: {
    source: ConfidenceDisplaySource;
    label: string;
    value: number | null;
  };
  summary: SessionSummary | null;
  preExportEdit: {
    enabled: boolean;
    dirty: boolean;
  };
  startup: StartupUiState;
};

export type SessionHealthMetrics = {
  inputSource: string;
  firstCaptionLatencyMs: number | null;
  stableCommitLatencyMs: number | null;
  patchCount: number;
  audioLevel: AudioActivityState;
  confidenceLabel: string;
  averageStability: number | null;
};

export type SessionUiEvent =
  | { type: "audio.level.changed"; peak: number; rms: number }
  | { type: "audio.permission_denied" }
  | { type: "audio.device_missing" }
  | { type: "session.started" }
  | { type: "session.finished"; summary: SessionSummary }
  | { type: "session.reset" }
  | { type: "session.return_home" }
  | { type: "startup.started"; phase: Exclude<StartupPhase, "idle" | "failed">; atMs: number }
  | { type: "startup.phase.changed"; phase: Exclude<StartupPhase, "idle" | "failed">; atMs: number }
  | { type: "startup.slow_tick"; atMs: number }
  | { type: "startup.failed"; message: string }
  | { type: "startup.completed" }
  | { type: "startup.cancelled" }
  | { type: "transcript.user.scrolled_up" }
  | { type: "transcript.user.follow_current" }
  | { type: "transcript.user.selected_text" }
  | { type: "transcript.new_content" }
  | { type: "term.add.requested"; source: string; target: string }
  | { type: "term.add.synced"; id: string | undefined }
  | { type: "term.add.failed"; id: string | undefined }
  | { type: "pre_export.edited" }
  | { type: "confidence.updated"; source: ConfidenceDisplaySource; label: string; value: number | null };

export function selectDefaultSourceForPlatform(platform: RuntimePlatform): DesktopAudioSourceId | "tab" {
  if (platform === "windows") {
    return "windows-system";
  }
  if (platform === "web") {
    return "tab";
  }
  return "microphone";
}

export function createInitialSessionUiState({ platform }: { platform: RuntimePlatform }): SessionUiState {
  return {
    lifecycle: "idle",
    selectedPreset: "video-course",
    selectedSourceId: selectDefaultSourceForPlatform(platform),
    audioActivity: "silent",
    preflight: {
      audioReady: false,
      warning: "播放一段视频或说话，确认电平条有响应。",
      level: { peak: 0, rms: 0 }
    },
    controlBarVisible: false,
    activePanel: "start",
    autoScroll: {
      mode: "following",
      newContentAvailable: false
    },
    terms: [],
    confidence: {
      source: "derived_stability",
      label: "基于稳定度推断",
      value: null
    },
    summary: null,
    preExportEdit: {
      enabled: false,
      dirty: false
    },
    startup: createIdleStartupState()
  };
}

export function reduceSessionUiState(state: SessionUiState, event: SessionUiEvent): SessionUiState {
  if (event.type === "audio.level.changed") {
    const activity = event.peak > 0.92 ? "clipping" : event.rms > 0.03 ? "active" : "silent";
    return {
      ...state,
      audioActivity: activity,
      preflight: {
        audioReady: activity === "active" || activity === "clipping",
        warning: activity === "silent" ? "还没有检测到音频输入。" : null,
        level: { peak: event.peak, rms: event.rms }
      }
    };
  }

  if (event.type === "audio.permission_denied") {
    return {
      ...state,
      audioActivity: "permission_denied",
      preflight: {
        ...state.preflight,
        audioReady: false,
        warning: "音频权限被拒绝，请重新授权。"
      }
    };
  }

  if (event.type === "audio.device_missing") {
    return {
      ...state,
      audioActivity: "device_missing",
      preflight: {
        ...state.preflight,
        audioReady: false,
        warning: "没有找到可用音频设备。"
      }
    };
  }

  if (event.type === "session.started") {
    return {
      ...state,
      lifecycle: "active",
      activePanel: "transcript-monitor",
      controlBarVisible: true,
      autoScroll: { mode: "following", newContentAvailable: false },
      startup: createIdleStartupState()
    };
  }

  if (event.type === "session.finished") {
    return {
      ...state,
      lifecycle: "finished",
      activePanel: "summary",
      controlBarVisible: false,
      summary: event.summary,
      preExportEdit: { enabled: true, dirty: false }
    };
  }

  if (event.type === "session.reset") {
    return createInitialSessionUiState({ platform: state.selectedSourceId === "windows-system" ? "windows" : "web" });
  }

  if (event.type === "session.return_home") {
    return createInitialSessionUiState({ platform: state.selectedSourceId === "windows-system" ? "windows" : "web" });
  }

  if (event.type === "startup.started") {
    return {
      ...state,
      startup: createStartupState(event.phase, event.atMs)
    };
  }

  if (event.type === "startup.phase.changed") {
    return {
      ...state,
      startup: {
        ...createStartupState(event.phase, state.startup.startedAtMs ?? event.atMs),
        canCancel: state.startup.canCancel
      }
    };
  }

  if (event.type === "startup.slow_tick") {
    if (state.startup.phase === "idle") {
      return state;
    }
    const elapsedMs = state.startup.startedAtMs === null ? 0 : event.atMs - state.startup.startedAtMs;
    if (elapsedMs < 8000) {
      return state;
    }
    return {
      ...state,
      startup: {
        ...state.startup,
        canCancel: true,
        detail: "启动时间较长，请检查同传服务或网络连接。"
      }
    };
  }

  if (event.type === "startup.failed") {
    return {
      ...state,
      lifecycle: "idle",
      activePanel: "start",
      controlBarVisible: false,
      startup: {
        phase: "failed",
        startedAtMs: state.startup.startedAtMs,
        message: "启动失败",
        detail: event.message,
        canCancel: true
      }
    };
  }

  if (event.type === "startup.completed" || event.type === "startup.cancelled") {
    return {
      ...state,
      startup: createIdleStartupState()
    };
  }

  if (event.type === "transcript.user.scrolled_up" || event.type === "transcript.user.selected_text") {
    return {
      ...state,
      autoScroll: { ...state.autoScroll, mode: "locked" }
    };
  }

  if (event.type === "transcript.new_content") {
    return {
      ...state,
      autoScroll: {
        ...state.autoScroll,
        newContentAvailable: state.autoScroll.mode === "locked"
      }
    };
  }

  if (event.type === "transcript.user.follow_current") {
    return {
      ...state,
      autoScroll: { mode: "following", newContentAvailable: false }
    };
  }

  if (event.type === "term.add.requested") {
    const id = `term_${state.terms.length + 1}`;
    return {
      ...state,
      terms: [...state.terms, { id, source: event.source, target: event.target, status: "syncing" }]
    };
  }

  if (event.type === "term.add.synced" || event.type === "term.add.failed") {
    return {
      ...state,
      terms: state.terms.map((term) =>
        term.id === event.id ? { ...term, status: event.type === "term.add.synced" ? "active" : "failed" } : term
      )
    };
  }

  if (event.type === "pre_export.edited") {
    return {
      ...state,
      preExportEdit: { ...state.preExportEdit, dirty: true }
    };
  }

  if (event.type === "confidence.updated") {
    return {
      ...state,
      confidence: {
        source: event.source,
        label: event.label,
        value: event.value
      }
    };
  }

  return state;
}

function createIdleStartupState(): StartupUiState {
  return {
    phase: "idle",
    startedAtMs: null,
    message: "",
    detail: null,
    canCancel: false
  };
}

function createStartupState(phase: Exclude<StartupPhase, "idle" | "failed">, startedAtMs: number): StartupUiState {
  const copy = startupCopy[phase];
  return {
    phase,
    startedAtMs,
    message: copy.message,
    detail: copy.detail,
    canCancel: false
  };
}

const startupCopy: Record<Exclude<StartupPhase, "idle" | "failed">, { message: string; detail: string }> = {
  preparing_audio: {
    message: "正在准备音频输入...",
    detail: "请保持视频或会议正在播放。"
  },
  connecting_agent: {
    message: "正在连接同传服务...",
    detail: "首次启动可能需要模型预热。"
  },
  opening_overlay: {
    message: "正在打开字幕弹窗...",
    detail: "字幕窗会置顶显示在当前应用上方。"
  },
  recovering: {
    message: "正在恢复连接...",
    detail: "网络或模型响应较慢，系统正在重试。"
  }
};

export function selectSessionHealthMetrics({
  lines,
  sessionUi,
  sourceLabel
}: {
  lines: CaptionLine[];
  sessionUi: SessionUiState;
  sourceLabel: string;
}): SessionHealthMetrics {
  const firstLine = lines.find((line) => line.targetText || line.sourceText);
  const committedLines = lines.filter((line) => line.state === "locked");
  const firstCommittedLine = committedLines[0];
  const stabilityTotal = lines.reduce((sum, line) => sum + line.stability, 0);

  return {
    inputSource: sourceLabel,
    firstCaptionLatencyMs: firstLine?.startMs ?? null,
    stableCommitLatencyMs: firstCommittedLine ? Math.max(0, firstCommittedLine.endMs - firstCommittedLine.startMs) : null,
    patchCount: lines.reduce((sum, line) => sum + line.patchCount, 0),
    audioLevel: sessionUi.audioActivity,
    confidenceLabel: sessionUi.confidence.label,
    averageStability: lines.length > 0 ? Number((stabilityTotal / lines.length).toFixed(2)) : null
  };
}
