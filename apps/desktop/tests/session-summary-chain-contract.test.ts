import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const mainSource = readFileSync(resolve(__dirname, "../src/main/main.ts"), "utf8");
const preloadSource = readFileSync(resolve(__dirname, "../src/preload/index.ts"), "utf8");
const desktopApiSource = readFileSync(resolve(__dirname, "../src/shared/desktop-api.ts"), "utf8");
const rendererSource = [
  "../src/renderer/main.tsx",
  "../src/renderer/components/records/SessionRecordsWindow.tsx",
  "../src/renderer/components/records/SessionRecordDetailPanel.tsx",
  "../src/renderer/components/records/SummaryPanel.tsx",
  "../src/renderer/services/ipc/session-records.ts"
].map((path) => readFileSync(resolve(__dirname, path), "utf8")).join("\n");

describe("会议记录 AI 摘要链路契约", () => {
  it("主进程在保存会议记录后异步生成摘要并广播刷新事件", () => {
    expect(mainSource).toContain("loadDesktopEnvironment();");
    expect(mainSource).toContain("createSessionSummaryGeneratorFromEnv()");
    expect(mainSource).toContain("\"session-records:generate-summary\"");
    expect(mainSource).toContain("runSessionSummaryGeneration({");
    expect(mainSource).toContain("notifySessionRecordChanged");
    expect(mainSource).toContain("\"session-records:update-summary\"");
    expect(mainSource).toContain("\"session-records:changed\"");
  });

  it("preload 和 DesktopApi 暴露摘要更新与记录变更监听", () => {
    expect(desktopApiSource).toContain("updateSummary: (id: string, summary: Partial<SessionRecordSummary>) => Promise<SessionRecord>;");
    expect(desktopApiSource).toContain("generateSummary: (id: string) => Promise<void>;");
    expect(desktopApiSource).toContain("onSessionRecordChanged: (listener: (recordId: string) => void) => () => void;");
    expect(preloadSource).toContain("updateSummary: (id, summary) => ipcRenderer.invoke(\"session-records:update-summary\", id, summary)");
    expect(preloadSource).toContain("generateSummary: (id) => ipcRenderer.invoke(\"session-records:generate-summary\", id)");
    expect(preloadSource).toContain("ipcRenderer.on(\"session-records:changed\", handler)");
  });

  it("Renderer 收到记录变更后刷新列表和当前详情，并展示结构化摘要字段", () => {
    expect(rendererSource).toContain("onSessionRecordChanged");
    expect(rendererSource).toContain("await refreshSessionRecords();");
    expect(rendererSource).toContain("setSelectedRecord(normalizeSessionRecordForReview(record));");
    expect(rendererSource).toContain("summary={record.summary.text");
    expect(rendererSource).toContain("tags={record.summary.keywords}");
    expect(rendererSource).toContain("keywords={record.summary.keywords.map");
    expect(rendererSource).toContain("regenerateSelectedSummary");
    expect(rendererSource).toContain("generateSessionRecordSummary(selectedRecord.id)");
  });
});
