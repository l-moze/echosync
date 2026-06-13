import type { DesktopAudioSourceId } from "../../shared/audio-source-catalog";
import type { CaptionLine } from "../../shared/caption-store";
import {
  buildReviewTimeline,
  type ReviewTimeline,
  type ReviewTimelineMode,
  type TimelineRange,
  type TimelineSpan
} from "../../shared/review-timeline";
import type { SessionRecordTimeline } from "../../shared/session-records";
import { REVIEW_TIMELINE_COMPACT_GAP_MS, REVIEW_TIMELINE_THRESHOLD_MS } from "../constants/layout";

export function buildSessionRecordTimeline({
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
    sourceType: mode,
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

export function selectReviewTimelineActiveRanges(
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

export function reviewTimelineModeForSource(sourceId: DesktopAudioSourceId): ReviewTimelineMode {
  if (sourceId === "microphone" || sourceId === "mixed") {
    return "meeting";
  }
  if (sourceId === "file") {
    return "course";
  }
  return "video";
}

export function reviewTimelineFromSessionTimeline(timeline: SessionRecordTimeline | undefined): ReviewTimeline | null {
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

export function reviewDurationMsForTimeline(timeline: ReviewTimeline | null, fallbackMs: number) {
  return timeline?.reviewDurationMs ?? fallbackMs;
}
