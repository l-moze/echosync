import { describe, expect, it } from "vitest";

import { createInitialSessionUiState, type SessionUiState } from "../../shared/session-ui-state";
import { pageTitleForSession } from "./session-page-title";

describe("session-page-title", () => {
  it("selects the control window page title from session lifecycle", () => {
    const idle = createInitialSessionUiState({ platform: "windows" });
    expect(pageTitleForSession(idle)).toBe("EchoSync");

    const active: SessionUiState = { ...idle, lifecycle: "active" };
    expect(pageTitleForSession(active)).toBe("正在同传");

    const finished: SessionUiState = { ...idle, lifecycle: "finished" };
    expect(pageTitleForSession(finished)).toBe("会话复盘");
  });

  it("prefers startup title while a session is starting", () => {
    const startup: SessionUiState = {
      ...createInitialSessionUiState({ platform: "windows" }),
      lifecycle: "active",
      startup: {
        canCancel: true,
        detail: "",
        message: "准备音频",
        phase: "preparing_audio",
        startedAtMs: 100
      }
    };

    expect(pageTitleForSession(startup)).toBe("启动同传");
  });
});
