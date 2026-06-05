import { describe, expect, it } from "vitest";

import {
  createInitialSessionUiState,
  reduceSessionUiState,
  selectSessionHealthMetrics,
  selectDefaultSourceForPlatform
} from "../src/shared/session-ui-state";
import type { CaptionLine } from "../src/shared/caption-store";

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

  it("运行中或复盘页可以显式回到首页并清理会话态", () => {
    const active = reduceSessionUiState(createInitialSessionUiState({ platform: "windows" }), {
      type: "session.started"
    });
    const withTerm = reduceSessionUiState(active, {
      type: "term.add.requested",
      source: "agent",
      target: "智能体"
    });
    const finished = reduceSessionUiState(withTerm, {
      type: "session.finished",
      summary: {
        durationMs: 120000,
        segmentCount: 42,
        patchCount: 3,
        averageLatencyMs: 860,
        wordCount: 1800
      }
    });
    const edited = reduceSessionUiState(finished, { type: "pre_export.edited" });

    const returned = reduceSessionUiState(edited, { type: "session.return_home" });

    expect(returned.lifecycle).toBe("idle");
    expect(returned.activePanel).toBe("start");
    expect(returned.summary).toBeNull();
    expect(returned.terms).toEqual([]);
    expect(returned.preExportEdit.dirty).toBe(false);
  });

  it("启动同传时记录预热阶段并支持阶段切换", () => {
    const idle = createInitialSessionUiState({ platform: "windows" });
    const preparing = reduceSessionUiState(idle, { type: "startup.started", phase: "preparing_audio", atMs: 1000 });
    const connecting = reduceSessionUiState(preparing, {
      type: "startup.phase.changed",
      phase: "connecting_agent",
      atMs: 2200
    });
    const opening = reduceSessionUiState(connecting, {
      type: "startup.phase.changed",
      phase: "opening_overlay",
      atMs: 3300
    });

    expect(preparing.startup).toMatchObject({
      phase: "preparing_audio",
      startedAtMs: 1000,
      canCancel: false
    });
    expect(connecting.startup).toMatchObject({
      phase: "connecting_agent",
      message: "正在连接 Agent..."
    });
    expect(opening.startup).toMatchObject({
      phase: "opening_overlay",
      detail: "字幕窗会置顶显示在当前应用上方。"
    });
  });

  it("启动超过阈值后允许取消，完成或取消后清空启动态", () => {
    const preparing = reduceSessionUiState(createInitialSessionUiState({ platform: "windows" }), {
      type: "startup.started",
      phase: "preparing_audio",
      atMs: 1000
    });
    const slow = reduceSessionUiState(preparing, { type: "startup.slow_tick", atMs: 9200 });
    const completed = reduceSessionUiState(slow, { type: "startup.completed" });
    const cancelled = reduceSessionUiState(slow, { type: "startup.cancelled" });

    expect(slow.startup.canCancel).toBe(true);
    expect(slow.startup.detail).toContain("检查 Agent");
    expect(completed.startup.phase).toBe("idle");
    expect(cancelled.startup.phase).toBe("idle");
  });

  it("启动失败后保留错误消息并提供可取消状态", () => {
    const preparing = reduceSessionUiState(createInitialSessionUiState({ platform: "windows" }), {
      type: "startup.started",
      phase: "preparing_audio",
      atMs: 1000
    });
    const failed = reduceSessionUiState(preparing, {
      type: "startup.failed",
      message: "实时音频采集启动失败。"
    });

    expect(failed.startup).toMatchObject({
      phase: "failed",
      message: "启动失败",
      detail: "实时音频采集启动失败。",
      canCancel: true
    });
  });

  it("活跃会话失败后回到首页面板并保留错误浮层", () => {
    const active = reduceSessionUiState(createInitialSessionUiState({ platform: "windows" }), {
      type: "session.started"
    });

    const failed = reduceSessionUiState(active, {
      type: "startup.failed",
      message: "当前是 mock ASR，不能处理真实音频。"
    });

    expect(failed.lifecycle).toBe("idle");
    expect(failed.activePanel).toBe("start");
    expect(failed.controlBarVisible).toBe(false);
    expect(failed.startup).toMatchObject({
      phase: "failed",
      detail: "当前是 mock ASR，不能处理真实音频。"
    });
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

  it("根据字幕行和音频状态计算驾驶舱健康度", () => {
    const state = reduceSessionUiState(createInitialSessionUiState({ platform: "windows" }), {
      type: "audio.level.changed",
      peak: 0.42,
      rms: 0.18
    });
    const lines: CaptionLine[] = [
      {
        id: "seg_1",
        rev: 1,
        state: "locked",
        sourceText: "Hello",
        targetText: "你好",
        stability: 1,
        startMs: 120,
        endMs: 900,
        patchCount: 0
      },
      {
        id: "seg_2",
        rev: 2,
        state: "revised",
        sourceText: "agent",
        targetText: "智能体",
        stability: 0.72,
        startMs: 1100,
        endMs: 2400,
        patchCount: 2
      }
    ];

    const metrics = selectSessionHealthMetrics({ lines, sessionUi: state, sourceLabel: "Windows 系统声音" });

    expect(metrics.inputSource).toBe("Windows 系统声音");
    expect(metrics.firstCaptionLatencyMs).toBe(120);
    expect(metrics.stableCommitLatencyMs).toBe(780);
    expect(metrics.patchCount).toBe(2);
    expect(metrics.audioLevel).toBe("active");
    expect(metrics.confidenceLabel).toBe("基于稳定度推断");
    expect(metrics.averageStability).toBe(0.86);
  });
});
