import { describe, expect, it } from "vitest";

import { DESKTOP_AUDIO_SOURCES } from "../src/shared/audio-source-catalog";

describe("桌面音频源目录", () => {
  it("提供麦克风、Windows 系统声音、混音和文件回放入口", () => {
    const ids = DESKTOP_AUDIO_SOURCES.map((source) => source.id);

    expect(ids).toEqual(["microphone", "windows-system", "mixed", "file"]);
  });

  it("Windows 系统声音通过 loopback 能力声明，不侵入 Agent 管道", () => {
    const systemSource = DESKTOP_AUDIO_SOURCES.find((source) => source.id === "windows-system");

    expect(systemSource).toMatchObject({
      label: "Windows 系统声音",
      captureKind: "system",
      captureMethod: "electron-display-media-loopback",
      sampleRate: 16000,
      channels: 1
    });
    expect(systemSource?.capabilities).toContain("loopback");
  });
});
