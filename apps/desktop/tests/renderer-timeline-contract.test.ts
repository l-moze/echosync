import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const rendererSource = readFileSync(resolve(__dirname, "../src/renderer/main.tsx"), "utf8");

function sourceAround(marker: string, before = 700, after = 700) {
  const index = rendererSource.indexOf(marker);
  expect(index).toBeGreaterThanOrEqual(0);
  return rendererSource.slice(Math.max(0, index - before), index + marker.length + after);
}

describe("复盘时间线契约", () => {
  it("记录详情页必须包含三项时长指标：复盘时长、原始录制、有效内容", () => {
    const statsSource = sourceAround("<div className=\"timeline-stats\">", 0, 600);

    expect(statsSource).toContain("复盘时长:");
    expect(statsSource).toContain("formatDurationForRecord(selectedRecord.timeline.reviewDurationMs)");
    expect(statsSource).toContain("原始录制:");
    expect(statsSource).toContain("formatDurationForRecord(selectedRecord.timeline.rawDurationMs)");
    expect(statsSource).toContain("有效内容:");
    expect(statsSource).toContain("formatDurationForRecord(selectedRecord.timeline.contentDurationMs)");
  });

  it("记录详情页有 timeline 时必须渲染分段时间线轨道", () => {
    const playerSource = sourceAround("function SessionRecordsWindow", 0, 34000);
    const railSource = sourceAround("<ReviewTimelineRail", 0, 600);

    expect(playerSource).toContain("ReviewTimelineRail");
    expect(playerSource).toContain("useReviewPlaybackTimeline");
    expect(playerSource).toContain("recordTimelinePlayback.displayTimeline");
    expect(railSource).toContain("<ReviewTimelineRail");
    expect(railSource).toContain("ariaLabel=\"音频回放进度\"");
    expect(railSource).toContain("onChange={recordTimelinePlayback.scrubToReview}");
    expect(railSource).toContain("reviewDurationMs={reviewDurationMs}");
  });

  it("记录详情页必须包含压缩/原始模式切换控件", () => {
    const controlSource = sourceAround("toggleCompressionMode", 500, 800);

    expect(controlSource).toContain("recordTimelinePlayback.toggleCompressionMode");
    expect(controlSource).toContain("recordTimelinePlayback.compressionEnabled");
    expect(controlSource).toContain("压缩长静音");
    expect(controlSource).toContain("保留原始停顿");
    expect(controlSource).toContain("<button onClick={recordTimelinePlayback.toggleCompressionMode}");
    expect(controlSource).toContain("selectedReviewTimeline && selectedReviewTimeline.spans.length > 0");
  });

  it("复盘时长在元数据网格中展示", () => {
    const metadataSource = sourceAround("<section className=\"recordMetadataGrid compact\">", 0, 800);

    expect(metadataSource).toContain("<span>复盘时长</span>");
    expect(metadataSource).toContain("<strong>{formatDurationForRecord(reviewDurationMs)}</strong>");
  });

  it("SRT 导出说明必须包含原始时间戳语义", () => {
    expect(rendererSource).toContain("setExportFormat");
    expect(rendererSource).toContain("sessionRecordExportFormatLabel(option)");
    expect(rendererSource).toContain("SRT 使用原始录制时间");
  });

  it("记录详情页使用 useReviewPlaybackTimeline hook 处理时间线播放", () => {
    const windowSource = sourceAround("function SessionRecordsWindow", 0, 34000);

    expect(windowSource).toContain("const recordTimelinePlayback = useReviewPlaybackTimeline({");
    expect(windowSource).toContain("timeline: selectedReviewTimeline,");
    expect(windowSource).toContain("rawMs: playbackMs,");
    expect(windowSource).toContain("rawDurationMs: selectedRecord?.durationMs ?? 0");
  });

  it("记录详情页从 SessionRecord.timeline 生成 ReviewTimeline", () => {
    const windowSource = sourceAround("function SessionRecordsWindow", 0, 34000);

    expect(windowSource).toContain("reviewTimelineFromSessionTimeline(selectedRecord?.timeline)");
    expect(windowSource).toContain("const selectedReviewTimeline");
  });

  it("时间线压缩自动跳过使用 selectAutoSkipTargetRawMs 和 selectReviewPlaybackMs", () => {
    const updateRecordSource = sourceAround("function updateRecordPlayback", 0, 1800);

    expect(updateRecordSource).toContain("recordTimelinePlayback.displayTimeline");
    expect(updateRecordSource).toContain("selectAutoSkipTargetRawMs(recordTimelinePlayback.displayTimeline, currentMs)");
    expect(updateRecordSource).toContain("const skipTargetRawMs = recordTimelinePlayback.displayTimeline");
    expect(rendererSource).toContain("selectReviewPlaybackMs");
  });

  it("时间线双向映射使用 rawToReviewMs 和 reviewToRawMs", () => {
    const helperSource = sourceAround("function reviewToRawRecordMs", 0, 600);

    expect(helperSource).toContain("reviewToRawMs(recordTimelinePlayback.displayTimeline, nextReviewMs)");
    expect(rendererSource).toContain("import {");
    expect(rendererSource).toContain("reviewToRawMs");
    expect(rendererSource).toContain("selectAutoSkipTargetRawMs");
    expect(rendererSource).toContain("selectReviewPlaybackMs");
  });
});
