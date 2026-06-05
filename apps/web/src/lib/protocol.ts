export type SegmentStatus = "partial" | "stable" | "committed";

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
