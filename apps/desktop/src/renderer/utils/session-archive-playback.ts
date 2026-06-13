import {
  selectAutoSkipTargetRawMs,
  type ReviewTimeline
} from "../../shared/review-timeline";

export type SessionArchivePlaybackUpdate = {
  playbackMs: number;
  skipTargetRawMs: number | null;
};

export function selectSessionArchivePlaybackUpdate({
  currentMs,
  durationMs,
  isPlaying,
  timeline
}: {
  currentMs: number;
  durationMs: number;
  isPlaying: boolean;
  timeline: ReviewTimeline | null;
}): SessionArchivePlaybackUpdate {
  const skipTargetRawMs = timeline ? selectAutoSkipTargetRawMs(timeline, currentMs) : null;
  if (skipTargetRawMs !== null && isPlaying) {
    return {
      playbackMs: skipTargetRawMs,
      skipTargetRawMs
    };
  }

  return {
    playbackMs: Math.min(Math.max(currentMs, 0), Math.max(durationMs, 0)),
    skipTargetRawMs: null
  };
}
