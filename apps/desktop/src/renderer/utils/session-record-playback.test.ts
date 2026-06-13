import { describe, expect, it } from "vitest";

import type { ReviewTimeline } from "../../shared/review-timeline";
import type { SessionRecordSegment } from "../../shared/session-records";
import {
  selectInitialSessionRecordPlaybackState,
  selectSessionRecordPlaybackUpdate
} from "./session-record-playback";

const segments: SessionRecordSegment[] = [
  {
    id: "seg-1",
    startMs: 0,
    endMs: 1000,
    sourceText: "hello",
    targetText: "你好",
    revisionState: "final",
    patchCount: 0
  },
  {
    id: "seg-2",
    startMs: 5000,
    endMs: 7000,
    sourceText: "world",
    targetText: "世界",
    revisionState: "final",
    patchCount: 0
  }
];

const compressedTimeline: ReviewTimeline = {
  contentDurationMs: 3000,
  rawDurationMs: 7000,
  reviewDurationMs: 3500,
  spans: [
    {
      rawStartMs: 0,
      rawEndMs: 1000,
      reviewStartMs: 0,
      reviewEndMs: 1000,
      type: "active_audio"
    },
    {
      compactMs: 500,
      rawStartMs: 1000,
      rawEndMs: 5000,
      reviewStartMs: 1000,
      reviewEndMs: 1500,
      type: "long_silence"
    },
    {
      rawStartMs: 5000,
      rawEndMs: 7000,
      reviewStartMs: 1500,
      reviewEndMs: 3500,
      type: "active_audio"
    }
  ]
};

describe("session-record-playback", () => {
  it("starts playback at the first review segment", () => {
    expect(selectInitialSessionRecordPlaybackState(segments)).toEqual({
      activeSegmentId: "seg-1",
      playbackMs: 0
    });

    expect(selectInitialSessionRecordPlaybackState([{ ...segments[1], startMs: 4200 }])).toEqual({
      activeSegmentId: "seg-2",
      playbackMs: 4200
    });
  });

  it("clamps playback to the record duration and selects the active segment", () => {
    expect(
      selectSessionRecordPlaybackUpdate({
        currentMs: 8000,
        durationMs: 7000,
        isPlaying: false,
        segments,
        timeline: null
      })
    ).toEqual({
      activeSegmentId: null,
      playbackMs: 7000,
      skipTargetRawMs: null
    });

    expect(
      selectSessionRecordPlaybackUpdate({
        currentMs: 5500,
        durationMs: 7000,
        isPlaying: false,
        segments,
        timeline: null
      })
    ).toEqual({
      activeSegmentId: "seg-2",
      playbackMs: 5500,
      skipTargetRawMs: null
    });
  });

  it("skips compressed silence while audio is playing", () => {
    expect(
      selectSessionRecordPlaybackUpdate({
        currentMs: 1600,
        durationMs: 7000,
        isPlaying: true,
        segments,
        timeline: compressedTimeline
      })
    ).toEqual({
      activeSegmentId: "seg-2",
      playbackMs: 5000,
      skipTargetRawMs: 5000
    });

    expect(
      selectSessionRecordPlaybackUpdate({
        currentMs: 1600,
        durationMs: 7000,
        isPlaying: false,
        segments,
        timeline: compressedTimeline
      })
    ).toEqual({
      activeSegmentId: null,
      playbackMs: 1600,
      skipTargetRawMs: null
    });
  });
});
