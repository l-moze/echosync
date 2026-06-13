import { describe, expect, it } from "vitest";

import { selectReviewTextWeight, selectTranscriptReviewColumnTemplate } from "./session-review-layout";

describe("session-review-layout", () => {
  it("keeps review columns balanced for similar bilingual text weight", () => {
    const template = selectTranscriptReviewColumnTemplate([
      { sourceText: "Hello world", targetText: "你好世界" },
      { sourceText: "Short update", targetText: "简短更新" }
    ]);

    expect(template).toBe("84px minmax(0, 0.52fr) minmax(0, 0.48fr)");
  });

  it("bounds very long source columns so target text remains visible", () => {
    const template = selectTranscriptReviewColumnTemplate([
      {
        sourceText: "This source segment is intentionally much longer than its translated counterpart",
        targetText: "短译文"
      }
    ]);

    expect(template).toBe("84px minmax(0, 0.62fr) minmax(0, 0.38fr)");
  });

  it("weights ascii and wide text consistently", () => {
    expect(selectReviewTextWeight(["latency mode", "稳定提交"])).toBeCloseTo(5.58);
  });
});
