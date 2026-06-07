import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createSessionRecordStore } from "../src/main/session-record-store";
import type { SessionRecordSegment } from "../src/shared/session-records";

describe("主进程会议记录持久化", () => {
  it("保存草稿、修正重叠时间轴、重命名、导出并返回音频 URL", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "echosync-record-store-"));
    try {
      const store = createSessionRecordStore(rootDir);
      const segments: SessionRecordSegment[] = [
        segment({ id: "seg_1", startMs: 0, endMs: 1200, sourceText: "Hello", targetText: "你好" }),
        segment({ id: "seg_2", startMs: 800, endMs: 1800, sourceText: "World", targetText: "世界" })
      ];

      const saved = await store.saveDraft({
        id: "session:demo",
        title: "  产品评审  ",
        createdAt: "2026-06-06T10:00:00.000Z",
        endedAt: "2026-06-06T10:01:00.000Z",
        durationMs: 60_000,
        audio: {
          data: arrayBufferFromBytes([1, 2, 3, 4]),
          mimeType: "audio/webm"
        },
        segments
      });

      expect(saved.title).toBe("产品评审");
      expect(saved.segments[1]?.startMs).toBe(1200);
      expect(saved.diagnostics?.hasTimingAnomaly).toBe(true);
      expect(saved.audio?.sizeBytes).toBe(4);
      await expect(fs.stat(saved.audio?.path ?? "")).resolves.toMatchObject({ size: 4 });

      const listed = await store.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        id: "session:demo",
        title: "产品评审",
        segmentCount: 2
      });

      const renamed = await store.rename("session:demo", "复盘会议");
      expect(renamed.title).toBe("复盘会议");

      const markdown = await store.exportRecord("session:demo", "markdown");
      expect(markdown.text).toContain("# 复盘会议");
      expect(markdown.text).toContain("## 双语记录");

      const srt = await store.exportRecord("session:demo", "srt");
      expect(srt.text).toContain("00:00:01,200 --> 00:00:01,800");

      expect(await store.getAudioUrl("session:demo")).toMatch(/^file:\/\//);
      const audioData = await store.getAudioData("session:demo");
      expect(audioData?.mimeType).toBe("audio/webm");
      expect(audioData ? Array.from(new Uint8Array(audioData.data)) : []).toEqual([1, 2, 3, 4]);

      await store.delete("session:demo");
      expect(await store.get("session:demo")).toBeNull();
    } finally {
      await fs.rm(rootDir, { force: true, recursive: true });
    }
  });

  it("拒绝空标题，避免落盘不可识别记录", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "echosync-record-store-"));
    try {
      const store = createSessionRecordStore(rootDir);

      await expect(
        store.saveDraft({
          id: "empty-title",
          title: "   ",
          createdAt: "2026-06-06T10:00:00.000Z",
          endedAt: "2026-06-06T10:01:00.000Z",
          durationMs: 60_000,
          segments: []
        })
      ).rejects.toThrow("标题不能为空");
    } finally {
      await fs.rm(rootDir, { force: true, recursive: true });
    }
  });

  it("更新 AI 摘要并持久化到记录详情和列表", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "echosync-record-store-"));
    try {
      const store = createSessionRecordStore(rootDir);
      await store.saveDraft({
        id: "summary-demo",
        title: "摘要会议",
        createdAt: "2026-06-06T10:00:00.000Z",
        endedAt: "2026-06-06T10:01:00.000Z",
        durationMs: 60_000,
        segments: [
          segment({ id: "seg_1", sourceText: "We need a lower latency ASR path.", targetText: "我们需要更低延迟的识别链路。" })
        ]
      });

      const updated = await store.updateSummary("summary-demo", {
        status: "ready",
        text: "会议讨论了低延迟识别链路的优化方向。",
        keywords: ["低延迟", "识别链路"],
        actionItems: ["评估 FunASR 低延迟模式"],
        topics: ["ASR 优化"],
        risks: ["云端模型响应波动"],
        terminologySuggestions: ["ASR：语音识别"]
      });

      expect(updated.summary).toMatchObject({
        status: "ready",
        text: "会议讨论了低延迟识别链路的优化方向。",
        keywords: ["低延迟", "识别链路"],
        actionItems: ["评估 FunASR 低延迟模式"],
        topics: ["ASR 优化"],
        risks: ["云端模型响应波动"],
        terminologySuggestions: ["ASR：语音识别"]
      });
      expect(updated.summary.updatedAt).toBeTruthy();

      const reloaded = await store.get("summary-demo");
      expect(reloaded?.summary.text).toBe("会议讨论了低延迟识别链路的优化方向。");

      const listed = await store.list();
      expect(listed[0]).toMatchObject({
        summaryStatus: "ready",
        summaryText: "会议讨论了低延迟识别链路的优化方向。"
      });
    } finally {
      await fs.rm(rootDir, { force: true, recursive: true });
    }
  });
});

function segment(overrides: Partial<SessionRecordSegment>): SessionRecordSegment {
  return {
    id: "seg",
    startMs: 0,
    endMs: 1000,
    sourceText: "",
    targetText: "",
    revisionState: "final",
    patchCount: 0,
    ...overrides
  };
}

function arrayBufferFromBytes(bytes: number[]): ArrayBuffer {
  const buffer = Uint8Array.from(bytes);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
