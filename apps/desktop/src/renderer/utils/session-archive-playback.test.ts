import { describe, expect, it } from "vitest";

import type { ReviewTimeline } from "../../shared/review-timeline";
import { selectSessionArchivePlaybackUpdate } from "./session-archive-playback";

const compressedTimeline: ReviewTimeline = {
  contentDurationMs: 1500,
  rawDurationMs: 5000,
  reviewDurationMs: 2000,
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
      rawEndMs: 4500,
      reviewStartMs: 1000,
      reviewEndMs: 1500,
      type: "long_silence"
    },
    {
      rawStartMs: 4500,
      rawEndMs: 5000,
      reviewStartMs: 1500,
      reviewEndMs: 2000,
      type: "active_audio"
    }
  ]
};

describe("session-archive-playback", () => {
  it("clamps archive playback updates to the available duration", () => {
    expect(
      selectSessionArchivePlaybackUpdate({
        currentMs: 6400,
        durationMs: 5000,
        isPlaying: false,
        timeline: null
      })
    ).toEqual({
      playbackMs: 5000,
      skipTargetRawMs: null
    });
  });

  it("selects compressed silence skip target only while playing", () => {
    expect(
      selectSessionArchivePlaybackUpdate({
        currentMs: 1700,
        durationMs: 5000,
        isPlaying: true,
        timeline: compressedTimeline
      })
    ).toEqual({
      playbackMs: 4500,
      skipTargetRawMs: 4500
    });

    expect(
      selectSessionArchivePlaybackUpdate({
        currentMs: 1700,
        durationMs: 5000,
        isPlaying: false,
        timeline: compressedTimeline
      })
    ).toEqual({
      playbackMs: 1700,
      skipTargetRawMs: null
    });
  });
});
