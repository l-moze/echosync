import { describe, expect, it } from "vitest";

import { sessionRecordRevisionState } from "./session-record-draft";

describe("session-record-draft", () => {
  it("maps archive caption state into record revision state", () => {
    expect(sessionRecordRevisionState("locked")).toBe("final");
    expect(sessionRecordRevisionState("revised")).toBe("edited");
    expect(sessionRecordRevisionState("interim")).toBe("draft");
    expect(sessionRecordRevisionState("stable")).toBe("draft");
  });
});
