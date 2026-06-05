export type SegmentStatus = "partial" | "stable" | "committed";

export type CaptionState = "interim" | "stable" | "revised" | "locked";

export type SubtitleEvent = {
  type: "translation.partial";
  session_id: string;
  segment_id: string;
  rev: number;
  source_lang: string;
  target_lang: string;
  source_text: string;
  target_text: string;
  status: SegmentStatus;
  stability: number;
  start_ms: number;
  end_ms: number;
  speaker?: string | null;
};

export type SubtitlePatchOperation =
  | {
      op: "insert";
      at_char: number;
      text: string;
    }
  | {
      op: "replace";
      from_char: number;
      to_char: number;
      text: string;
    }
  | {
      op: "delete";
      from_char: number;
      to_char: number;
    };

export type SubtitlePatchEvent = {
  type: "translation.patch";
  session_id: string;
  segment_id: string;
  rev: number;
  base_rev: number;
  target_lang: string;
  operations: SubtitlePatchOperation[];
  reason: "revision_window" | "context_revision" | "terminology";
  stability: number;
};

export type SubtitleCommitEvent = {
  type: "segment.commit";
  session_id: string;
  segment_id: string;
  rev: number;
  start_ms: number;
  end_ms: number;
  source_lang: string;
  target_lang: string;
  source_text: string;
  target_text: string;
  speaker?: string | null;
  final: boolean;
};

export type TranslatedAudioEvent = {
  type: "translation.audio";
  session_id: string;
  segment_id: string;
  rev: number;
  start_ms: number;
  end_ms: number;
  target_lang: string;
  mime_type: string;
  sample_rate?: number | null;
  final: boolean;
};

export type RealtimeEvent =
  | SubtitleEvent
  | SubtitlePatchEvent
  | SubtitleCommitEvent
  | TranslatedAudioEvent;

export type CaptionPatch = {
  id: string;
  prev: string;
  next: string;
  startChar: number;
  endChar: number;
  atMs: number;
  reason: SubtitlePatchEvent["reason"];
};

export type CaptionLineModel = {
  id: string;
  state: CaptionState;
  sourceText?: string;
  targetText: string;
  confidence?: number;
  startedAtMs: number;
  endedAtMs?: number;
  lockedAtMs?: number;
  patches: CaptionPatch[];
  providerMeta?: Record<string, unknown>;
};
