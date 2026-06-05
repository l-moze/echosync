import { describe, expect, it } from "vitest";

import { createInitialCaptionLines } from "../src/renderer/initial-captions";

describe("renderer initial captions", () => {
  it("starts empty so demo captions cannot mask the real pipeline", () => {
    expect(createInitialCaptionLines()).toEqual([]);
  });
});
