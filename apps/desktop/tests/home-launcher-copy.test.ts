import { describe, expect, it } from "vitest";

import { ASR_LATENCY_OPTIONS, asrLatencyModeLabel } from "../src/shared/asr-provider-catalog";
import {
  ADVANCED_SETTINGS_NAV,
  HOME_FORBIDDEN_TERMS,
  HOME_LAUNCHER_COPY,
  PREFERENCE_ADVANCED_ENTRY,
  PREFERENCE_SETTINGS_NAV,
  RECORD_DETAIL_DEFAULT_SECTIONS,
  RECORD_LIST_COLUMNS,
  SUBTITLE_WINDOW_SETTINGS_ITEMS,
  buildHomeReadinessSummary,
  findHomeForbiddenTerms,
  productizeHomeDiagnostic
} from "../src/shared/home-launcher-copy";

describe("首页同传启动器文案", () => {
  it("首页默认文案不出现开发者和模型路由术语", () => {
    const homeText = [
      HOME_LAUNCHER_COPY.title,
      HOME_LAUNCHER_COPY.description,
      HOME_LAUNCHER_COPY.primaryAction,
      HOME_LAUNCHER_COPY.preferencesAction,
      buildHomeReadinessSummary({
        audioActive: true,
        engineReady: true,
        overlayReady: true,
        serviceReady: true
      })
    ].join(" ");

    expect(findHomeForbiddenTerms(homeText)).toEqual([]);
    expect(homeText).not.toContain("引擎自动");
  });

  it("质量模式使用同传产品语言而不是模型调参语言", () => {
    expect(ASR_LATENCY_OPTIONS.map((option) => option.label)).toEqual(["实时优先", "均衡", "准确复盘"]);
    expect(asrLatencyModeLabel("low_latency")).toBe("实时优先");
    expect(asrLatencyModeLabel("accuracy")).toBe("准确复盘");
  });

  it("首页禁用术语集合覆盖模型控制台高风险词", () => {
    expect(HOME_FORBIDDEN_TERMS).toEqual([
      "Mock",
      "ASR",
      "TTS",
      "Agent",
      "模型路由",
      "provider",
      "后端默认"
    ]);
  });

  it("普通偏好设置保持简单，高级能力只出现在高级入口", () => {
    expect(PREFERENCE_SETTINGS_NAV.map((item) => item.label)).toEqual([
      "常规",
      "模型",
      "术语",
      "字幕窗口",
      "记录隐私"
    ]);
    expect(PREFERENCE_ADVANCED_ENTRY.label).toBe("高级");
    expect(ADVANCED_SETTINGS_NAV.map((item) => item.label)).toEqual([
      "开发者调试"
    ]);
  });

  it("首页诊断文案隐藏 Agent 和 provider 等实现词", () => {
    expect(productizeHomeDiagnostic("桌面端没有返回 Agent 能力信息。")).toBe(
      "桌面端没有返回同传服务能力信息。"
    );
    expect(productizeHomeDiagnostic("Agent 不支持 ASR provider：mock")).toBe(
      "同传服务不支持语音识别引擎：mock"
    );
  });

  it("首页诊断文案隐藏 Electron IPC 调用前缀", () => {
    expect(
      productizeHomeDiagnostic(
        "Error invoking remote method 'agent:get-capabilities': Error: 无法连接同传 Agent（http://127.0.0.1:8766）。"
      )
    ).toBe("无法连接同传服务（http://127.0.0.1:8766）。");
  });

  it("字幕窗口设置不承载应用级引擎、日志或 WebSocket 配置", () => {
    const text = SUBTITLE_WINDOW_SETTINGS_ITEMS.join(" ");

    expect(text).toContain("字体大小");
    expect(text).toContain("鼠标穿透");
    expect(text).not.toContain("模型");
    expect(text).not.toContain("引擎");
    expect(text).not.toContain("WebSocket");
    expect(text).not.toContain("日志");
    expect(text).not.toContain("Mock");
  });

  it("会议记录默认详情只暴露复盘阅读和导出能力", () => {
    const text = RECORD_DETAIL_DEFAULT_SECTIONS.join(" ");

    expect(text).toContain("返回");
    expect(text).toContain("原文");
    expect(text).toContain("译文");
    expect(text).toContain("音频播放器");
    expect(text).toContain("播放高亮");
    expect(text).toContain("导出");
    expect(text).toContain("诊断信息");
    expect(text).not.toContain("模型");
    expect(text).not.toContain("WebSocket");
    expect(text).not.toContain("原始事件流");
    expect(text).not.toContain("fallback");
  });

  it("会议记录列表只暴露复盘所需列，不展示调试字段", () => {
    const text = RECORD_LIST_COLUMNS.join(" ");

    expect(RECORD_LIST_COLUMNS).toEqual(["名称", "结束时间", "时长", "操作"]);
    expect(text).not.toContain("模型");
    expect(text).not.toContain("provider");
    expect(text).not.toContain("WebSocket");
    expect(text).not.toContain("延迟");
  });
});
