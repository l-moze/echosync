export type SegmentStatus = "partial" | "stable" | "committed";

export type CaptionTextEvent = {
  session_id: string;
  segment_id: string;
  rev: number;
  source_lang: string;
  target_lang: string;
  source_text: string;
  target_text: string;
  source_stable_text?: string;
  source_unstable_text?: string;
  target_stable_text?: string;
  target_unstable_text?: string;
  status: SegmentStatus;
  stability: number;
  start_ms: number;
  end_ms: number;
  speaker?: string | null;
  published_at_ms?: number;
  metrics?: {
    asr_latency_ms?: number;
    merge_wait_ms?: number;
    translation_delta_count?: number;
    translation_first_token_ms?: number;
    translation_latency_ms?: number;
  };
};

export type SubtitleEvent = CaptionTextEvent & {
  type: "translation.partial";
};

export type TranscriptEvent = CaptionTextEvent & {
  type: "transcript.partial";
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
  published_at_ms?: number;
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
  source_stable_text?: string;
  source_unstable_text?: string;
  target_stable_text?: string;
  target_unstable_text?: string;
  speaker?: string | null;
  final: boolean;
  published_at_ms?: number;
};

export type RealtimeErrorEvent = {
  type: "realtime.error";
  session_id: string;
  message: string;
  published_at_ms?: number;
};

export type RealtimeDoneEvent = {
  type: "realtime.done";
  session_id: string;
  published_at_ms?: number;
};

export type RealtimeEvent =
  | TranscriptEvent
  | SubtitleEvent
  | SubtitlePatchEvent
  | SubtitleCommitEvent
  | RealtimeErrorEvent
  | RealtimeDoneEvent;
