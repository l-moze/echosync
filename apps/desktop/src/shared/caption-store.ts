import type { CaptionTextEvent, RealtimeEvent, SubtitleEvent, SubtitlePatchEvent } from "./realtime-events";
import type { OverlayLayer } from "./overlay-interaction";

export type CaptionLineState = "interim" | "stable" | "revised" | "locked";

export type CaptionLine = {
  id: string;
  rev: number;
  state: CaptionLineState;
  sourceText: string;
  targetText: string;
  stability: number;
  startMs: number;
  endMs: number;
  patchCount: number;
};

const MIN_SOURCE_DRAFT_CHARS = 4;
const TARGET_FLUSH_PUNCTUATION = /[。！？!?，,；;：:]$/;

export function applyRealtimeEvent(lines: CaptionLine[], event: RealtimeEvent): CaptionLine[] {
  if (event.type === "transcript.partial") {
    return upsertTranscriptDraft(lines, event);
  }

  if (event.type === "translation.partial") {
    return upsertPartial(lines, event);
  }

  if (event.type === "translation.patch") {
    return applyPatch(lines, event);
  }

  if (event.type === "segment.commit") {
    const nextLine: CaptionLine = {
      id: event.segment_id,
      rev: event.rev,
      state: "locked",
      sourceText: event.source_text,
      targetText: event.target_text,
      stability: 1,
      startMs: event.start_ms,
      endMs: event.end_ms,
      patchCount: lines.find((line) => line.id === event.segment_id)?.patchCount ?? 0
    };

    if (lines.some((line) => line.id === event.segment_id)) {
      return lines.map((line) => (line.id === event.segment_id ? nextLine : line));
    }

    return [...lines, nextLine];
  }

  return lines;
}

export function isRealtimeEventForActiveSession(
  activeSessionId: string | null,
  event: RealtimeEvent,
  sharedSessionId?: string
): boolean {
  const sessionId = activeSessionId ?? sharedSessionId ?? null;
  return sessionId !== null && event.session_id === sessionId;
}

export function selectActiveCaptionLine(lines: CaptionLine[]): CaptionLine | undefined {
  const latestWithTarget = [...lines].reverse().find((line) => line.targetText.trim());
  return latestWithTarget ?? [...lines].reverse().find((line) => line.sourceText || line.targetText);
}

export function selectOverlayHistoryLines(layer: OverlayLayer, lines: CaptionLine[], maxLines = 6): CaptionLine[] {
  if (layer === "default") {
    return [];
  }
  return lines.filter((line) => line.sourceText || line.targetText).slice(-maxLines);
}

function upsertPartial(lines: CaptionLine[], event: SubtitleEvent): CaptionLine[] {
  const previousLine = lines.find((line) => line.id === event.segment_id);
  if (!previousLine && shouldHideSourceOnlyDraft(event)) {
    return lines;
  }
  if (previousLine && event.rev < previousLine.rev) {
    return lines;
  }
  const nextLine: CaptionLine = {
    id: event.segment_id,
    rev: event.rev,
    state: mapStatus(event.status),
    sourceText: event.source_text,
    targetText: event.target_text || previousLine?.targetText || "",
    stability: event.stability,
    startMs: event.start_ms,
    endMs: event.end_ms,
    patchCount: previousLine?.patchCount ?? 0
  };

  if (lines.some((line) => line.id === event.segment_id)) {
    return lines.map((line) => (line.id === event.segment_id ? nextLine : line));
  }

  return [...lines, nextLine];
}

function upsertTranscriptDraft(lines: CaptionLine[], event: CaptionTextEvent): CaptionLine[] {
  const previousLine = lines.find((line) => line.id === event.segment_id);
  if (!previousLine && shouldHoldInitialSourceDraft(event)) {
    return lines;
  }
  if (previousLine && event.rev < previousLine.rev) {
    return lines;
  }

  const nextLine: CaptionLine = {
    id: event.segment_id,
    rev: event.rev,
    state: mapStatus(event.status),
    sourceText: event.source_text,
    targetText: previousLine?.targetText ?? "",
    stability: event.stability,
    startMs: event.start_ms,
    endMs: event.end_ms,
    patchCount: previousLine?.patchCount ?? 0
  };

  if (previousLine) {
    return lines.map((line) => (line.id === event.segment_id ? nextLine : line));
  }

  return [...lines, nextLine];
}

function shouldHideSourceOnlyDraft(event: CaptionTextEvent): boolean {
  return event.status === "partial" && event.target_text.trim() === "";
}

function shouldHoldInitialSourceDraft(event: CaptionTextEvent): boolean {
  const sourceText = event.source_text.trim();
  if (event.status === "committed") {
    return false;
  }
  if (!sourceText) {
    return true;
  }
  return countDisplayChars(sourceText) < MIN_SOURCE_DRAFT_CHARS && !endsWithFlushPunctuation(sourceText);
}

function countDisplayChars(value: string): number {
  return Array.from(value.replace(/\s+/g, "")).length;
}

function endsWithFlushPunctuation(value: string): boolean {
  return TARGET_FLUSH_PUNCTUATION.test(value.trim());
}

function applyPatch(lines: CaptionLine[], event: SubtitlePatchEvent): CaptionLine[] {
  return lines.map((line) => {
    if (line.id !== event.segment_id) {
      return line;
    }

    const targetText = event.operations.reduce((text, operation) => {
      if (operation.op === "replace") {
        return `${text.slice(0, operation.from_char)}${operation.text}${text.slice(operation.to_char)}`;
      }

      if (operation.op === "insert") {
        return `${text.slice(0, operation.at_char)}${operation.text}${text.slice(operation.at_char)}`;
      }

      return `${text.slice(0, operation.from_char)}${text.slice(operation.to_char)}`;
    }, line.targetText);

    return {
      ...line,
      rev: event.rev,
      state: "revised",
      targetText,
      stability: event.stability,
      patchCount: line.patchCount + event.operations.length
    };
  });
}

function mapStatus(status: SubtitleEvent["status"]): CaptionLineState {
  if (status === "committed") {
    return "locked";
  }

  if (status === "stable") {
    return "stable";
  }

  return "interim";
}
