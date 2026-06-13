import {
  selectAutoSkipTargetRawMs,
  type ReviewTimeline
} from "../../shared/review-timeline";
import {
  selectSessionRecordPlaybackSegmentId,
  type SessionRecordSegment
} from "../../shared/session-records";

export type SessionRecordPlaybackState = {
  activeSegmentId: string | null;
  playbackMs: number;
};

export type SessionRecordPlaybackUpdate = SessionRecordPlaybackState & {
  skipTargetRawMs: number | null;
};

export function selectInitialSessionRecordPlaybackState(
  segments: SessionRecordSegment[]
): SessionRecordPlaybackState {
  const firstSegment = segments[0];
  return {
    activeSegmentId: firstSegment?.id ?? null,
    playbackMs: firstSegment?.startMs ?? 0
  };
}

export function selectSessionRecordPlaybackUpdate({
  currentMs,
  durationMs,
  isPlaying,
  segments,
  timeline
}: {
  currentMs: number;
  durationMs: number;
  isPlaying: boolean;
  segments: SessionRecordSegment[];
  timeline: ReviewTimeline | null;
}): SessionRecordPlaybackUpdate {
  const skipTargetRawMs = timeline ? selectAutoSkipTargetRawMs(timeline, currentMs) : null;
  if (skipTargetRawMs !== null && isPlaying) {
    return {
      activeSegmentId: selectSessionRecordPlaybackSegmentId(segments, skipTargetRawMs),
      playbackMs: skipTargetRawMs,
      skipTargetRawMs
    };
  }

  const playbackMs = Math.min(Math.max(currentMs, 0), Math.max(durationMs, 0));
  return {
    activeSegmentId: selectSessionRecordPlaybackSegmentId(segments, playbackMs),
    playbackMs,
    skipTargetRawMs: null
  };
}
