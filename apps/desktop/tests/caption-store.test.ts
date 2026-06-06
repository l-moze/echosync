import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyRealtimeEvent,
  isRealtimeEventForActiveSession,
  selectActiveCaptionLine,
  selectActiveCaptionLineForDisplay,
  selectOverlayHistoryLinesForDisplay,
  selectOverlayHistoryLines
} from "../src/shared/caption-store";
import type { CaptionLine } from "../src/shared/caption-store";

describe("桌面字幕状态机", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("按 partial、patch、commit 更新同一个字幕片段", () => {
    const initialLines: CaptionLine[] = [];
    const withPartial = applyRealtimeEvent(initialLines, {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_1",
      rev: 1,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "GPU kernels reduce latency.",
      target_text: "GPU 核函数会降低延迟。",
      status: "partial",
      stability: 0.62,
      start_ms: 0,
      end_ms: 1800
    });

    const withPatch = applyRealtimeEvent(withPartial, {
      type: "translation.patch",
      session_id: "sess_demo",
      segment_id: "seg_1",
      rev: 2,
      base_rev: 1,
      target_lang: "zh-CN",
      operations: [{ op: "replace", from_char: 4, to_char: 7, text: "内核" }],
      reason: "terminology",
      stability: 0.86
    });

    const committed = applyRealtimeEvent(withPatch, {
      type: "segment.commit",
      session_id: "sess_demo",
      segment_id: "seg_1",
      rev: 2,
      start_ms: 0,
      end_ms: 1800,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "GPU kernels reduce latency.",
      target_text: "GPU 内核会降低延迟。",
      final: true
    });

    expect(committed).toEqual([
      {
        id: "seg_1",
        rev: 2,
        state: "locked",
        sourceText: "GPU kernels reduce latency.",
        targetText: "GPU 内核会降低延迟。",
        stability: 1,
        startMs: 0,
        endMs: 1800,
        patchCount: 1
      }
    ]);
  });

  it("源文 partial 更新不清空已有译文，避免打字机闪烁", () => {
    const initialLines: CaptionLine[] = [
      {
        id: "seg_live",
        rev: 2,
        state: "stable",
        sourceText: "This model",
        targetText: "这个模型",
        stability: 0.86,
        startMs: 0,
        endMs: 1000,
        patchCount: 0
      }
    ];

    const lines = applyRealtimeEvent(initialLines, {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_live",
      rev: 3,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "This model supports real time",
      target_text: "",
      status: "partial",
      stability: 0.7,
      start_ms: 0,
      end_ms: 1500
    });

    expect(lines[0].sourceText).toBe("This model supports real time");
    expect(lines[0].targetText).toBe("这个模型");
    expect(lines[0].state).toBe("interim");
  });

  it("独立 transcript partial 只更新源文并保留已有译文", () => {
    const initialLines: CaptionLine[] = [
      {
        id: "seg_live",
        rev: 2,
        state: "stable",
        sourceText: "This model",
        targetText: "这个模型",
        stability: 0.86,
        startMs: 0,
        endMs: 1000,
        patchCount: 0
      }
    ];

    const lines = applyRealtimeEvent(initialLines, {
      type: "transcript.partial",
      session_id: "sess_demo",
      segment_id: "seg_live",
      rev: 3,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "This model supports batch translation",
      target_text: "",
      status: "stable",
      stability: 0.76,
      start_ms: 0,
      end_ms: 1800
    });

    expect(lines[0].sourceText).toBe("This model supports batch translation");
    expect(lines[0].targetText).toBe("这个模型");
  });

  it("独立 transcript partial 达到可读长度时创建源文草稿，避免字幕窗空白", () => {
    const lines = applyRealtimeEvent([], {
      type: "transcript.partial",
      session_id: "sess_demo",
      segment_id: "seg_source",
      rev: 1,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "Waiting for model response",
      target_text: "",
      status: "partial",
      stability: 0.64,
      start_ms: 0,
      end_ms: 900
    });

    expect(lines).toHaveLength(1);
    expect(lines[0].sourceText).toBe("Waiting for model response");
    expect(lines[0].targetText).toBe("");
    expect(selectActiveCaptionLine(lines)?.id).toBe("seg_source");
  });

  it("独立 transcript partial 过短也立即进入当前行，避免前端比接收流更慢", () => {
    const lines = applyRealtimeEvent([], {
      type: "transcript.partial",
      session_id: "sess_demo",
      segment_id: "seg_short_source",
      rev: 1,
      source_lang: "zh",
      target_lang: "zh-CN",
      source_text: "等",
      target_text: "",
      status: "partial",
      stability: 0.42,
      start_ms: 0,
      end_ms: 160
    });

    expect(lines).toHaveLength(1);
    expect(lines[0].sourceText).toBe("等");
    expect(lines[0].targetText).toBe("");
  });

  it("不创建只有源文草稿的短 partial 行，避免字幕窗逐词闪烁", () => {
    const lines = applyRealtimeEvent([], {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_draft",
      rev: 1,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "Royal10",
      target_text: "",
      status: "partial",
      stability: 0.41,
      start_ms: 0,
      end_ms: 320
    });

    expect(lines).toEqual([]);
  });

  it("即使前序 partial 被暂存，segment commit 也必须创建最终字幕行", () => {
    const lines = applyRealtimeEvent([], {
      type: "segment.commit",
      session_id: "sess_demo",
      segment_id: "seg_committed",
      rev: 2,
      start_ms: 0,
      end_ms: 1800,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "The final caption should still appear.",
      target_text: "最终字幕仍然应该显示。",
      final: true
    });

    expect(lines).toHaveLength(1);
    expect(lines[0].id).toBe("seg_committed");
    expect(lines[0].state).toBe("locked");
    expect(lines[0].targetText).toBe("最终字幕仍然应该显示。");
  });

  it("保留已有行上的源文 partial 更新，避免隐藏当前段进展", () => {
    const initialLines: CaptionLine[] = [
      {
        id: "seg_live",
        rev: 1,
        state: "stable",
        sourceText: "This model is fast",
        targetText: "这个模型很快",
        stability: 0.86,
        startMs: 0,
        endMs: 1000,
        patchCount: 0
      }
    ];

    const lines = applyRealtimeEvent(initialLines, {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_live",
      rev: 2,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "This model is fast enough for live captions",
      target_text: "",
      status: "partial",
      stability: 0.72,
      start_ms: 0,
      end_ms: 1500
    });

    expect(lines).toHaveLength(1);
    expect(lines[0].sourceText).toBe("This model is fast enough for live captions");
    expect(lines[0].targetText).toBe("这个模型很快");
  });

  it("store 保留 Agent 已发布的短译文事件文本", () => {
    const oneChar = applyRealtimeEvent([], {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_token",
      rev: 1,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "Hello everyone",
      target_text: "大",
      status: "stable",
      stability: 0.8,
      start_ms: 0,
      end_ms: 1000
    });

    const shortUpdate = applyRealtimeEvent(oneChar, {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_token",
      rev: 1,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "Hello everyone",
      target_text: "大家",
      status: "stable",
      stability: 0.84,
      start_ms: 0,
      end_ms: 1000
    });

    expect(oneChar).toHaveLength(1);
    expect(oneChar[0].targetText).toBe("大");
    expect(shortUpdate).toHaveLength(1);
    expect(shortUpdate[0].targetText).toBe("大家");
  });

  it("store 不按短语阈值丢弃译文更新", () => {
    const fourChars = applyRealtimeEvent([], {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_phrase",
      rev: 1,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "The model starts",
      target_text: "模型开始",
      status: "stable",
      stability: 0.8,
      start_ms: 0,
      end_ms: 1000
    });
    const shortAppend = applyRealtimeEvent(fourChars, {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_phrase",
      rev: 1,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "The model starts",
      target_text: "模型开始了",
      status: "stable",
      stability: 0.86,
      start_ms: 0,
      end_ms: 1000
    });

    expect(fourChars).toHaveLength(1);
    expect(fourChars[0].targetText).toBe("模型开始");
    expect(shortAppend).toHaveLength(1);
    expect(shortAppend[0].targetText).toBe("模型开始了");
  });

  it("同一段晚到译文重启为短前缀时不回滚已有可读译文", () => {
    const initialLines: CaptionLine[] = [
      {
        id: "seg_log_restart",
        rev: 38,
        state: "stable",
        sourceText: "But a high-level idea is that once you have trained individual models.",
        targetText: "但一个高层次的想法是，一旦你为每种新关系训练了独立模型，现在对于一组新关系，你只需组合即可。",
        stability: 0.9,
        startMs: 0,
        endMs: 5200,
        patchCount: 0
      }
    ];

    const lines = applyRealtimeEvent(initialLines, {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_log_restart",
      rev: 39,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "But a high-level idea is that once you have trained individual models.",
      target_text: "但一个高层次",
      status: "stable",
      stability: 0.82,
      start_ms: 0,
      end_ms: 5400
    });

    expect(lines[0].targetText).toBe(initialLines[0].targetText);
    expect(lines[0].rev).toBe(39);
  });

  it("committed 译文候选短前缀重启也不回滚，最终 segment.commit 再 flush", () => {
    const initialLines: CaptionLine[] = [
      {
        id: "seg_committed_restart",
        rev: 14,
        state: "stable",
        sourceText: "More simplified from actually sampling from the target distribution.",
        targetText: "更简化自实际从目标分布采样，但它是无偏的。",
        stability: 0.92,
        startMs: 0,
        endMs: 3200,
        patchCount: 0
      }
    ];

    const held = applyRealtimeEvent(initialLines, {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_committed_restart",
      rev: 15,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "More simplified from actually sampling from the target distribution.",
      target_text: "更简化自",
      status: "committed",
      stability: 0.96,
      start_ms: 0,
      end_ms: 3400
    });

    const flushed = applyRealtimeEvent(held, {
      type: "segment.commit",
      session_id: "sess_demo",
      segment_id: "seg_committed_restart",
      rev: 16,
      start_ms: 0,
      end_ms: 3600,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "More simplified from actually sampling from the target distribution.",
      target_text: "更简化自实际从目标分布采样。",
      final: true
    });

    expect(held[0].targetText).toBe(initialLines[0].targetText);
    expect(held[0].state).toBe("stable");
    expect(flushed[0].targetText).toBe("更简化自实际从目标分布采样。");
    expect(flushed[0].state).toBe("locked");
  });

  it("非前缀的译文缩短也先保持可见稳定，等待 patch 或 segment.commit 修订", () => {
    const initialLines: CaptionLine[] = [
      {
        id: "seg_small_rewrite",
        rev: 6,
        state: "stable",
        sourceText: "the horizon plan shown in the demo",
        targetText: "显示地平线计划",
        stability: 0.9,
        startMs: 0,
        endMs: 2400,
        patchCount: 0
      }
    ];

    const lines = applyRealtimeEvent(initialLines, {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_small_rewrite",
      rev: 7,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "the horizon plan shown in the demo",
      target_text: "演示中显示",
      status: "committed",
      stability: 0.96,
      start_ms: 0,
      end_ms: 2600
    });

    expect(lines[0].targetText).toBe("显示地平线计划");
    expect(lines[0].rev).toBe(7);
  });

  it("双语当前行按最新源文接收顺序选择，不被旧段晚到译文抢焦点", () => {
    vi.useFakeTimers();
    vi.setSystemTime(500);
    const oldSource = applyRealtimeEvent([], {
      type: "transcript.partial",
      session_id: "sess_demo",
      segment_id: "seg_old",
      rev: 1,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "The previous sentence",
      target_text: "",
      status: "stable",
      stability: 0.8,
      start_ms: 0,
      end_ms: 1200
    });

    vi.setSystemTime(1000);
    const currentSource = applyRealtimeEvent(oldSource, {
      type: "transcript.partial",
      session_id: "sess_demo",
      segment_id: "seg_current",
      rev: 1,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "The current sentence is arriving",
      target_text: "",
      status: "partial",
      stability: 0.7,
      start_ms: 1200,
      end_ms: 2200
    });

    vi.setSystemTime(2000);
    const withLateTranslation = applyRealtimeEvent(currentSource, {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_old",
      rev: 2,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "The previous sentence",
      target_text: "上一句译文晚到了",
      status: "stable",
      stability: 0.9,
      start_ms: 0,
      end_ms: 1200
    });

    expect(selectActiveCaptionLineForDisplay(withLateTranslation, "bilingual")?.id).toBe("seg_current");
    expect(selectActiveCaptionLineForDisplay(withLateTranslation, "source")?.id).toBe("seg_current");
    expect(selectActiveCaptionLineForDisplay(withLateTranslation, "translation")?.id).toBe("seg_old");
  });


  it("已有译文的短增量也要保存到 desired 状态", () => {
    const initialLines: CaptionLine[] = [
      {
        id: "seg_token",
        rev: 1,
        state: "stable",
        sourceText: "Hello everyone",
        targetText: "大家好",
        stability: 0.84,
        startMs: 0,
        endMs: 1000,
        patchCount: 0
      }
    ];

    const held = applyRealtimeEvent(initialLines, {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_token",
      rev: 1,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "Hello everyone",
      target_text: "大家好呀",
      status: "stable",
      stability: 0.86,
      start_ms: 0,
      end_ms: 1000
    });

    expect(held).not.toBe(initialLines);
    expect(held[0].targetText).toBe("大家好呀");
  });

  it("忽略晚到的旧 revision，避免并发翻译回退字幕", () => {
    const initialLines: CaptionLine[] = [
      {
        id: "seg_live",
        rev: 3,
        state: "interim",
        sourceText: "My name is Evie",
        targetText: "",
        stability: 0.7,
        startMs: 0,
        endMs: 1800,
        patchCount: 0
      }
    ];

    const lines = applyRealtimeEvent(initialLines, {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_live",
      rev: 1,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "My",
      target_text: "我的",
      status: "stable",
      stability: 0.86,
      start_ms: 0,
      end_ms: 1000
    });

    expect(lines[0].rev).toBe(3);
    expect(lines[0].sourceText).toBe("My name is Evie");
    expect(lines[0].targetText).toBe("");
  });

  it("晚到旧 revision 译文可填补空译文，但不能回滚当前源文", () => {
    const initialLines: CaptionLine[] = [
      {
        id: "seg_live",
        rev: 3,
        state: "interim",
        sourceText: "My name is Evie and I speak quickly",
        targetText: "",
        stability: 0.7,
        startMs: 0,
        endMs: 2200,
        patchCount: 0
      }
    ];

    const lines = applyRealtimeEvent(initialLines, {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_live",
      rev: 1,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "My name is Evie",
      target_text: "我叫 Evie",
      status: "stable",
      stability: 0.86,
      start_ms: 0,
      end_ms: 1200
    });

    expect(lines[0].rev).toBe(3);
    expect(lines[0].sourceText).toBe("My name is Evie and I speak quickly");
    expect(lines[0].targetText).toBe("我叫 Evie");
    expect(lines[0].state).toBe("interim");
  });

  it("忽略 base_rev 不匹配的修订补丁，避免晚到 patch 覆盖新译文", () => {
    const initialLines: CaptionLine[] = [
      {
        id: "seg_patch",
        rev: 3,
        state: "stable",
        sourceText: "The model is fast.",
        targetText: "这个模型很快。",
        stability: 0.9,
        startMs: 0,
        endMs: 1200,
        patchCount: 0
      }
    ];

    const lines = applyRealtimeEvent(initialLines, {
      type: "translation.patch",
      session_id: "sess_demo",
      segment_id: "seg_patch",
      rev: 4,
      base_rev: 2,
      target_lang: "zh-CN",
      operations: [{ op: "replace", from_char: 0, to_char: 4, text: "旧补丁" }],
      reason: "revision_window",
      stability: 0.82
    });

    expect(lines).toEqual(initialLines);
  });

  it("忽略 locked 行上的修订补丁，避免最终字幕被自动改写", () => {
    const initialLines: CaptionLine[] = [
      {
        id: "seg_locked",
        rev: 2,
        state: "locked",
        sourceText: "The final line is locked.",
        targetText: "最终字幕已锁定。",
        stability: 1,
        startMs: 0,
        endMs: 1200,
        patchCount: 0
      }
    ];

    const lines = applyRealtimeEvent(initialLines, {
      type: "translation.patch",
      session_id: "sess_demo",
      segment_id: "seg_locked",
      rev: 3,
      base_rev: 2,
      target_lang: "zh-CN",
      operations: [{ op: "insert", at_char: 0, text: "错误" }],
      reason: "context_revision",
      stability: 0.82
    });

    expect(lines).toEqual(initialLines);
  });

  it("translation.partial 标记 committed 时不提前锁行，segment.commit 前仍允许修订补丁", () => {
    const withCommittedPartial = applyRealtimeEvent([], {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_committed_partial",
      rev: 2,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "The model fixes terms.",
      target_text: "模型修复条款。",
      status: "committed",
      stability: 0.95,
      start_ms: 0,
      end_ms: 1200
    });

    const revised = applyRealtimeEvent(withCommittedPartial, {
      type: "translation.patch",
      session_id: "sess_demo",
      segment_id: "seg_committed_partial",
      rev: 3,
      base_rev: 2,
      target_lang: "zh-CN",
      operations: [{ op: "replace", from_char: 4, to_char: 6, text: "术语" }],
      reason: "terminology",
      stability: 0.98
    });

    expect(withCommittedPartial[0].state).toBe("stable");
    expect(revised[0].state).toBe("revised");
    expect(revised[0].targetText).toBe("模型修复术语。");
  });

  it("忽略 locked 行上的晚到 partial，避免最终字幕解锁回滚", () => {
    const initialLines: CaptionLine[] = [
      {
        id: "seg_locked_partial",
        rev: 4,
        state: "locked",
        sourceText: "The final line is locked.",
        targetText: "最终字幕已锁定。",
        stability: 1,
        startMs: 0,
        endMs: 1200,
        patchCount: 0
      }
    ];

    const lines = applyRealtimeEvent(initialLines, {
      type: "translation.partial",
      session_id: "sess_demo",
      segment_id: "seg_locked_partial",
      rev: 5,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "The final line",
      target_text: "最终字幕",
      status: "stable",
      stability: 0.82,
      start_ms: 0,
      end_ms: 900
    });

    expect(lines).toEqual(initialLines);
  });

  it("忽略 realtime 控制事件，避免错误消息污染字幕列表", () => {
    const initialLines: CaptionLine[] = [
      {
        id: "seg_live",
        rev: 1,
        state: "interim",
        sourceText: "Hello",
        targetText: "你好",
        stability: 0.7,
        startMs: 0,
        endMs: 1000,
        patchCount: 0
      }
    ];

    const lines = applyRealtimeEvent(initialLines, {
      type: "realtime.error",
      session_id: "sess_demo",
      message: "Voxtral failed"
    });

    expect(lines).toEqual(initialLines);
  });

  it("优先显示最新字幕，而不是被旧的 stable 种子行卡住", () => {
    const lines: CaptionLine[] = [
      {
        id: "seg_seed",
        rev: 1,
        state: "stable",
        sourceText: "The assistant keeps subtitles above any Windows app.",
        targetText: "助手会把字幕保持在任意 Windows 应用上方。",
        stability: 0.9,
        startMs: 1900,
        endMs: 3900,
        patchCount: 0
      },
      {
        id: "seg_live",
        rev: 1,
        state: "locked",
        sourceText: "The overlay should receive live subtitle events now.",
        targetText: "[zh] The overlay should receive live subtitle events now.",
        stability: 1,
        startMs: 1800,
        endMs: 3600,
        patchCount: 0
      }
    ];

    expect(selectActiveCaptionLine(lines)?.id).toBe("seg_live");
  });

  it("最新源文草稿不借用上一句译文，避免上下两行语义错位", () => {
    const lines: CaptionLine[] = [
      {
        id: "seg_translated",
        rev: 3,
        state: "stable",
        sourceText: "The model follows the dynamic prompt.",
        targetText: "模型会遵循动态提示词。",
        stability: 0.88,
        startMs: 1000,
        endMs: 2600,
        patchCount: 0
      },
      {
        id: "seg_source_draft",
        rev: 1,
        state: "stable",
        sourceText: "then another model",
        targetText: "",
        stability: 0.72,
        startMs: 2700,
        endMs: 3300,
        patchCount: 0
      }
    ];

    const active = selectActiveCaptionLine(lines);

    expect(active?.id).toBe("seg_source_draft");
    expect(active?.sourceText).toBe("then another model");
    expect(active?.targetText).toBe("");
  });

  it("翻译字幕模式优先保留最近可用译文，避免源文草稿抢焦点后空白", () => {
    const lines: CaptionLine[] = [
      {
        id: "seg_translated",
        rev: 3,
        state: "stable",
        sourceText: "The model follows the dynamic prompt.",
        targetText: "模型会遵循动态提示词。",
        stability: 0.88,
        startMs: 1000,
        endMs: 2600,
        patchCount: 0
      },
      {
        id: "seg_source_draft",
        rev: 1,
        state: "interim",
        sourceText: "then another model",
        targetText: "",
        stability: 0.72,
        startMs: 2700,
        endMs: 3300,
        patchCount: 0
      }
    ];

    expect(selectActiveCaptionLineForDisplay(lines, "translation")?.id).toBe("seg_translated");
    expect(selectActiveCaptionLineForDisplay(lines, "bilingual")?.id).toBe("seg_source_draft");
    expect(selectActiveCaptionLineForDisplay(lines, "source")?.id).toBe("seg_source_draft");
  });

  it("按前端接收顺序选择当前字幕，而不是依赖后端音频时间戳", () => {
    const lines: CaptionLine[] = [
      {
        id: "seg_old_audio_new_event",
        rev: 1,
        state: "interim",
        sourceText: "current source hypothesis",
        targetText: "",
        stability: 0.72,
        startMs: 0,
        endMs: 800,
        receivedAtMs: 2000,
        patchCount: 0
      },
      {
        id: "seg_new_audio_old_event",
        rev: 1,
        state: "stable",
        sourceText: "older translated line",
        targetText: "较早的译文",
        stability: 0.9,
        startMs: 900,
        endMs: 1800,
        receivedAtMs: 1000,
        patchCount: 0
      }
    ];

    expect(selectActiveCaptionLine(lines)?.id).toBe("seg_old_audio_new_event");
  });

  it("默认字幕保留上一句作为滚动历史，聚焦和驻留态显示可回看的历史字幕", () => {
    const lines: CaptionLine[] = Array.from({ length: 8 }, (_, index) => ({
      id: `seg_${index + 1}`,
      rev: 1,
      state: index === 7 ? "stable" : "locked",
      sourceText: `source ${index + 1}`,
      targetText: `target ${index + 1}`,
      stability: 1,
      startMs: index * 1000,
      endMs: index * 1000 + 800,
      patchCount: 0
    }));

    expect(selectOverlayHistoryLines("default", lines, "seg_8").map((line) => line.id)).toEqual(["seg_7"]);
    expect(selectOverlayHistoryLines("controls", lines, "seg_8").map((line) => line.id)).toEqual([
      "seg_1",
      "seg_2",
      "seg_3",
      "seg_4",
      "seg_5",
      "seg_6",
      "seg_7"
    ]);
    expect(selectOverlayHistoryLines("pinned", lines, "seg_8").map((line) => line.id)).toEqual([
      "seg_1",
      "seg_2",
      "seg_3",
      "seg_4",
      "seg_5",
      "seg_6",
      "seg_7"
    ]);
  });

  it("驻留字幕保留足够历史，让有限高度窗口自然滚动", () => {
    const lines: CaptionLine[] = Array.from({ length: 28 }, (_, index) => ({
      id: `seg_${index + 1}`,
      rev: 1,
      state: index === 27 ? "stable" : "locked",
      sourceText: `source ${index + 1}`,
      targetText: `target ${index + 1}`,
      stability: 1,
      startMs: index * 1000,
      endMs: index * 1000 + 800,
      patchCount: 0
    }));

    const history = selectOverlayHistoryLines("pinned", lines, "seg_28");

    expect(history).toHaveLength(24);
    expect(history.at(0)?.id).toBe("seg_4");
    expect(history.at(-1)?.id).toBe("seg_27");
  });

  it("翻译字幕模式的历史区过滤源文草稿，避免驻留窗口出现空历史行", () => {
    const lines: CaptionLine[] = [
      {
        id: "seg_translated",
        rev: 1,
        state: "locked",
        sourceText: "translated source",
        targetText: "已有译文",
        stability: 1,
        startMs: 0,
        endMs: 1000,
        patchCount: 0
      },
      {
        id: "seg_source_only",
        rev: 1,
        state: "interim",
        sourceText: "source only draft",
        targetText: "",
        stability: 0.6,
        startMs: 1000,
        endMs: 1600,
        patchCount: 0
      },
      {
        id: "seg_active",
        rev: 1,
        state: "stable",
        sourceText: "active source",
        targetText: "当前译文",
        stability: 0.9,
        startMs: 1600,
        endMs: 2400,
        patchCount: 0
      }
    ];

    expect(selectOverlayHistoryLinesForDisplay("pinned", lines, "seg_active", "translation").map((line) => line.id)).toEqual([
      "seg_translated"
    ]);
  });

  it("只接收当前活跃会话的实时事件，停止后忽略晚到字幕", () => {
    const event = {
      type: "translation.partial" as const,
      session_id: "sess_active",
      segment_id: "seg_1",
      rev: 1,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "Hello",
      target_text: "你好",
      status: "stable" as const,
      stability: 0.82,
      start_ms: 0,
      end_ms: 1000
    };

    expect(isRealtimeEventForActiveSession("sess_active", event)).toBe(true);
    expect(isRealtimeEventForActiveSession("sess_old", event)).toBe(false);
    expect(isRealtimeEventForActiveSession(null, event)).toBe(false);
  });

  it("字幕弹窗可用主进程广播的 sessionId 接收同一会话事件", () => {
    const event = {
      type: "translation.partial" as const,
      session_id: "sess_shared",
      segment_id: "seg_1",
      rev: 1,
      source_lang: "en",
      target_lang: "zh-CN",
      source_text: "Hello",
      target_text: "你好",
      status: "stable" as const,
      stability: 0.82,
      start_ms: 0,
      end_ms: 1000
    };

    expect(isRealtimeEventForActiveSession(null, event, "sess_shared")).toBe(true);
    expect(isRealtimeEventForActiveSession(null, event, "sess_other")).toBe(false);
  });
});
