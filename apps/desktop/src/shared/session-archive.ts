import type { CaptionLine, CaptionLineState } from "./caption-store";

export type SessionArchiveSegment = {
  segmentId: string;
  startMs: number;
  endMs: number;
  sourceText: string;
  targetText: string;
  state: CaptionLineState;
  patchCount: number;
};

export type SessionArchiveDraft = {
  id: string;
  title: string;
  createdAt: string;
  durationMs: number;
  audio: {
    mimeType: string;
    objectUrl: string;
  };
  segments: SessionArchiveSegment[];
};

export type BuildSessionArchiveDraftInput = {
  id: string;
  title: string;
  createdAt: string;
  durationMs: number;
  audioMimeType: string;
  audioObjectUrl: string;
  lines: CaptionLine[];
};

export function sessionArchiveTitleFromDate(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}年${month}月${day}日_记录`;
}

export function buildSessionArchiveDraft({
  audioMimeType,
  audioObjectUrl,
  createdAt,
  durationMs,
  id,
  lines,
  title
}: BuildSessionArchiveDraftInput): SessionArchiveDraft {
  return {
    id,
    title,
    createdAt,
    durationMs,
    audio: {
      mimeType: audioMimeType,
      objectUrl: audioObjectUrl
    },
    segments: lines.map((line) => ({
      segmentId: line.id,
      startMs: line.startMs,
      endMs: line.endMs,
      sourceText: line.sourceText,
      targetText: line.targetText,
      state: line.state,
      patchCount: line.patchCount
    }))
  };
}

export function selectPlaybackSegmentId(lines: CaptionLine[], currentMs: number): string | null {
  const active = lines.find((line) => currentMs >= line.startMs && currentMs < line.endMs);
  return active?.id ?? null;
}
