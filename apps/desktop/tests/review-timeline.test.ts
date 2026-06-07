import { describe, expect, it } from "vitest";

import {
  buildReviewTimeline,
  rawToReviewMs,
  reviewToRawMs,
  selectAutoSkipTargetRawMs,
  selectCompressedSilenceSpanByRawMs,
  selectReviewPlaybackMs,
  selectSkippedSilenceMarker
} from "../src/shared/review-timeline";

describe("复盘播放器三条时间线", () => {
  it("视频模式把两个有效片段之间的长静音压缩到 compactGapMs", () => {
    const timeline = buildReviewTimeline({
      rawDurationMs: 12000,
      activeRanges: [
        { rawStartMs: 0, rawEndMs: 2000 },
        { rawStartMs: 7000, rawEndMs: 10000 }
      ],
      mode: "video",
      thresholdMs: 2500,
      compactGapMs: 400
    });

    expect(timeline.rawDurationMs).toBe(12000);
    expect(timeline.contentDurationMs).toBe(5000);
    expect(timeline.reviewDurationMs).toBe(7400);
    expect(timeline.spans).toEqual([
      { type: "active_audio", rawStartMs: 0, rawEndMs: 2000, reviewStartMs: 0, reviewEndMs: 2000 },
      { type: "long_silence", rawStartMs: 2000, rawEndMs: 7000, reviewStartMs: 2000, reviewEndMs: 2400, compactMs: 400 },
      { type: "active_audio", rawStartMs: 7000, rawEndMs: 12000, reviewStartMs: 2400, reviewEndMs: 7400 }
    ]);
  });

  it("会议模式默认保留完整时间线", () => {
    const timeline = buildReviewTimeline({
      rawDurationMs: 10000,
      activeRanges: [
        { rawStartMs: 0, rawEndMs: 1000 },
        { rawStartMs: 6000, rawEndMs: 8000 }
      ],
      mode: "meeting"
    });

    expect(timeline.contentDurationMs).toBe(3000);
    expect(timeline.reviewDurationMs).toBe(10000);
    expect(timeline.spans.map((span) => span.type)).toEqual(["active_audio", "long_silence", "active_audio"]);
    expect(timeline.spans.filter((span) => span.type === "long_silence")).toEqual([
      { type: "long_silence", rawStartMs: 1000, rawEndMs: 6000, reviewStartMs: 1000, reviewEndMs: 6000, compactMs: 5000 }
    ]);
  });

  it("active segment 内双向映射精确单调，compact gap 内稳定映射到原始静音范围", () => {
    const timeline = buildReviewTimeline({
      rawDurationMs: 10000,
      activeRanges: [
        { rawStartMs: 0, rawEndMs: 2000 },
        { rawStartMs: 7000, rawEndMs: 9000 }
      ],
      mode: "course",
      thresholdMs: 2500,
      compactGapMs: 500
    });

    expect(rawToReviewMs(timeline, 500)).toBe(500);
    expect(rawToReviewMs(timeline, 7500)).toBe(3000);
    expect(reviewToRawMs(timeline, 500)).toBe(500);
    expect(reviewToRawMs(timeline, 3000)).toBe(7500);

    const gapStartRaw = reviewToRawMs(timeline, 2000);
    const gapMiddleRaw = reviewToRawMs(timeline, 2250);
    const gapEndRaw = reviewToRawMs(timeline, 2500);

    expect(gapStartRaw).toBe(2000);
    expect(gapMiddleRaw).toBe(4500);
    expect(gapEndRaw).toBe(7000);
    expect([2000, 3000, 5000, 6999].map((rawMs) => rawToReviewMs(timeline, rawMs))).toEqual([2000, 2100, 2300, 2500]);
  });

  it("低于 threshold 的短静音不生成 long_silence", () => {
    const timeline = buildReviewTimeline({
      rawDurationMs: 5000,
      activeRanges: [
        { rawStartMs: 0, rawEndMs: 2000 },
        { rawStartMs: 3000, rawEndMs: 5000 }
      ],
      mode: "video",
      thresholdMs: 2500,
      compactGapMs: 400
    });

    expect(timeline.contentDurationMs).toBe(4000);
    expect(timeline.reviewDurationMs).toBe(5000);
    expect(timeline.spans).toEqual([
      { type: "active_audio", rawStartMs: 0, rawEndMs: 5000, reviewStartMs: 0, reviewEndMs: 5000 }
    ]);
  });

  it("没有 active ranges 时不崩溃并给出合理时间值", () => {
    const timeline = buildReviewTimeline({
      rawDurationMs: 8000,
      activeRanges: [],
      mode: "video",
      thresholdMs: 2500,
      compactGapMs: 500
    });

    expect(timeline.rawDurationMs).toBe(8000);
    expect(timeline.contentDurationMs).toBe(0);
    expect(timeline.reviewDurationMs).toBe(500);
    expect(timeline.spans).toEqual([
      { type: "long_silence", rawStartMs: 0, rawEndMs: 8000, reviewStartMs: 0, reviewEndMs: 500, compactMs: 500 }
    ]);
    expect(rawToReviewMs(timeline, 4000)).toBe(250);
    expect(reviewToRawMs(timeline, 250)).toBe(4000);
  });

  it("能选择当前压缩间隙对应的已跳过静音提示", () => {
    const timeline = buildReviewTimeline({
      rawDurationMs: 10000,
      activeRanges: [
        { rawStartMs: 0, rawEndMs: 2000 },
        { rawStartMs: 7000, rawEndMs: 10000 }
      ],
      mode: "video",
      thresholdMs: 2500,
      compactGapMs: 500
    });

    expect(selectSkippedSilenceMarker(timeline, 2250)).toEqual({
      rawStartMs: 2000,
      rawEndMs: 7000,
      skippedMs: 4500
    });
    expect(selectSkippedSilenceMarker(timeline, 1000)).toBeNull();
  });

  it("未压缩的会议静音不显示已跳过提示", () => {
    const timeline = buildReviewTimeline({
      rawDurationMs: 10000,
      activeRanges: [
        { rawStartMs: 0, rawEndMs: 1000 },
        { rawStartMs: 6000, rawEndMs: 8000 }
      ],
      mode: "meeting"
    });

    expect(selectSkippedSilenceMarker(timeline, 3000)).toBeNull();
  });

  it("能按原始播放时间识别应该自动跳过的压缩静音段", () => {
    const timeline = buildReviewTimeline({
      rawDurationMs: 10000,
      activeRanges: [
        { rawStartMs: 0, rawEndMs: 2000 },
        { rawStartMs: 7000, rawEndMs: 10000 }
      ],
      mode: "video",
      thresholdMs: 2500,
      compactGapMs: 500
    });

    expect(selectCompressedSilenceSpanByRawMs(timeline, 3500)).toMatchObject({
      rawStartMs: 2000,
      rawEndMs: 7000,
      type: "long_silence"
    });
    expect(selectCompressedSilenceSpanByRawMs(timeline, 1000)).toBeNull();
    expect(selectCompressedSilenceSpanByRawMs(timeline, 7200)).toBeNull();
  });

  it("自动跳过长静音前先保留 compact gap 的播放时间", () => {
    const timeline = buildReviewTimeline({
      rawDurationMs: 10000,
      activeRanges: [
        { rawStartMs: 0, rawEndMs: 2000 },
        { rawStartMs: 7000, rawEndMs: 10000 }
      ],
      mode: "video",
      thresholdMs: 2500,
      compactGapMs: 500
    });

    expect(selectAutoSkipTargetRawMs(timeline, 1999)).toBeNull();
    expect(selectAutoSkipTargetRawMs(timeline, 2000)).toBeNull();
    expect(selectAutoSkipTargetRawMs(timeline, 2499)).toBeNull();
    expect(selectAutoSkipTargetRawMs(timeline, 2500)).toBe(7000);
    expect(selectAutoSkipTargetRawMs(timeline, 3500)).toBe(7000);
    expect(selectAutoSkipTargetRawMs(timeline, 7200)).toBeNull();

    expect(selectReviewPlaybackMs(timeline, 2000)).toBe(2000);
    expect(selectReviewPlaybackMs(timeline, 2250)).toBe(2250);
    expect(selectReviewPlaybackMs(timeline, 2500)).toBe(2500);
    expect(selectReviewPlaybackMs(timeline, 3500)).toBe(2500);
    expect(selectReviewPlaybackMs(timeline, 7000)).toBe(2500);
  });
});
