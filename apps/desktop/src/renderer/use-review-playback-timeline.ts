import { useCallback, useMemo, useState } from "react";
import type { ReviewTimeline, TimelineSpan } from "../shared/review-timeline";
import {
  reviewToRawMs,
  selectReviewPlaybackMs,
  selectSkippedSilenceMarker
} from "../shared/review-timeline";

export type UseReviewPlaybackTimelineOptions = {
  timeline: ReviewTimeline | null;
  rawMs: number;
  rawDurationMs: number;
  onSeek: (rawMs: number) => void;
};

export type ReviewPlaybackTimelineState = {
  reviewMs: number;
  reviewDurationMs: number;
  isInSilence: boolean;
  skippedMs: number;
  compressionEnabled: boolean;
  displayTimeline: ReviewTimeline | null;
  scrubToReview: (reviewMs: number) => void;
  toggleCompressionMode: () => void;
};

export function useReviewPlaybackTimeline({
  timeline,
  rawMs,
  rawDurationMs,
  onSeek
}: UseReviewPlaybackTimelineOptions): ReviewPlaybackTimelineState {
  const [compressionEnabled, setCompressionEnabled] = useState(true);

  const displayTimeline = useMemo(() => {
    if (!timeline || timeline.spans.length === 0) {
      return null;
    }
    if (compressionEnabled) {
      return timeline;
    }
    return buildUncompressedDisplayTimeline(timeline);
  }, [compressionEnabled, timeline]);

  const reviewDurationMs = displayTimeline?.reviewDurationMs ?? rawDurationMs;
  const reviewMs = displayTimeline ? selectReviewPlaybackMs(displayTimeline, rawMs) : rawMs;
  const skippedMarker = displayTimeline ? selectSkippedSilenceMarker(displayTimeline, reviewMs) : null;
  const isInSilence = skippedMarker !== null;
  const skippedMs = skippedMarker?.skippedMs ?? 0;

  const scrubToReview = useCallback(
    (nextReviewMs: number) => {
      onSeek(displayTimeline ? reviewToRawMs(displayTimeline, nextReviewMs) : nextReviewMs);
    },
    [displayTimeline, onSeek]
  );

  const toggleCompressionMode = useCallback(() => {
    setCompressionEnabled((enabled) => !enabled);
  }, []);

  return {
    reviewMs,
    reviewDurationMs,
    isInSilence,
    skippedMs,
    compressionEnabled,
    displayTimeline,
    scrubToReview,
    toggleCompressionMode
  };
}

function buildUncompressedDisplayTimeline(timeline: ReviewTimeline): ReviewTimeline {
  return {
    contentDurationMs: timeline.contentDurationMs,
    rawDurationMs: timeline.rawDurationMs,
    reviewDurationMs: timeline.rawDurationMs,
    spans: timeline.spans.map((span): TimelineSpan => {
      const base = {
        rawEndMs: span.rawEndMs,
        rawStartMs: span.rawStartMs,
        reviewEndMs: span.rawEndMs,
        reviewStartMs: span.rawStartMs
      };
      if (span.type === "long_silence") {
        return {
          ...base,
          compactMs: span.rawEndMs - span.rawStartMs,
          type: "long_silence"
        };
      }
      return {
        ...base,
        type: "active_audio"
      };
    })
  };
}
