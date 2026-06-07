export type ReviewTimelineMode = "video" | "course" | "meeting";

export type TimelineSpan =
  | {
      type: "active_audio";
      rawStartMs: number;
      rawEndMs: number;
      reviewStartMs: number;
      reviewEndMs: number;
    }
  | {
      type: "long_silence";
      rawStartMs: number;
      rawEndMs: number;
      reviewStartMs: number;
      reviewEndMs: number;
      compactMs: number;
    };

export type TimelineRange = {
  rawStartMs: number;
  rawEndMs: number;
};

export type BuildReviewTimelineInput = {
  rawDurationMs: number;
  activeRanges: TimelineRange[];
  mode: ReviewTimelineMode;
  compressLongSilence?: boolean;
  thresholdMs?: number;
  compactGapMs?: number;
};

export type ReviewTimeline = {
  spans: TimelineSpan[];
  rawDurationMs: number;
  contentDurationMs: number;
  reviewDurationMs: number;
};

export type SkippedSilenceMarker = {
  rawStartMs: number;
  rawEndMs: number;
  skippedMs: number;
};

const DEFAULT_THRESHOLD_MS = 2500;
const DEFAULT_COMPACT_GAP_MS = 500;

export function buildReviewTimeline(input: BuildReviewTimelineInput): ReviewTimeline {
  const rawDurationMs = Math.max(0, input.rawDurationMs);
  const thresholdMs = Math.max(0, input.thresholdMs ?? DEFAULT_THRESHOLD_MS);
  const compactGapMs = Math.max(0, input.compactGapMs ?? DEFAULT_COMPACT_GAP_MS);
  const shouldCompress = input.compressLongSilence ?? input.mode !== "meeting";
  const activeRanges = normalizeRanges(input.activeRanges, rawDurationMs);
  const contentDurationMs = activeRanges.reduce((total, range) => total + durationOf(range), 0);

  if (activeRanges.length === 0) {
    const reviewDurationMs = shouldCompress && rawDurationMs >= thresholdMs ? Math.min(compactGapMs, rawDurationMs) : rawDurationMs;
    return {
      spans:
        rawDurationMs > 0
          ? [
              {
                type: "long_silence",
                rawStartMs: 0,
                rawEndMs: rawDurationMs,
                reviewStartMs: 0,
                reviewEndMs: reviewDurationMs,
                compactMs: reviewDurationMs
              }
            ]
          : [],
      rawDurationMs,
      contentDurationMs,
      reviewDurationMs
    };
  }

  const spans: TimelineSpan[] = [];
  let reviewCursorMs = 0;
  let activeSpanStartMs = 0;
  let cursorMs = 0;

  for (const range of activeRanges) {
    const gapMs = range.rawStartMs - cursorMs;
    if (gapMs >= thresholdMs) {
      reviewCursorMs = pushActiveSpan(spans, activeSpanStartMs, cursorMs, reviewCursorMs);
      reviewCursorMs = pushLongSilenceSpan(spans, cursorMs, range.rawStartMs, reviewCursorMs, shouldCompress, compactGapMs);
      activeSpanStartMs = range.rawStartMs;
    }
    cursorMs = Math.max(cursorMs, range.rawEndMs);
  }

  const trailingGapMs = rawDurationMs - cursorMs;
  if (trailingGapMs >= thresholdMs) {
    reviewCursorMs = pushActiveSpan(spans, activeSpanStartMs, cursorMs, reviewCursorMs);
    reviewCursorMs = pushLongSilenceSpan(spans, cursorMs, rawDurationMs, reviewCursorMs, shouldCompress, compactGapMs);
  } else {
    reviewCursorMs = pushActiveSpan(spans, activeSpanStartMs, rawDurationMs, reviewCursorMs);
  }

  return {
    spans,
    rawDurationMs,
    contentDurationMs,
    reviewDurationMs: reviewCursorMs
  };
}

export function rawToReviewMs(timeline: ReviewTimeline, rawMs: number): number {
  const clampedRawMs = clamp(rawMs, 0, timeline.rawDurationMs);
  const span = findSpanByRawMs(timeline.spans, clampedRawMs);
  if (!span) {
    return clamp(clampedRawMs, 0, timeline.reviewDurationMs);
  }

  return Math.round(mapBetweenSpans(clampedRawMs, span.rawStartMs, span.rawEndMs, span.reviewStartMs, span.reviewEndMs));
}

export function reviewToRawMs(timeline: ReviewTimeline, reviewMs: number): number {
  const clampedReviewMs = clamp(reviewMs, 0, timeline.reviewDurationMs);
  const span = findSpanByReviewMs(timeline.spans, clampedReviewMs);
  if (!span) {
    return clamp(clampedReviewMs, 0, timeline.rawDurationMs);
  }

  return Math.round(mapBetweenSpans(clampedReviewMs, span.reviewStartMs, span.reviewEndMs, span.rawStartMs, span.rawEndMs));
}

