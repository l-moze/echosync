import type {
  DesktopCaptureStartRequest,
  DesktopCaptureSnapshot
} from "../../../shared/desktop-api";

export async function getCaptureState() {
  return window.echosyncDesktop?.getCaptureState();
}

export async function getPendingCaptureRecording(sessionId: string) {
  return window.echosyncDesktop?.getPendingCaptureRecording(sessionId);
}

export async function startDesktopCapture(request: DesktopCaptureStartRequest) {
  return window.echosyncDesktop?.startCapture(request);
}

export async function stopDesktopCapture() {
  return window.echosyncDesktop?.stopCapture();
}

export function onCaptureState(listener: (snapshot: DesktopCaptureSnapshot) => void) {
  return window.echosyncDesktop?.onCaptureState(listener) ?? (() => {});
}
