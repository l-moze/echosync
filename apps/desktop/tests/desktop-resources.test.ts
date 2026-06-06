import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  APP_ICON_RESOURCE_PATH,
  resolveAppIconPath,
  resolveDesktopResourcePath
} from "../src/main/desktop-resources";

describe("桌面资源路径", () => {
  it("开发环境从 desktop resources 目录读取 app 图标", () => {
    const iconPath = resolveAppIconPath({
      isPackaged: false,
      mainDir: path.join("D:", "code", "echosync", "apps", "desktop", "dist", "main"),
      resourcesPath: path.join("D:", "code", "echosync", "apps", "desktop", "resources")
    });

    expect(iconPath).toBe(
      path.join("D:", "code", "echosync", "apps", "desktop", "resources", "icons", "app.ico")
    );
  });

  it("打包环境从 Electron resources 目录读取 app 图标", () => {
    const iconPath = resolveAppIconPath({
      isPackaged: true,
      mainDir: path.join("C:", "Program Files", "EchoSync", "resources", "app.asar", "dist", "main"),
      resourcesPath: path.join("C:", "Program Files", "EchoSync", "resources")
    });

    expect(iconPath).toBe(
      path.join("C:", "Program Files", "EchoSync", "resources", "resources", "icons", "app.ico")
    );
  });

  it("允许同一套规则解析其他桌面资源", () => {
    const sequencePath = resolveDesktopResourcePath(
      {
        isPackaged: false,
        mainDir: path.join("D:", "code", "echosync", "apps", "desktop", "dist", "main"),
        resourcesPath: path.join("D:", "code", "echosync", "apps", "desktop", "resources")
      },
      path.join("resources", "sequences", "app-icon")
    );

    expect(sequencePath).toBe(path.join("D:", "code", "echosync", "apps", "desktop", "resources", "sequences", "app-icon"));
  });

  it("app 图标资源路径固定为 Windows ico 文件", () => {
    expect(APP_ICON_RESOURCE_PATH).toBe(path.join("resources", "icons", "app.ico"));
  });
});
