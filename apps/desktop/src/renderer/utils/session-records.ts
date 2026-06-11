import type { SessionRecord, SessionRecordSegment } from "../../shared/session-records";
import { normalizeSessionRecordSegmentsTiming } from "../../shared/session-records";

export function normalizeSessionRecordForReview(record: SessionRecord): SessionRecord {
  const normalizedTiming = normalizeSessionRecordSegmentsTiming(record.segments);
  if (!normalizedTiming.hasTimingAnomaly) {
    return {
      ...record,
      segments: normalizedTiming.segments
    };
  }

  return {
    ...record,
    diagnostics: {
      hasTimingAnomaly: true,
      hasTranslationGap: Boolean(record.diagnostics?.hasTranslationGap),
      logPath: record.diagnostics?.logPath
    },
    segments: normalizedTiming.segments
  };
}

export function selectedRecordSegmentSourceText(segment: SessionRecordSegment) {
  return segment.sourceEditedText ?? segment.sourceText;
}

export function selectedRecordSegmentTargetText(segment: SessionRecordSegment) {
  return segment.targetEditedText ?? segment.targetText;
}
