import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createTerminologyStore } from "../src/main/terminology-store";

describe("主进程术语库持久化", () => {
  it("导入 CSV 术语、保存摘要并支持启用切换和删除", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "echosync-terminology-store-"));
    try {
      const store = createTerminologyStore(rootDir);

      const imported = await store.importLibrary({
        content: "EchoSync,回声同步\nDo Not Translate,Do Not Translate,keep\n",
        name: "product_terms.csv",
        sourceLang: "en",
        targetLang: "zh-CN"
      });

      expect(imported).toMatchObject({
        name: "product_terms",
        enabled: true,
        entryCount: 2,
        sourceLang: "en",
        targetLang: "zh-CN"
      });
      expect(imported.entries[1]).toMatchObject({
        source: "Do Not Translate",
        target: "Do Not Translate",
        type: "keep"
      });

      expect(await store.list()).toEqual([
        expect.objectContaining({
          id: imported.id,
          entryCount: 2,
          name: "product_terms"
        })
      ]);

      const disabled = await store.update(imported.id, { enabled: false });
      expect(disabled.enabled).toBe(false);
      expect((await store.list())[0]?.enabled).toBe(false);

      await store.delete(imported.id);
      expect(await store.list()).toEqual([]);
    } finally {
      await fs.rm(rootDir, { force: true, recursive: true });
    }
  });

  it("导入 CSV 时保留空目标列，避免后续字段错位", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "echosync-terminology-store-"));
    try {
      const store = createTerminologyStore(rootDir);

      const imported = await store.importLibrary({
        content: "Foo,,keep\n",
        name: "empty_target.csv"
      });

      expect(imported.entries[0]).toMatchObject({
        source: "Foo",
        target: "Foo",
        type: "keep"
      });
    } finally {
      await fs.rm(rootDir, { force: true, recursive: true });
    }
  });

  it("导入 JSON 术语时兼容 entries 包装并去除重复项", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "echosync-terminology-store-"));
    try {
      const store = createTerminologyStore(rootDir);

      const imported = await store.importLibrary({
        content: JSON.stringify({
          entries: [
            { source: "LLM", target: "大语言模型", type: "explain" },
            { source: "LLM", target: "大语言模型", type: "explain" }
          ]
        }),
        name: "meeting.json"
      });

      expect(imported.entryCount).toBe(1);
      expect(imported.entries[0]).toMatchObject({
        source: "LLM",
        target: "大语言模型",
        type: "explain"
      });
    } finally {
      await fs.rm(rootDir, { force: true, recursive: true });
    }
  });
});
