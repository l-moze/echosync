import { describe, expect, it } from "vitest";

import {
  filterSessionRecordsByTitle,
  serializeSessionRecordSrt,
  serializeSessionRecordMarkdown,
  toSessionRecordListItem,
  type SessionRecord,
  type SessionRecordDraftInput,
  type SessionRecordListItem
} from "../src/shared/session-records";

const records: SessionRecordListItem[] = [
  {
    id: "record_2",
    title: "产品评审会议",
    endedAt: "2026年06月06日 11:35",
    duration: "18分钟",
    sourceText: "We should make the caption controls more direct.",
    targetText: "我们应该让字幕控制更直接。"
  },
  {
    id: "record_1",
    title: "Weekly Design Review",
    endedAt: "2026年06月05日 15:20",
    duration: "42分钟",
    sourceText: "The typography needs stronger contrast.",
    targetText: "排版需要更强的对比。"
  }
];

describe("会议记录共享逻辑", () => {
  it("按会议名称搜索记录，并忽略大小写和首尾空格", () => {
    expect(filterSessionRecordsByTitle(records, " design ")).toEqual([records[1]]);
    expect(filterSessionRecordsByTitle(records, "产品")).toEqual([records[0]]);
  });

  it("空搜索词保留完整记录列表", () => {
    expect(filterSessionRecordsByTitle(records, "   ")).toBe(records);
  });

  it("将记录详情导出为可复制的 Markdown", () => {
    expect(serializeSessionRecordMarkdown(records[0])).toBe(
      [
        "# 产品评审会议",
        "",
        "- 结束时间：2026年06月06日 11:35",
        "- 时长：18分钟",
        "",
        "## 原文",
        "",
        "We should make the caption controls more direct.",
        "",
        "## 译文",
        "",
        "我们应该让字幕控制更直接。"
      ].join("\n")
    );
  });

  it("旧记录没有时间线元数据时列表时长行为保持不变", () => {
    expect(toSessionRecordListItem(createRecord({ durationMs: 42_000 })).duration).toBe("42秒");
  });

  it("有时间线元数据时列表展示复盘压缩时长", () => {
    const record = createRecord({
      durationMs: 180_000,
      timeline: createTimeline({
        rawDurationMs: 180_000,
        contentDurationMs: 72_000,
        reviewDurationMs: 75_000
      })
    });

    expect(toSessionRecordListItem(record).duration).toBe("1分钟15秒");
  });

  it("完整 Markdown 导出同时包含复盘时长和总录制时长", () => {
    const markdown = serializeSessionRecordMarkdown(
      createRecord({
        durationMs: 180_000,
        timeline: createTimeline({
          rawDurationMs: 180_000,
          contentDurationMs: 72_000,
          reviewDurationMs: 75_000
        })
      })
    );

    expect(markdown).toContain("- 复盘时长：1分钟15秒");
    expect(markdown).toContain("- 总录制时长：3分钟00秒");
  });

  it("SRT 导出保持原始片段时间戳，不使用压缩时间线", () => {
    const record = createRecord({
      durationMs: 8_000,
      timeline: createTimeline({
        rawDurationMs: 8_000,
        contentDurationMs: 1_800,
        reviewDurationMs: 2_100
      })
    });

    expect(serializeSessionRecordSrt(record)).toContain("00:00:05,000 --> 00:00:06,800");
  });

  it("草稿输入允许携带时间线元数据", () => {
    const draft: SessionRecordDraftInput = {
      id: "draft_timeline",
      title: "网课复盘",
      createdAt: "2026-06-06T10:00:00.000Z",
      endedAt: "2026-06-06T10:03:00.000Z",
      durationMs: 180_000,
      segments: [],
      timeline: createTimeline({
        rawDurationMs: 180_000,
        contentDurationMs: 72_000,
        reviewDurationMs: 75_000
      })
    };

    expect(draft.timeline?.reviewDurationMs).toBe(75_000);
  });
});

function createRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "record_timeline",
    title: "网课复盘",
    createdAt: "2026-06-06T10:00:00.000Z",
    startedAt: "2026-06-06T10:00:00.000Z",
    endedAt: "2026-06-06T10:03:00.000Z",
    durationMs: 180_000,
    sourceLang: "en",
    targetLang: "zh",
    summary: {
      status: "ready",
      text: "课程重点已整理。",
      keywords: [],
      actionItems: [],
      topics: [],
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

function createTimeline({
  rawDurationMs,
  contentDurationMs,
  reviewDurationMs
}: {
  rawDurationMs: number;
  contentDurationMs: number;
  reviewDurationMs: number;
}) {
  return {
    rawDurationMs,
    contentDurationMs,
    reviewDurationMs,
    mode: "video" as const,
    compressionEnabled: true,
    spans: [
      {
        kind: "content" as const,
        rawStartMs: 5_000,
        rawEndMs: 6_800,
        reviewStartMs: 0,
        reviewEndMs: 1_800
      }
    ]
  };
}
