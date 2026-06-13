import { describe, expect, it } from "vitest";

import type { CaptionLine } from "../../shared/caption-store";
import {
  buildSessionRecordTimeline,
  reviewDurationMsForTimeline,
  reviewTimelineFromSessionTimeline,
  reviewTimelineModeForSource,
  selectReviewTimelineActiveRanges
} from "./session-review-timeline";

function captionLine(id: string, startMs: number, endMs: number): CaptionLine {
  return {
    endMs,
    id,
    patchCount: 0,
    rev: 1,
    sourceText: id,
    stability: 1,
    startMs,
    state: "locked",
    targetText: id
  };
}

describe("session-review-timeline", () => {
  it("selects timeline compression mode from desktop audio source", () => {
    expect(reviewTimelineModeForSource("microphone")).toBe("meeting");
    expect(reviewTimelineModeForSource("mixed")).toBe("meeting");
    expect(reviewTimelineModeForSource("file")).toBe("course");
    expect(reviewTimelineModeForSource("windows-system")).toBe("video");
  });

  it("prefers recording activity ranges and falls back to caption line timing", () => {
    expect(
      selectReviewTimelineActiveRanges([{ startMs: 100, endMs: 300 }], [captionLine("line", 10, 50)])
    ).toEqual([{ rawStartMs: 100, rawEndMs: 300 }]);

    expect(selectReviewTimelineActiveRanges(undefined, [captionLine("line", 10, 50)])).toEqual([
      { rawStartMs: 10, rawEndMs: 50 }
    ]);
  });

  it("round-trips session timeline spans into review timeline spans", () => {
    const sessionTimeline = buildSessionRecordTimeline({
      lines: [captionLine("line", 0, 1000)],
      rawDurationMs: 5000,
      sourceId: "windows-system"
    });

    const reviewTimeline = reviewTimelineFromSessionTimeline(sessionTimeline);

    expect(sessionTimeline.compressionEnabled).toBe(true);
    expect(sessionTimeline.spans.at(-1)?.kind).toBe("silence");
    expect(reviewTimeline?.spans.at(-1)?.type).toBe("long_silence");
    expect(reviewDurationMsForTimeline(reviewTimeline, 1234)).toBe(sessionTimeline.reviewDurationMs);
    expect(reviewDurationMsForTimeline(null, 1234)).toBe(1234);
  });
});
