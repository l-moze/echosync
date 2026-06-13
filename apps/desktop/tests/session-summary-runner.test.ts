import { describe, expect, it, vi } from "vitest";

import { runSessionSummaryGeneration } from "../src/main/session-summary-runner";
import type { SessionRecordStore } from "../src/main/session-record-store";
import type { SessionSummaryGenerator } from "../src/main/session-summary-generator";
import type { SessionRecord, SessionRecordSummary } from "../src/shared/session-records";

describe("会议记录摘要后台任务", () => {
  it("读取完整记录，生成摘要，落盘并通知界面刷新", async () => {
    const record = recordFixture();
    const notifications: string[] = [];
    const generatedSummary: SessionRecordSummary = {
      status: "ready",
      text: "会议讨论了低延迟字幕和备用链路。",
      keywords: ["低延迟", "备用链路"],
      actionItems: ["补齐摘要链路"],
      topics: ["会议复盘"],
      risks: ["模型响应慢"],
      terminologySuggestions: ["fallback：备用链路"],
      updatedAt: "2026-06-07T00:00:00.000Z"
    };
    const store = {
      get: vi.fn(async () => record),
      updateSummary: vi.fn(async (_id: string, summary: Partial<SessionRecordSummary>) => ({
        ...record,
        summary: {
          ...record.summary,
          ...summary
        } as SessionRecordSummary
      }))
    } as unknown as SessionRecordStore;
    const generator: SessionSummaryGenerator = {
      generate: vi.fn(async () => generatedSummary)
    };

    await runSessionSummaryGeneration({
      generator,
      notifyChanged: (id) => notifications.push(id),
      recordId: "record_1",
      store
    });

    expect(store.get).toHaveBeenCalledWith("record_1");
    expect(generator.generate).toHaveBeenCalledWith(record);
    expect(store.updateSummary).toHaveBeenCalledWith("record_1", generatedSummary);
    expect(notifications).toEqual(["record_1"]);
  });

  it("摘要生成失败时写入 failed 状态并通知界面刷新", async () => {
    const record = recordFixture();
    const notifications: string[] = [];
    const store = {
      get: vi.fn(async () => record),
      updateSummary: vi.fn(async (_id: string, summary: Partial<SessionRecordSummary>) => ({
        ...record,
        summary: {
          ...record.summary,
          ...summary
        } as SessionRecordSummary
      }))
    } as unknown as SessionRecordStore;
    const generator: SessionSummaryGenerator = {
      generate: vi.fn(async () => {
        throw new Error("模型暂不可用");
      })
    };

    await runSessionSummaryGeneration({
      generator,
      notifyChanged: (id) => notifications.push(id),
      now: () => "2026-06-07T00:00:00.000Z",
      recordId: "record_1",
      store
    });

    expect(store.updateSummary).toHaveBeenCalledWith("record_1", {
      status: "failed",
      text: "",
      keywords: [],
      actionItems: [],
      topics: [],
      risks: [],
      decisions: [],
      terminologySuggestions: [],
      errorMessage: "模型暂不可用",
      updatedAt: "2026-06-07T00:00:00.000Z"
    });
    expect(notifications).toEqual(["record_1"]);
  });
});

function recordFixture(): SessionRecord {
  return {
    id: "record_1",
    title: "摘要任务",
    createdAt: "2026-06-07T00:00:00.000Z",
    startedAt: "2026-06-07T00:00:00.000Z",
    endedAt: "2026-06-07T00:01:00.000Z",
    durationMs: 60_000,
    sourceLang: "en",
    targetLang: "zh-CN",
    summary: {
      status: "pending",
      text: "",
      keywords: [],
      actionItems: [],
      topics: [],
      risks: [],
      decisions: [],
      terminologySuggestions: []
    },
    metadata: {
      patchCount: 0,
      segmentCount: 1,
      sourceCharCount: 21,
      targetCharCount: 9
    },
    segments: [
      {
        id: "seg_1",
        startMs: 0,
        endMs: 1000,
        sourceText: "Need lower latency.",
        targetText: "需要更低延迟。",
        revisionState: "final",
        patchCount: 0
      }
    ],
    updatedAt: "2026-06-07T00:01:00.000Z"
  };
}
