import { describe, expect, it } from "vitest";

import {
  defaultSessionPreferences,
  reduceSessionPreferences
} from "../src/shared/session-preferences";

describe("会话偏好状态", () => {
  it("跨窗口同步时只更新 patch 指定字段", () => {
    const next = reduceSessionPreferences(defaultSessionPreferences, {
      sourceId: "microphone",
      translationProvider: "deepseek",
      ttsProvider: "edge-tts"
    });

    expect(next).toMatchObject({
      asrLatencyMode: "balanced",
      asrProvider: "server-default",
      languageDirectionId: "en-zh",
      sourceId: "microphone",
      translationProvider: "deepseek",
      ttsProvider: "edge-tts"
    });
  });
});
