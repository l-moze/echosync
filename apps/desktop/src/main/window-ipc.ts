type WindowIpcTarget = {
  isDestroyed?: () => boolean;
  webContents?: {
    isDestroyed?: () => boolean;
    send: (channel: string, ...args: unknown[]) => void;
  };
};

export function sendToWindow(
  target: WindowIpcTarget | null | undefined,
  channel: string,
  ...args: unknown[]
) {
  if (!target || target.isDestroyed?.()) {
    return false;
  }

  const webContents = target.webContents;
  if (!webContents || webContents.isDestroyed?.()) {
    return false;
  }

  try {
    webContents.send(channel, ...args);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Object has been destroyed")) {
      return false;
    }
    console.warn(`[window-ipc] 发送 ${channel} 失败:`, error);
    return false;
  }
}

export function sendToWindows(
  targets: Array<WindowIpcTarget | null | undefined>,
  channel: string,
  ...args: unknown[]
) {
  return targets.reduce((sentCount, target) => {
    return sentCount + (sendToWindow(target, channel, ...args) ? 1 : 0);
  }, 0);
}