export function selectSkippedSilenceMarker(timeline: ReviewTimeline, reviewMs: number): SkippedSilenceMarker | null {
  const span = findSpanByReviewMs(timeline.spans, clamp(reviewMs, 0, timeline.reviewDurationMs));
  if (!span || span.type !== "long_silence") {
    return null;
  }
  const skippedMs = durationOf(span) - span.compactMs;
  if (skippedMs <= 0) {
    return null;
  }

  return {
    rawStartMs: span.rawStartMs,
    rawEndMs: span.rawEndMs,
    skippedMs
  };
}

export function selectReviewPlaybackMs(timeline: ReviewTimeline, rawMs: number): number {
  const clampedRawMs = clamp(rawMs, 0, timeline.rawDurationMs);
  const span = findSpanByRawMs(timeline.spans, clampedRawMs);
  if (!span || span.type !== "long_silence") {
    return rawToReviewMs(timeline, clampedRawMs);
  }

  const visibleSilenceMs = clamp(clampedRawMs - span.rawStartMs, 0, span.compactMs);
  return Math.round(span.reviewStartMs + visibleSilenceMs);
}

export function selectAutoSkipTargetRawMs(timeline: ReviewTimeline, rawMs: number): number | null {
  const span = selectCompressedSilenceSpanByRawMs(timeline, rawMs);
  if (!span || rawMs >= span.rawEndMs) {
    return null;
  }
  if (rawMs - span.rawStartMs < span.compactMs) {
    return null;
  }
  return span.rawEndMs;
}

export function selectCompressedSilenceSpanByRawMs(
  timeline: ReviewTimeline,
  rawMs: number
): Extract<TimelineSpan, { type: "long_silence" }> | null {
  const clampedRawMs = clamp(rawMs, 0, timeline.rawDurationMs);
  const span = findSpanByRawMs(timeline.spans, clampedRawMs);
  if (!span || span.type !== "long_silence") {
    return null;
  }
  if (span.compactMs >= span.rawEndMs - span.rawStartMs) {
    return null;
  }
  return span;
}

function normalizeRanges(ranges: TimelineRange[], rawDurationMs: number): TimelineRange[] {
  const sortedRanges = ranges
    .map((range) => ({
      rawStartMs: clamp(range.rawStartMs, 0, rawDurationMs),
      rawEndMs: clamp(range.rawEndMs, 0, rawDurationMs)
    }))
    .filter((range) => range.rawEndMs > range.rawStartMs)
    .sort((a, b) => a.rawStartMs - b.rawStartMs || a.rawEndMs - b.rawEndMs);

  const normalizedRanges: TimelineRange[] = [];
  for (const range of sortedRanges) {
    const previous = normalizedRanges.at(-1);
    if (!previous || range.rawStartMs > previous.rawEndMs) {
      normalizedRanges.push({ ...range });
      continue;
    }
    previous.rawEndMs = Math.max(previous.rawEndMs, range.rawEndMs);
  }
  return normalizedRanges;
}

function pushActiveSpan(spans: TimelineSpan[], rawStartMs: number, rawEndMs: number, reviewStartMs: number): number {
  if (rawEndMs <= rawStartMs) {
    return reviewStartMs;
  }

  const reviewEndMs = reviewStartMs + rawEndMs - rawStartMs;
  spans.push({
    type: "active_audio",
    rawStartMs,
    rawEndMs,
    reviewStartMs,
    reviewEndMs
  });
  return reviewEndMs;
}

function pushLongSilenceSpan(
  spans: TimelineSpan[],
  rawStartMs: number,
  rawEndMs: number,
  reviewStartMs: number,
  shouldCompress: boolean,
  compactGapMs: number
): number {
  if (rawEndMs <= rawStartMs) {
    return reviewStartMs;
  }

  const rawDurationMs = rawEndMs - rawStartMs;
  const compactMs = shouldCompress ? Math.min(compactGapMs, rawDurationMs) : rawDurationMs;
  const reviewEndMs = reviewStartMs + compactMs;
  spans.push({
    type: "long_silence",
    rawStartMs,
    rawEndMs,
    reviewStartMs,
    reviewEndMs,
    compactMs
  });
  return reviewEndMs;
}

function findSpanByRawMs(spans: TimelineSpan[], rawMs: number): TimelineSpan | undefined {
  return spans.find((span, index) => {
    const isLast = index === spans.length - 1;
    return rawMs >= span.rawStartMs && (rawMs < span.rawEndMs || (isLast && rawMs === span.rawEndMs));
  });
}

function findSpanByReviewMs(spans: TimelineSpan[], reviewMs: number): TimelineSpan | undefined {
  return spans.find((span, index) => {
    const isLast = index === spans.length - 1;
    return reviewMs >= span.reviewStartMs && (reviewMs < span.reviewEndMs || (isLast && reviewMs === span.reviewEndMs));
  });
}

function mapBetweenSpans(value: number, fromStart: number, fromEnd: number, toStart: number, toEnd: number): number {
  const fromDuration = fromEnd - fromStart;
  if (fromDuration <= 0) {
    return toStart;
  }

  return toStart + ((value - fromStart) / fromDuration) * (toEnd - toStart);
}

function durationOf(range: { rawStartMs: number; rawEndMs: number }): number {
  return range.rawEndMs - range.rawStartMs;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
