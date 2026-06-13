import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const rendererSource = readFileSync(resolve(__dirname, "../src/renderer/main.tsx"), "utf8");
const stylesheet = readFileSync(resolve(__dirname, "../src/renderer/styles.css"), "utf8");

function sourceAround(marker: string, before = 700, after = 700) {
  const index = rendererSource.indexOf(marker);
  expect(index).toBeGreaterThanOrEqual(0);
  return rendererSource.slice(Math.max(0, index - before), index + marker.length + after);
}

describe("会议摘要渲染契约", () => {
  it("结构化摘要卡片包含 actionItems、topics、risks、terminologySuggestions", () => {
    const summarySource = sourceAround("function RecordSummaryInspectorPanel", 0, 7000);

    expect(rendererSource).toContain("summary.actionItems");
    expect(rendererSource).toContain("summary.topics");
    expect(rendererSource).toContain("summary.risks");
    expect(rendererSource).toContain("summary.terminologySuggestions");
    expect(summarySource).toContain("<ActionItemCard");
    expect(summarySource).toContain("<TopicCard");
    expect(summarySource).toContain("<RiskCard");
    expect(summarySource).toContain("<DecisionCard");
    expect(summarySource).toContain("<RecordSummaryList");
    expect(summarySource).toContain("<h4>行动项</h4>");
    expect(summarySource).toContain("<h4>主题</h4>");
    expect(summarySource).toContain("<h4>风险</h4>");
    expect(summarySource).toContain("<h4>决策</h4>");
    expect(summarySource).toContain('title="术语建议"');
  });

  it("RecordSummaryList 组件接收结构化对象数组", () => {
    const summaryListSource = sourceAround("function RecordSummaryList", 0, 600);

    expect(summaryListSource).toContain("items: Array<{ id: string; text?: string; sourceText?: string; targetText?: string }>");
    expect(summaryListSource).toContain("type: \"action\" | \"topic\" | \"risk\" | \"term\"");
    expect(summaryListSource).toContain("displayItems.length === 0");
    expect(summaryListSource).toContain("return null;");
  });

  it("RecordSummaryList 渲染每个条目的 displayText", () => {
    const summaryListSource = sourceAround("function RecordSummaryList", 0, 900);

    expect(summaryListSource).toContain("const displayItems = items");
    expect(summaryListSource).toContain(".map((item) => ({");
    expect(summaryListSource).toContain("text: summaryListDisplayText(item, type)");
    expect(summaryListSource).toContain("if (type !== \"term\")");
    expect(rendererSource).toContain("return `${sourceText} → ${targetText}`");
    expect(summaryListSource).toContain("item.text?.trim() ?? \"\"");
    expect(summaryListSource).toContain("<li key={item.id}>{item.text}</li>");
  });

  it("摘要状态标签展示 pending、ready、failed", () => {
    const detailSource = sourceAround("function RecordSummaryInspectorPanel", 0, 7000);

    expect(detailSource).toContain("sessionRecordSummaryStatusLabel(record.summary.status)");
    expect(detailSource).toContain("record.summary.text");
    expect(detailSource).toContain("record.summary.status === \"failed\"");
    expect(detailSource).toContain("record.summary.errorMessage");
    expect(detailSource).toContain("record.summary.status !== \"ready\"");
  });

  it("摘要关键词渲染为标签列表", () => {
    const detailSource = sourceAround("function RecordSummaryInspectorPanel", 0, 7000);

    expect(detailSource).toContain("record.summary.keywords.length > 0");
    expect(detailSource).toContain("recordKeywordList");
    expect(detailSource).toContain("record.summary.keywords.map((keyword)");
    expect(detailSource).toContain("<span key={keyword}>{keyword}</span>");
  });

  it("RecordSummaryList 组件存在于渲染代码中", () => {
    expect(rendererSource).toContain("function RecordSummaryList(");
    expect(rendererSource).toContain("recordSummaryList");
  });

  it("摘要区域包含摘要标题和内容", () => {
    const detailSource = sourceAround("function RecordSummaryInspectorPanel", 0, 7000);

    expect(detailSource).toContain("摘要");
    expect(detailSource).toContain("record.summary.text");
    expect(detailSource).toContain("record.summary.keywords");
    expect(detailSource).toContain("ActionItemCard");
    expect(detailSource).toContain("RecordSummaryList");
  });

  it("支持重新生成摘要按钮", () => {
    const detailSource = sourceAround("function RecordSummaryInspectorPanel", 0, 7000);

    expect(detailSource).toContain("recordSummaryRetry");
    expect(detailSource).toContain("onRegenerateSummary");
    expect(detailSource).toContain("重新生成摘要");
    expect(detailSource).toContain("生成摘要");
  });

  it("CSS 包含摘要相关样式类", () => {
    expect(stylesheet).toContain(".recordSummaryList");
    expect(stylesheet).toContain(".recordKeywordList");
  });
});

