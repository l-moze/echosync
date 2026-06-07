import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadDesktopEnvironment, parseDotEnvText } from "../src/main/env";

describe("桌面端环境变量加载", () => {
  it("解析 .env 中的 DeepSeek 摘要密钥并保留已有进程变量", () => {
    const env: NodeJS.ProcessEnv = {
      DEEPSEEK_API_KEY: "process-key"
    };

    const loaded = parseDotEnvText(
      [
        "DEEPSEEK_API_KEY=file-key",
        "ECHOSYNC_SESSION_SUMMARY_API_KEY=\"summary-key\"",
        "ECHOSYNC_SESSION_SUMMARY_MODEL='deepseek-chat'"
      ].join("\n"),
      env
    );

    expect(loaded).toEqual(["ECHOSYNC_SESSION_SUMMARY_API_KEY", "ECHOSYNC_SESSION_SUMMARY_MODEL"]);
    expect(env.DEEPSEEK_API_KEY).toBe("process-key");
    expect(env.ECHOSYNC_SESSION_SUMMARY_API_KEY).toBe("summary-key");
    expect(env.ECHOSYNC_SESSION_SUMMARY_MODEL).toBe("deepseek-chat");
  });

  it("从 apps/desktop 启动时会加载仓库根目录 .env", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "echosync-env-"));
    const desktopDir = path.join(rootDir, "apps", "desktop");
    const mainDir = path.join(desktopDir, "dist", "main");
    const env: NodeJS.ProcessEnv = {};
    try {
      await fs.mkdir(mainDir, { recursive: true });
      await fs.writeFile(path.join(rootDir, ".env"), "DEEPSEEK_API_KEY=root-env-key\n", "utf8");

      const loaded = loadDesktopEnvironment({ cwd: desktopDir, env, mainDir });

      expect(loaded.some((item) => item.endsWith(".env"))).toBe(true);
      expect(env.DEEPSEEK_API_KEY).toBe("root-env-key");
    } finally {
      await fs.rm(rootDir, { force: true, recursive: true });
    }
  });
});
