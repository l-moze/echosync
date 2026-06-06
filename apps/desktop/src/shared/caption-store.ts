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
  receivedAtMs?: number;
  patchCount: number;
};

export type CaptionLineDisplayMode = "bilingual" | "source" | "translation";

export function applyRealtimeEvent(lines: CaptionLine[], event: RealtimeEvent): CaptionLine[] {
  const receivedAtMs = Date.now();
  if (event.type === "transcript.partial") {
    return upsertTranscriptDraft(lines, event, receivedAtMs);
  }

  if (event.type === "translation.partial") {
    return upsertPartial(lines, event, receivedAtMs);
  }

  if (event.type === "translation.patch") {
    return applyPatch(lines, event, receivedAtMs);
  }

  if (event.type === "segment.commit") {
    const nextLine: CaptionLine = withReceivedAt({
      id: event.segment_id,
      rev: event.rev,
      state: "locked",
      sourceText: event.source_text,
      targetText: event.target_text,
      stability: 1,
      startMs: event.start_ms,
      endMs: event.end_ms,
      patchCount: lines.find((line) => line.id === event.segment_id)?.patchCount ?? 0
    }, receivedAtMs);

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
  return selectLatestCaptionLine(lines, (line) => Boolean(line.sourceText || line.targetText));
}

export function selectActiveCaptionLineForDisplay(
  lines: CaptionLine[],
  displayMode: CaptionLineDisplayMode
): CaptionLine | undefined {
  if (displayMode === "translation") {
    return selectLatestCaptionLine(lines, (line) => Boolean(line.targetText.trim()));
  }

  if (displayMode === "source") {
    return selectLatestCaptionLine(lines, (line) => Boolean(line.sourceText.trim())) ?? selectActiveCaptionLine(lines);
  }

  return selectActiveCaptionLine(lines);
}

export function selectOverlayHistoryLines(
  layer: OverlayLayer,
  lines: CaptionLine[],
  activeLineId?: string,
  maxLines = overlayHistoryLimit(layer)
): CaptionLine[] {
  const candidates = lines.filter((line) => (line.sourceText || line.targetText) && line.id !== activeLineId);
  if (layer === "default") {
    return candidates.filter((line) => line.state === "locked" || line.targetText.trim()).slice(-1);
  }
  return candidates.slice(-maxLines);
}

export function selectOverlayHistoryLinesForDisplay(
  layer: OverlayLayer,
  lines: CaptionLine[],
  activeLineId: string | undefined,
  displayMode: CaptionLineDisplayMode,
  maxLines = overlayHistoryLimit(layer)
): CaptionLine[] {
  if (displayMode === "translation") {
    return selectOverlayHistoryLines(
      layer,
      lines.filter((line) => Boolean(line.targetText.trim())),
      activeLineId,
      maxLines
    );
  }

  if (displayMode === "source") {
    return selectOverlayHistoryLines(
      layer,
      lines.filter((line) => Boolean(line.sourceText.trim())),
      activeLineId,
      maxLines
    );
  }

  return selectOverlayHistoryLines(layer, lines, activeLineId, maxLines);
}

function overlayHistoryLimit(layer: OverlayLayer): number {
  if (layer === "pinned") {
    return 24;
  }
  if (layer === "controls" || layer === "settings") {
    return 10;
  }
  return 1;
}

function selectLatestCaptionLine(
  lines: CaptionLine[],
  predicate: (line: CaptionLine) => boolean
): CaptionLine | undefined {
  return lines.reduce<{ line: CaptionLine; order: number } | undefined>((latest, line, index) => {
    if (!predicate(line)) {
      return latest;
    }
    const order = line.receivedAtMs ?? index;
    if (!latest || order >= latest.order) {
      return { line, order };
    }
    return latest;
  }, undefined)?.line;
}

function upsertPartial(lines: CaptionLine[], event: SubtitleEvent, receivedAtMs: number): CaptionLine[] {
  const previousLine = lines.find((line) => line.id === event.segment_id);
  if (!previousLine && shouldHideSourceOnlyDraft(event)) {
    return lines;
  }
  if (previousLine?.state === "locked") {
    return lines;
  }
  if (previousLine && event.rev < previousLine.rev) {
    if (canFillEmptyTargetFromStaleTranslation(previousLine, event)) {
      const nextLine = withReceivedAt({
        ...previousLine,
        targetText: event.target_text,
        stability: Math.max(previousLine.stability, event.stability)
      }, receivedAtMs);

      return lines.map((line) => (line.id === event.segment_id ? nextLine : line));
    }

    return lines;
  }
  const nextLine: CaptionLine = withReceivedAt({
    id: event.segment_id,
    rev: event.rev,
    state: mapStatus(event.status),
    sourceText: event.source_text,
    targetText: event.target_text || previousLine?.targetText || "",
    stability: event.stability,
    startMs: event.start_ms,
    endMs: event.end_ms,
    patchCount: previousLine?.patchCount ?? 0
  }, receivedAtMs);

  if (lines.some((line) => line.id === event.segment_id)) {
    return lines.map((line) => (line.id === event.segment_id ? nextLine : line));
  }

  return [...lines, nextLine];
}

function upsertTranscriptDraft(lines: CaptionLine[], event: CaptionTextEvent, receivedAtMs: number): CaptionLine[] {
  const previousLine = lines.find((line) => line.id === event.segment_id);
  if (!previousLine && !event.source_text.trim()) {
    return lines;
  }
  if (previousLine?.state === "locked") {
    return lines;
  }
  if (previousLine && event.rev < previousLine.rev) {
    return lines;
  }

  const nextLine: CaptionLine = withReceivedAt({
    id: event.segment_id,
    rev: event.rev,
    state: mapStatus(event.status),
    sourceText: event.source_text,
    targetText: previousLine?.targetText ?? "",
    stability: event.stability,
    startMs: event.start_ms,
    endMs: event.end_ms,
    patchCount: previousLine?.patchCount ?? 0
  }, receivedAtMs);

  if (previousLine) {
    return lines.map((line) => (line.id === event.segment_id ? nextLine : line));
  }

  return [...lines, nextLine];
}

function shouldHideSourceOnlyDraft(event: CaptionTextEvent): boolean {
  return event.status === "partial" && event.target_text.trim() === "";
}

function canFillEmptyTargetFromStaleTranslation(
  previousLine: CaptionLine,
  event: SubtitleEvent
): boolean {
  return (
    previousLine.targetText.trim() === "" &&
    event.target_text.trim() !== "" &&
    countVisibleCharacters(event.source_text) >= 8
  );
}

function applyPatch(lines: CaptionLine[], event: SubtitlePatchEvent, receivedAtMs: number): CaptionLine[] {
  return lines.map((line) => {
    if (line.id !== event.segment_id) {
      return line;
    }
    if (line.state === "locked" || line.rev !== event.base_rev) {
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

    return withReceivedAt({
      ...line,
      rev: event.rev,
      state: "revised",
      targetText,
      stability: event.stability,
      patchCount: line.patchCount + event.operations.length
    }, receivedAtMs);
  });
}

function withReceivedAt(line: CaptionLine, receivedAtMs: number): CaptionLine {
  Object.defineProperty(line, "receivedAtMs", {
    configurable: true,
    enumerable: false,
    value: receivedAtMs,
    writable: true
  });
  return line;
}

function mapStatus(status: SubtitleEvent["status"]): CaptionLineState {
  if (status === "stable" || status === "committed") {
    return "stable";
  }

  return "interim";
}

function countVisibleCharacters(text: string): number {
  return Array.from(text).filter((char) => char.trim() !== "").length;
}