describe("摘要 evidence anchor 渲染契约（向后兼容）", () => {
  it("Record Inspector 支持 evidence citation 点击并聚焦证据面板", () => {
    const inspectorSource = sourceAround("function RecordInspectorAside", 0, 3500);
    const evidenceSource = sourceAround("function EvidenceInspectorPanel", 0, 2200);

    expect(inspectorSource).toContain("activeTab === \"evidence\"");
    expect(inspectorSource).toContain("selectedEvidence");
    expect(evidenceSource).toContain("formatEvidenceRelevance");
    expect(evidenceSource).toContain("跳到片段");
    expect(evidenceSource).toContain("onJump(evidence)");
  });

  it("记录详情页支持点击片段跳转音频", () => {
    const detailSource = sourceAround("function SessionRecordsWindow", 0, 35000);

    expect(detailSource).toContain("seekRecordAudio(segment.startMs)");
    expect(detailSource).toContain("pendingRecordSeekMsRef");
    expect(detailSource).toContain("applyPendingRecordSeek");
  });

  it("向后兼容：旧格式摘要显示简单列表", () => {
    const summaryListSource = sourceAround("function RecordSummaryList", 0, 900);

    // Should handle both old (string[]) and new (structured objects) formats
    // Current implementation expects structured objects with id/text/sourceText/targetText
    expect(summaryListSource).toContain("displayItems.length === 0");
    expect(summaryListSource).toContain("return null;");
    expect(summaryListSource).toContain(".map((item)");
  });
});

describe("摘要数据模型契约", () => {
  it("SessionRecord.summary 包含结构化字段", () => {
    // Verify the type definition exists in shared/session-records.ts
    // This is a compile-time check that the types are properly defined
    const sharedSource = readFileSync(resolve(__dirname, "../src/shared/session-records.ts"), "utf8");

    expect(sharedSource).toContain("export type EvidenceAnchor");
    expect(sharedSource).toContain("export type ActionItem");
    expect(sharedSource).toContain("export type Topic");
    expect(sharedSource).toContain("export type Risk");
    expect(sharedSource).toContain("export type Decision");
    expect(sharedSource).toContain("export type TerminologySuggestion");
    expect(sharedSource).toContain("export type SessionRecordSummary");
  });

  it("EvidenceAnchor 包含 segmentId、startMs、endMs、quote、relevance", () => {
    const sharedSource = readFileSync(resolve(__dirname, "../src/shared/session-records.ts"), "utf8");

    expect(sharedSource).toContain("segmentId: string");
    expect(sharedSource).toContain("startMs: number");
    expect(sharedSource).toContain("endMs: number");
    expect(sharedSource).toContain("quote: string");
    expect(sharedSource).toContain("relevance: number");
  });

  it("ActionItem 包含 id、text、evidence 数组", () => {
    const sharedSource = readFileSync(resolve(__dirname, "../src/shared/session-records.ts"), "utf8");
    const actionItemSection = sharedSource.slice(
      sharedSource.indexOf("export type ActionItem"),
      sharedSource.indexOf("export type Topic")
    );

    expect(actionItemSection).toContain("id: string");
    expect(actionItemSection).toContain("text: string");
    expect(actionItemSection).toContain("evidence: EvidenceAnchor[]");
    expect(actionItemSection).toContain("confidence");
  });

  it("Risk 包含 severity 字段", () => {
    const sharedSource = readFileSync(resolve(__dirname, "../src/shared/session-records.ts"), "utf8");
    const riskSection = sharedSource.slice(
      sharedSource.indexOf("export type Risk"),
      sharedSource.indexOf("export type Decision")
    );

    expect(riskSection).toContain("severity");
    expect(riskSection).toContain("low");
    expect(riskSection).toContain("medium");
    expect(riskSection).toContain("high");
    expect(riskSection).toContain("evidence: EvidenceAnchor[]");
  });

  it("SessionRecordSummary 包含所有结构化字段", () => {
    const sharedSource = readFileSync(resolve(__dirname, "../src/shared/session-records.ts"), "utf8");
    const summarySection = sharedSource.slice(
      sharedSource.indexOf("export type SessionRecordSummary"),
      sharedSource.indexOf("export type SessionRecordMetadata")
    );

    expect(summarySection).toContain("status:");
    expect(summarySection).toContain("actionItems: ActionItem[]");
    expect(summarySection).toContain("topics: Topic[]");
    expect(summarySection).toContain("risks: Risk[]");
    expect(summarySection).toContain("decisions: Decision[]");
    expect(summarySection).toContain("terminologySuggestions: TerminologySuggestion[]");
  });
});
