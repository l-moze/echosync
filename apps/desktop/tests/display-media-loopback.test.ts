import { describe, expect, it } from "vitest";

import { createLoopbackDisplayMediaStreams } from "../src/main/display-media-loopback";

describe("Electron display media loopback streams", () => {
  it("returns Windows loopback audio and the desktop source as the video placeholder", () => {
    const source = { id: "screen:1:0", name: "Entire Screen" } as Electron.DesktopCapturerSource;

    const streams = createLoopbackDisplayMediaStreams(source, true);

    expect(streams).toEqual({ audio: "loopback", video: source });
  });

  it("can still return audio-only streams when video is not requested", () => {
    const streams = createLoopbackDisplayMediaStreams(null, false);

    expect(streams).toEqual({ audio: "loopback" });
  });
});
