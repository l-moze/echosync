import type { DesktopCapturerSource, WebFrameMain } from "electron";

export type LoopbackDisplayMediaStreams = {
  audio: "loopback";
  video?: DesktopCapturerSource | WebFrameMain;
};

export function createLoopbackDisplayMediaStreams(
  videoSource?: DesktopCapturerSource | WebFrameMain | null,
  videoRequested = true
): LoopbackDisplayMediaStreams {
  if (videoRequested && videoSource) {
    return { audio: "loopback", video: videoSource };
  }

  return { audio: "loopback" };
}
