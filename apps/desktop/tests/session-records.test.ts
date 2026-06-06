import { describe, expect, it } from "vitest";

import {
  filterSessionRecordsByTitle,
  serializeSessionRecordMarkdown,
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
});
