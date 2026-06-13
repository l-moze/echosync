import type {
  SessionRecordDraftInput,
  SessionRecordExportFormat
} from "../../../shared/session-records";

export async function listSessionRecords() {
  return window.echosyncDesktop?.sessionRecords.list();
}

export async function getSessionRecord(recordId: string) {
  return window.echosyncDesktop?.sessionRecords.get(recordId);
}

export async function saveSessionRecordDraft(input: SessionRecordDraftInput) {
  return window.echosyncDesktop?.sessionRecords.saveDraft(input);
}

export async function deleteSessionRecord(recordId: string) {
  await window.echosyncDesktop?.sessionRecords.delete(recordId);
}

export async function exportSessionRecord(recordId: string, format: SessionRecordExportFormat) {
  return window.echosyncDesktop?.sessionRecords.export(recordId, format);
}

export async function generateSessionRecordSummary(recordId: string) {
  await window.echosyncDesktop?.sessionRecords.generateSummary(recordId);
}

export async function renameSessionRecord(recordId: string, title: string) {
  return window.echosyncDesktop?.sessionRecords.rename(recordId, title);
}

export async function getSessionRecordAudioData(recordId: string) {
  return window.echosyncDesktop?.sessionRecords.getAudioData(recordId);
}

export async function getSessionRecordAudioUrl(recordId: string) {
  return window.echosyncDesktop?.sessionRecords.getAudioUrl(recordId);
}

export function onSessionRecordChanged(listener: (recordId: string) => void) {
  return window.echosyncDesktop?.onSessionRecordChanged(listener) ?? (() => {});
}
