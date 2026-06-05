import type { DesktopAudioSourceId } from "./audio-source-catalog";

export type RuntimePlatform = "windows" | "mac" | "web";
export type SessionLifecycle = "idle" | "active" | "finished";
export type ScenarioPresetId = "video-course" | "remote-meeting" | "tech-talk" | "file-replay";
export type AudioActivityState = "silent" | "active" | "clipping" | "device_missing" | "permission_denied";
export type AutoScrollMode = "following" | "locked";
export type TermSyncStatus = "syncing" | "active" | "failed";
export type ConfidenceDisplaySource = "native_confidence" | "derived_stability" | "unavailable";

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
};

export type SessionUiEvent =
  | { type: "audio.level.changed"; peak: number; rms: number }
  | { type: "audio.permission_denied" }
  | { type: "audio.device_missing" }
  | { type: "session.started" }
  | { type: "session.finished"; summary: SessionSummary }
  | { type: "session.reset" }
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
    }
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
      autoScroll: { mode: "following", newContentAvailable: false }
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
