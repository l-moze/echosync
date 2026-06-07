import { describe, expect, it } from "vitest";

import {
  buildSessionRecordExportPayload,
  defaultExportFileName,
  exportDialogFilters
} from "../src/main/session-record-exporter";
import type { SessionRecord } from "../src/shared/session-records";

describe("会议记录本地文件导出", () => {
  it("根据记录标题和格式生成安全默认文件名", () => {
    expect(defaultExportFileName(createRecord(), "markdown")).toBe("网课复盘.md");
    expect(defaultExportFileName({ title: "A/B:C*D?" }, "csv")).toBe("A_B_C_D_.csv");
  });

  it("为文本格式构建可写入文件的 UTF-8 payload", async () => {
    const payload = await buildSessionRecordExportPayload(createRecord(), "csv");

    expect(payload).toMatchObject({
      extension: "csv",
      fileName: "网课复盘.csv",
      mimeType: "text/csv;charset=utf-8"
    });
    expect(Buffer.isBuffer(payload.data)).toBe(true);
    expect(payload.data.toString("utf8")).toContain("index,start_ms,end_ms");
  });

  it("为 DOCX 构建真实 Office Open XML 二进制 payload", async () => {
    const payload = await buildSessionRecordExportPayload(createRecord(), "docx");

    expect(payload).toMatchObject({
      extension: "docx",
      fileName: "网课复盘.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
    expect(Buffer.isBuffer(payload.data)).toBe(true);
    expect(payload.data.byteLength).toBeGreaterThan(100);
    expect(payload.data.subarray(0, 2).toString("utf8")).toBe("PK");
  });

  it("为保存对话框提供当前格式过滤器", () => {
    expect(exportDialogFilters("docx")).toEqual([
      { extensions: ["docx"], name: "DOCX" },
      { extensions: ["*"], name: "All Files" }
    ]);
  });
});

function createRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "record_export",
    title: "网课复盘",
    createdAt: "2026-06-06T10:00:00.000Z",
    startedAt: "2026-06-06T10:00:00.000Z",
    endedAt: "2026-06-06T10:03:00.000Z",
    durationMs: 180_000,
    sourceLang: "en",
    targetLang: "zh-CN",
    summary: {
      status: "ready",
      text: "课程重点已整理。",
      keywords: ["课程"],
      actionItems: ["复习核心概念"],
      topics: ["课程重点"],
      risks: [],
      terminologySuggestions: []
    },
    metadata: {
      segmentCount: 1,
      sourceCharCount: 11,
      targetCharCount: 6,
      patchCount: 0
    },
    segments: [
      {
        id: "segment_1",
        startMs: 5_000,
        endMs: 6_800,
        sourceText: "Key concept",
        targetText: "核心概念",
        revisionState: "final",
        patchCount: 0
      }
    ],
    updatedAt: "2026-06-06T10:03:00.000Z",
    ...overrides
  };
}
