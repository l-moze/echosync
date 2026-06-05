import type { RealtimeEvent, SubtitleEvent, SubtitlePatchEvent } from "./realtime-events";

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

export function applyRealtimeEvent(lines: CaptionLine[], event: RealtimeEvent): CaptionLine[] {
  if (event.type === "translation.partial") {
    return upsertPartial(lines, event);
  }

  if (event.type === "translation.patch") {
    return applyPatch(lines, event);
  }

  return lines.map((line) =>
    line.id === event.segment_id
      ? {
          ...line,
          rev: event.rev,
          state: "locked",
          sourceText: event.source_text,
          targetText: event.target_text,
          stability: 1,
          startMs: event.start_ms,
          endMs: event.end_ms
        }
      : line
  );
}

function upsertPartial(lines: CaptionLine[], event: SubtitleEvent): CaptionLine[] {
  const previousLine = lines.find((line) => line.id === event.segment_id);
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
