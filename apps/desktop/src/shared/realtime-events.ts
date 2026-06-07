export type SegmentStatus = "partial" | "stable" | "committed";
export type CaptionUpdateState = "loading" | "interim" | "stable" | "final";

export type CaptionUpdateText = {
  full_text: string;
  stable_text?: string;
  unstable_text?: string;
  language: string;
};

export type RealtimeEventMetrics = {
  asr_latency_ms?: number;
  asr_queue_wait_ms?: number;
  asr_stream_elapsed_ms?: number;
  asr_audio_lag_ms?: number;
  asr_audio_window_ms?: number;
  asr_stream_rtf?: number;
  asr_rtf?: number;
  caption_send_failures?: number;
  caption_send_ms?: number;
  llm_delta_count?: number;
  llm_request_ms?: number;
  llm_stream_ms?: number;
  llm_ttft_ms?: number;
  merge_wait_ms?: number;
  translation_queue_wait_ms?: number;
  translation_delta_count?: number;
  translation_first_token_ms?: number;
  translation_latency_ms?: number;
  translation_final_ms?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  semantic_revision_latency_ms?: number;
  semantic_revision_changed_chars?: number;
  semantic_revision_trigger_count?: number;
  tts_first_audio_ms?: number;
  tts_queue_wait_ms?: number;
  tts_total_ms?: number;
  tts_audio_chunks?: number;
  tts_audio_bytes?: number;
  tts_failed?: number;
  tts_prefetch_placeholder?: number;
  tts_prefetch_concurrency?: number;
};

export type CaptionUpdateEvent = {
  type: "caption_update";
  session_id: string;
  segment_id: string;
  revision: number;
  state: CaptionUpdateState;
  source: CaptionUpdateText;
  target?: CaptionUpdateText;
  timing: {
    start_ms: number;
    end_ms: number;
  };
  metrics?: RealtimeEventMetrics;
  published_at_ms?: number;
  trace_id?: string;
  span_id?: string;
};

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
  metrics?: RealtimeEventMetrics;
  trace_id?: string;
  span_id?: string;
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
  trace_id?: string;
  span_id?: string;
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
  metrics?: RealtimeEventMetrics;
  published_at_ms?: number;
  trace_id?: string;
  span_id?: string;
};

export type RealtimeErrorEvent = {
  type: "realtime.error";
  session_id: string;
  message: string;
  code?: string;
  published_at_ms?: number;
  trace_id?: string;
  span_id?: string;
};

export type RealtimeDoneEvent = {
  type: "realtime.done";
  session_id: string;
  published_at_ms?: number;
  trace_id?: string;
  span_id?: string;
};

export type TtsAudioEvent = {
  type: "tts.audio";
  session_id: string;
  segment_id: string;
  rev: number;
  start_ms: number;
  end_ms: number;
  target_lang: string;
  audio_base64: string;
  mime_type: string;
  sample_rate: number | null;
  final: boolean;
  metrics?: RealtimeEventMetrics;
  published_at_ms?: number;
  trace_id?: string;
  span_id?: string;
};

export type TtsErrorEvent = {
  type: "tts.error";
  session_id: string;
  segment_id: string;
  rev: number;
  start_ms: number;
  end_ms: number;
  target_lang: string;
  provider?: string;
  message: string;
  code?: string;
  retryable?: boolean;
  target_text?: string;
  metrics?: RealtimeEventMetrics;
  published_at_ms?: number;
  trace_id?: string;
  span_id?: string;
};

export type RealtimeEvent =
  | TranscriptEvent
  | SubtitleEvent
  | CaptionUpdateEvent
  | SubtitlePatchEvent
  | SubtitleCommitEvent
  | TtsAudioEvent
  | TtsErrorEvent
  | RealtimeErrorEvent
  | RealtimeDoneEvent;
