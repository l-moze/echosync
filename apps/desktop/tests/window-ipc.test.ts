import { describe, expect, it, vi } from "vitest";

import { sendToWindow, sendToWindows } from "../src/main/window-ipc";

describe("主进程窗口 IPC 安全发送", () => {
  it("窗口已销毁时不发送也不抛错", () => {
    const send = vi.fn();
    const target = {
      isDestroyed: () => true,
      webContents: {
        isDestroyed: () => false,
        send
      }
    };

    expect(() => sendToWindow(target, "audio:state", { state: "stopped" })).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("webContents 已销毁时不发送也不抛错", () => {
    const send = vi.fn();
    const target = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => true,
        send
      }
    };

    expect(sendToWindow(target, "caption:event", { type: "realtime.done" })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("发送期间遇到 Electron 生命周期竞态时吞掉异常", () => {
    const target = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(() => {
          throw new Error("Object has been destroyed");
        })
      }
    };

    expect(() => sendToWindow(target, "audio:state", { state: "stopped" })).not.toThrow();
    expect(sendToWindow(target, "audio:state", { state: "stopped" })).toBe(false);
  });

  it("可以向多个仍存活的窗口广播", () => {
    const firstSend = vi.fn();
    const secondSend = vi.fn();

    const count = sendToWindows(
      [
        null,
        { isDestroyed: () => false, webContents: { send: firstSend } },
        { isDestroyed: () => true, webContents: { send: vi.fn() } },
        { isDestroyed: () => false, webContents: { send: secondSend } }
      ],
      "subtitle-style:state",
      { fontSize: 18 }
    );

    expect(count).toBe(2);
    expect(firstSend).toHaveBeenCalledOnce();
    expect(secondSend).toHaveBeenCalledOnce();
  });
});
