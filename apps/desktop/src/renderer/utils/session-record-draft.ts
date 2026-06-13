import type { SessionArchiveDraft } from "../../shared/session-archive";
import type {
  SessionRecordDraftInput,
  SessionRecordSegment
} from "../../shared/session-records";
import type { LanguageDirectionOption } from "../types/language";

export async function buildSessionRecordDraftInput(
  archive: SessionArchiveDraft,
  {
    averageCaptionLagMs,
    endedAt,
    languageDirection,
    startedAt
  }: {
    averageCaptionLagMs?: number;
    endedAt: string;
    languageDirection: LanguageDirectionOption;
    startedAt: string;
  }
): Promise<SessionRecordDraftInput> {
  return {
    id: archive.id,
    title: archive.title,
    createdAt: archive.createdAt,
    startedAt,
    endedAt,
    durationMs: archive.durationMs,
    sourceLang: languageDirection.sourceLang,
    targetLang: languageDirection.targetLang,
    averageCaptionLagMs,
    audio: archive.audio?.blob
      ? {
          data: await archive.audio.blob.arrayBuffer(),
          mimeType: archive.audio.mimeType
        }
      : undefined,
    timeline: archive.timeline,
    summary: {
      status: "pending",
      text: "",
      keywords: []
    },
    diagnostics: {
      hasTranslationGap: archive.segments.some(
        (segment) => Boolean(segment.sourceText.trim()) && !segment.targetText.trim()
      )
    },
    segments: archive.segments.map((segment): SessionRecordSegment => ({
      id: segment.segmentId,
      startMs: segment.startMs,
      endMs: segment.endMs,
      sourceText: segment.sourceText,
      targetText: segment.targetText,
      revisionState: sessionRecordRevisionState(segment.state),
      patchCount: segment.patchCount
    }))
  };
}

export function sessionRecordRevisionState(
  state: SessionArchiveDraft["segments"][number]["state"]
): SessionRecordSegment["revisionState"] {
  if (state === "locked") {
    return "final";
  }
  if (state === "revised") {
    return "edited";
  }
  return "draft";
}
