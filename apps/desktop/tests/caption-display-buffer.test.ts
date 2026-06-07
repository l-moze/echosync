import { describe, expect, it } from "vitest";

import {
  createInitialCaptionDisplayBuffer,
  selectDisplayCaptionPresentation,
  selectDisplayCaptionLines,
  type CaptionDisplayBuffer
} from "../src/shared/caption-display-buffer";
import type { CaptionLine } from "../src/shared/caption-store";

describe("字幕显示视觉合成器", () => {
  it("保存完整 desired 文本，但 visible 文本按打字机节奏从左到右追赶", () => {
    const desired = [line({ id: "seg_1", sourceText: "Hello", targetText: "测试字幕" })];
    const initial = selectDisplayCaptionLines(createInitialCaptionDisplayBuffer(), desired, 1000);

    expect(initial.desiredLines[0].targetText).toBe("测试字幕");
    expect(initial.lines[0].targetText).toBe("测");
    expect(initial.pendingLineIds).toEqual(["seg_1"]);

    const second = selectDisplayCaptionLines(initial.buffer, desired, 1036);
    const final = selectDisplayCaptionLines(second.buffer, desired, 1144);

    expect(second.lines[0].targetText).toBe("测试");
    expect(final.lines[0].targetText).toBe("测试字幕");
    expect(final.pendingLineIds).toEqual([]);
  });

  it("原文和译文使用独立队列，译文允许慢半拍但不显示占位", () => {
    const desired = [line({ id: "seg_1", sourceText: "More machine learning", targetText: "更多机器学习组件。" })];

    const first = selectDisplayCaptionLines(createInitialCaptionDisplayBuffer(), desired, 1000);
    const second = selectDisplayCaptionLines(first.buffer, desired, 1024);

    expect(first.lines[0].sourceText).toBe("M");
    expect(first.lines[0].targetText).toBe("更");
    expect(second.lines[0].sourceText.length).toBeGreaterThan(second.lines[0].targetText.length);
    expect(second.lines[0].targetText).not.toContain("正在翻译");
    expect(second.pendingLineIds).toEqual(["seg_1"]);
  });

  it("译文队列在 24ms 高频 tick 下会累计时间，不会因为每帧重置而卡住", () => {
    const desired = [line({ id: "seg_1", sourceText: "Hello", targetText: "测试" })];

    const first = selectDisplayCaptionLines(createInitialCaptionDisplayBuffer(), desired, 1000);
    const second = selectDisplayCaptionLines(first.buffer, desired, 1024);
    const third = selectDisplayCaptionLines(second.buffer, desired, 1048);

    expect(second.lines[0].targetText).toBe("测");
    expect(third.lines[0].targetText).toBe("测试");
  });

  it("active 实时行落后很多时会追帧，不把所有旧字符排成长队慢慢播放", () => {
    const targetText = "这是一个正在高速流式返回的实时字幕片段，需要优先跟上当前视频节奏，而不是逐字偿还旧动画队列。";
    let selection = selectDisplayCaptionLines(
      createInitialCaptionDisplayBuffer(),
      [line({ id: "seg_live", sourceText: "Streaming subtitle backlog test", targetText })],
      1000
    );

    expect(selection.lines[0].targetText).toBe("这");

    for (let tick = 1; tick <= 8; tick += 1) {
      selection = selectDisplayCaptionLines(
        selection.buffer,
        [line({ id: "seg_live", sourceText: "Streaming subtitle backlog test", targetText })],
        1000 + tick * 24
      );
    }

    expect(selection.lines[0].targetText.length).toBeGreaterThan(24);
    expect(selection.displayLag.max).toBeLessThanOrEqual(24);
  });

  it("同一 segment 修订时保留公共前缀，只让新尾部进入可见队列", () => {
    const buffer: CaptionDisplayBuffer = {
      entries: {
        seg_1: {
          phase: "active",
          source: {
            desiredText: "I am testing",
            visibleText: "I am testing",
            lastTypedAtMs: 1000,
            revisedUntilMs: null
          },
          target: {
            desiredText: "我正在册",
            visibleText: "我正在册",
            lastTypedAtMs: 1000,
            revisedUntilMs: null
          },
          firstSeenAtMs: 1000,
          lastVisibleAtMs: 1000,
          settledAtMs: null
        }
      }
    };

    const patched = selectDisplayCaptionLines(
      buffer,
      [line({ id: "seg_1", sourceText: "I am testing", targetText: "我正在测试", rev: 2, state: "revised" })],
      1040
    );

    expect(patched.lines[0].targetText).toBe("我正在测");
    expect(patched.buffer.entries.seg_1.target.desiredText).toBe("我正在测试");
    expect(patched.buffer.entries.seg_1.target.revisedUntilMs).toBe(3040);

    const final = selectDisplayCaptionLines(patched.buffer, [line({ id: "seg_1", targetText: "我正在测试", rev: 2 })], 1080);

    expect(final.lines[0].targetText).toBe("我正在测试");
  });

  it("locked 行先进入 readable dwell，不直接瞬移成最终文本", () => {
    const partial = selectDisplayCaptionLines(
      createInitialCaptionDisplayBuffer(),
      [line({ id: "seg_1", sourceText: "Final", targetText: "最终", state: "stable" })],
      1000
    );

    const committed = selectDisplayCaptionLines(
      partial.buffer,
      [line({ id: "seg_1", sourceText: "Final line.", targetText: "最终字幕。", state: "locked" })],
      1020
    );

    expect(committed.lines[0].sourceText).not.toBe("Final line.");
    expect(committed.lines[0].targetText).not.toBe("最终字幕。");
    expect(committed.buffer.entries.seg_1.source.desiredText).toBe("Final line.");
    expect(committed.buffer.entries.seg_1.target.desiredText).toBe("最终字幕。");
    expect(committed.buffer.entries.seg_1.phase).toBe("readable");
    expect(committed.buffer.entries.seg_1.settledAtMs).toBe(1020);
  });

  it("locked 短句至少驻留一段可读时间，避免还没看完就进入历史", () => {
    const committed = selectDisplayCaptionLines(
      createInitialCaptionDisplayBuffer(),
      [line({ id: "seg_short", sourceText: "Yes.", targetText: "是的。", state: "locked" })],
      1000
    );

    const tooSoon = selectDisplayCaptionLines(
      committed.buffer,
      [line({ id: "seg_short", sourceText: "Yes.", targetText: "是的。", state: "locked" })],
      3300
    );
    const presentationTooSoon = selectDisplayCaptionPresentation(tooSoon, "sentencePair");

    expect(tooSoon.buffer.entries.seg_short.phase).toBe("readable");
    expect(presentationTooSoon.activeLine?.id).toBe("seg_short");
    expect(presentationTooSoon.historyLines).toEqual([]);

    const afterDwell = selectDisplayCaptionLines(
      tooSoon.buffer,
      [line({ id: "seg_short", sourceText: "Yes.", targetText: "是的。", state: "locked" })],
      4700
    );
    const presentationAfterDwell = selectDisplayCaptionPresentation(afterDwell, "sentencePair");

    expect(afterDwell.buffer.entries.seg_short.phase).toBe("past");
    expect(presentationAfterDwell.activeLine).toBeUndefined();
    expect(presentationAfterDwell.historyLines.map((historyLine) => historyLine.id)).toEqual(["seg_short"]);
  });

  it("当前源文新段到达时，刚 commit 的上一句仍作为主字幕驻留，不被新片段立即抢走", () => {
    const committed = selectDisplayCaptionLines(
      createInitialCaptionDisplayBuffer(),
      [
        line({ id: "seg_prev", sourceText: "The previous sentence.", targetText: "上一句。", state: "locked" }),
        line({ id: "seg_next", sourceText: "And", targetText: "", state: "interim" })
      ],
      1000
    );
    const presentation = selectDisplayCaptionPresentation(committed, "sentencePair");

    expect(presentation.activeLine?.id).toBe("seg_prev");
    expect(presentation.settlingLines.map((settlingLine) => settlingLine.id)).toEqual(["seg_prev"]);
    expect(presentation.historyLines).toEqual([]);
  });

  it("上一句驻留超过前台保护时间后，新 active 行接管主字幕，避免旧 readable 行阻塞实时输出", () => {
    const committed = selectDisplayCaptionLines(
      createInitialCaptionDisplayBuffer(),
      [
        line({ id: "seg_prev", sourceText: "The previous sentence.", targetText: "上一句。", state: "locked" }),
        line({ id: "seg_next", sourceText: "And now", targetText: "", state: "interim" })
      ],
      1000
    );
    const later = selectDisplayCaptionLines(
      committed.buffer,
      [
        line({ id: "seg_prev", sourceText: "The previous sentence.", targetText: "上一句。", state: "locked" }),
        line({ id: "seg_next", sourceText: "And now we continue.", targetText: "", state: "interim" })
      ],
      2600
    );
    const presentation = selectDisplayCaptionPresentation(later, "sentencePair");

    expect(presentation.activeLine?.id).toBe("seg_next");
    expect(presentation.settlingLines.map((settlingLine) => settlingLine.id)).toEqual(["seg_prev"]);
  });

  it("多个 readable 行同时存在时，只让最近刚提交的句子短暂占主字幕位", () => {
    const first = selectDisplayCaptionLines(
      createInitialCaptionDisplayBuffer(),
      [
        line({ id: "seg_old", sourceText: "Old sentence.", targetText: "较早的一句。", state: "locked" }),
        line({ id: "seg_recent", sourceText: "Recent sentence.", targetText: "刚提交的一句。", state: "locked" }),
        line({ id: "seg_live", sourceText: "Live", targetText: "", state: "interim" })
      ],
      1000
    );
    const later = selectDisplayCaptionLines(
      first.buffer,
      [
        line({ id: "seg_old", sourceText: "Old sentence.", targetText: "较早的一句。", state: "locked" }),
        line({ id: "seg_recent", sourceText: "Recent sentence.", targetText: "刚提交的一句。", state: "locked" }),
        line({ id: "seg_live", sourceText: "Live text is arriving.", targetText: "", state: "interim" })
      ],
      2100
    );
    const presentation = selectDisplayCaptionPresentation(later, "sentencePair");

    expect(presentation.activeLine?.id).toBe("seg_recent");
  });

  it("长双语字幕会按内容长度延长驻留时间，避免读到一半就上滚", () => {
    const longSource = "This is a dense technical sentence about asynchronous translation queues and rendering buffers.";
    const longTarget = "这是一句信息密度较高的技术字幕，正在解释异步翻译队列和渲染缓冲。";
    const committed = selectDisplayCaptionLines(
      createInitialCaptionDisplayBuffer(),
      [line({ id: "seg_long", sourceText: longSource, targetText: longTarget, state: "locked" })],
      1000
    );

    const stillReadable = selectDisplayCaptionLines(
      committed.buffer,
      [line({ id: "seg_long", sourceText: longSource, targetText: longTarget, state: "locked" })],
      7600
    );
    const presentation = selectDisplayCaptionPresentation(stillReadable, "sentencePair");

    expect(stillReadable.buffer.entries.seg_long.phase).toBe("readable");
    expect(presentation.activeLine?.id).toBe("seg_long");
    expect(presentation.historyLines).toEqual([]);
  });

  it("desired 文本短暂回退为已有可见前缀时，可见文本不截短回跳", () => {
    const buffer: CaptionDisplayBuffer = {
      entries: {
        seg_restart: {
          phase: "active",
          source: {
            desiredText: "This is a long source sentence",
            visibleText: "This is a long source sentence",
            lastTypedAtMs: 1000,
            revisedUntilMs: null
          },
          target: {
            desiredText: "这是一个完整的可读译文",
            visibleText: "这是一个完整的可读译文",
            lastTypedAtMs: 1000,
            revisedUntilMs: null
          },
          firstSeenAtMs: 1000,
          lastVisibleAtMs: 1000,
          settledAtMs: null
        }
      }
    };

    const restarted = selectDisplayCaptionLines(
      buffer,
      [line({ id: "seg_restart", sourceText: "This is a long source sentence", targetText: "这是", rev: 2 })],
      1040
    );

    expect(restarted.lines[0].targetText).toBe("这是一个完整的可读译文");
    expect(restarted.buffer.entries.seg_restart.target.desiredText).toBe("这是一个完整的可读译文");
  });
});

function line(patch: Partial<CaptionLine>): CaptionLine {
  return {
    id: "seg",
    rev: 1,
    state: "stable",
    sourceText: "Hello",
    targetText: "",
    stability: 0.8,
    startMs: 0,
    endMs: 1000,
    patchCount: 0,
    ...patch
  };
}
