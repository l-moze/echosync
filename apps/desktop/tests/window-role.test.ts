import { describe, expect, it } from "vitest";

import { resolveDesktopWindowRole } from "../src/renderer/window-role";

describe("桌面渲染窗口角色解析", () => {
  it("兼容 Electron 生产模式和开发模式的字幕窗口 hash", () => {
    expect(resolveDesktopWindowRole("#overlay")).toBe("overlay");
    expect(resolveDesktopWindowRole("#/overlay")).toBe("overlay");
  });

  it("未知 hash 默认进入控制面板", () => {
    expect(resolveDesktopWindowRole("#control")).toBe("control");
    expect(resolveDesktopWindowRole("")).toBe("control");
  });
});
