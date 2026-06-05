import { describe, expect, it } from "vitest";

import {
  createInitialSessionUiState,
  reduceSessionUiState,
  selectDefaultSourceForPlatform
} from "../src/shared/session-ui-state";

describe("主页 Stateful Hybrid 状态模型", () => {
  it("Windows 桌面端默认选择视频/网课和系统音频", () => {
    const state = createInitialSessionUiState({ platform: "windows" });

    expect(state.lifecycle).toBe("idle");
    expect(state.selectedPreset).toBe("video-course");
    expect(state.selectedSourceId).toBe("windows-system");
    expect(selectDefaultSourceForPlatform("windows")).toBe("windows-system");
  });

  it("非 Windows 平台默认回退到可用的标签页音频或麦克风", () => {
    expect(selectDefaultSourceForPlatform("web")).toBe("tab");
    expect(selectDefaultSourceForPlatform("mac")).toBe("microphone");
  });

  it("检测到音频活动后起飞前校验变为 ready", () => {
    const state = reduceSessionUiState(createInitialSessionUiState({ platform: "windows" }), {
      type: "audio.level.changed",
      peak: 0.42,
      rms: 0.18
    });

    expect(state.audioActivity).toBe("active");
    expect(state.preflight.audioReady).toBe(true);
    expect(state.preflight.warning).toBeNull();
  });

  it("开始会话后进入 Active 并显示驾驶舱", () => {
    const state = reduceSessionUiState(createInitialSessionUiState({ platform: "windows" }), {
      type: "session.started"
    });

    expect(state.lifecycle).toBe("active");
    expect(state.activePanel).toBe("transcript-monitor");
    expect(state.controlBarVisible).toBe(true);
  });

  it("结束会话后进入 Finished 并开启导出前清理入口", () => {
    const active = reduceSessionUiState(createInitialSessionUiState({ platform: "windows" }), {
      type: "session.started"
    });
    const finished = reduceSessionUiState(active, {
      type: "session.finished",
      summary: {
        durationMs: 120000,
        segmentCount: 42,
        patchCount: 3,
        averageLatencyMs: 860,
        wordCount: 1800
      }
    });

    expect(finished.lifecycle).toBe("finished");
    expect(finished.summary?.segmentCount).toBe(42);
    expect(finished.preExportEdit.enabled).toBe(true);
  });

  it("用户回溯或选择文本时锁定自动滚动并提示新内容", () => {
    const active = reduceSessionUiState(createInitialSessionUiState({ platform: "windows" }), {
      type: "session.started"
    });
    const locked = reduceSessionUiState(active, { type: "transcript.user.scrolled_up" });
    const withNewContent = reduceSessionUiState(locked, { type: "transcript.new_content" });

    expect(withNewContent.autoScroll.mode).toBe("locked");
    expect(withNewContent.autoScroll.newContentAvailable).toBe(true);
  });

  it("术语快加必须经历 syncing 到 active", () => {
    const active = reduceSessionUiState(createInitialSessionUiState({ platform: "windows" }), {
      type: "session.started"
    });
    const syncing = reduceSessionUiState(active, {
      type: "term.add.requested",
      source: "agent",
      target: "智能体"
    });
    const termId = syncing.terms[0]?.id;
    const synced = reduceSessionUiState(syncing, { type: "term.add.synced", id: termId });

    expect(syncing.terms[0]).toMatchObject({ source: "agent", target: "智能体", status: "syncing" });
    expect(synced.terms[0]?.status).toBe("active");
  });
});
