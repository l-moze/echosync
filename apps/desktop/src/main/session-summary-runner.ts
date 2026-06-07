import type { SessionRecordStore } from "./session-record-store";
import type { SessionSummaryGenerator } from "./session-summary-generator";
import type { SessionRecordSummary } from "../shared/session-records";

export type SessionSummaryRunnerInput = {
  generator: SessionSummaryGenerator;
  notifyChanged: (recordId: string) => void;
  now?: () => string;
  recordId: string;
  store: SessionRecordStore;
};

export async function runSessionSummaryGeneration({
  generator,
  notifyChanged,
  now = () => new Date().toISOString(),
  recordId,
  store
}: SessionSummaryRunnerInput) {
  const record = await store.get(recordId);
  if (!record) {
    return;
  }

  try {
    const summary = await generator.generate(record);
    await store.updateSummary(recordId, summary);
  } catch (error) {
    await store.updateSummary(recordId, failedSummary(error, now()));
  } finally {
    notifyChanged(recordId);
  }
}

function failedSummary(error: unknown, updatedAt: string): SessionRecordSummary {
  return {
    status: "failed",
    text: "",
    keywords: [],
    actionItems: [],
    topics: [],
    risks: [],
    terminologySuggestions: [],
    errorMessage: error instanceof Error ? error.message : String(error),
    updatedAt
  };
}
