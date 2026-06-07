import type {
  CaptionTextEvent,
  CaptionUpdateEvent,
  RealtimeEvent,
  SubtitleEvent,
  SubtitlePatchEvent
} from "./realtime-events";
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
  sourceReceivedAtMs?: number;
  targetReceivedAtMs?: number;
  patchCount: number;
};

export type CaptionLineDisplayMode = "sentencePair" | "zonedPair" | "bilingual" | "source" | "translation";
export const OVERLAY_DISPLAY_WINDOW_LINE_LIMIT = 60;

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

  if (event.type === "caption_update") {
    return upsertCaptionUpdate(lines, event, receivedAtMs);
  }

  if (event.type === "segment.commit") {
    const previousIndex = findLineIndexFromTail(lines, event.segment_id);
    const previousLine = previousIndex === -1 ? undefined : lines[previousIndex];
    const nextLine: CaptionLine = withReceivedAt({
      id: event.segment_id,
      rev: event.rev,
      state: "locked",
      sourceText: event.source_text,
      targetText: event.target_text,
      stability: 1,
      startMs: event.start_ms,
      endMs: event.end_ms,
      patchCount: previousLine?.patchCount ?? 0
    }, receivedAtMs, { previousLine, source: true, target: true });

    if (previousIndex !== -1) {
      return replaceLineAt(lines, previousIndex, nextLine);
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
  return (
    selectLatestCaptionLine(
      lines,
      (line) => Boolean(line.sourceText.trim()),
      (line, index) => line.sourceReceivedAtMs ?? line.receivedAtMs ?? index
    ) ??
    selectLatestCaptionLine(
      lines,
      (line) => Boolean(line.targetText.trim()),
      (line, index) => line.targetReceivedAtMs ?? line.receivedAtMs ?? index
    )
  );
}

export function selectActiveCaptionLineForDisplay(
  lines: CaptionLine[],
  displayMode: CaptionLineDisplayMode
): CaptionLine | undefined {
  if (displayMode === "translation") {
    return selectLatestCaptionLine(
      lines,
      (line) => Boolean(line.targetText.trim()),
      (line, index) => line.targetReceivedAtMs ?? line.receivedAtMs ?? index
    );
  }

  if (displayMode === "source") {
    return (
      selectLatestCaptionLine(
        lines,
        (line) => Boolean(line.sourceText.trim()),
        (line, index) => line.sourceReceivedAtMs ?? line.receivedAtMs ?? index
      ) ?? selectActiveCaptionLine(lines)
    );
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

export function selectOverlayDisplayWindow(
  lines: CaptionLine[],
  activeLineId?: string,
  maxLines = OVERLAY_DISPLAY_WINDOW_LINE_LIMIT
): CaptionLine[] {
  if (maxLines <= 0) {
    return [];
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const recentStart = lines.length - maxLines;
  const recentLines = lines.slice(recentStart);
  if (!activeLineId) {
    return recentLines;
  }

  if (recentLines.some((line) => line.id === activeLineId)) {
    return recentLines;
  }

  if (maxLines === 1) {
    return recentLines;
  }

  const activeLine = findLineBeforeIndex(lines, activeLineId, recentStart);
  if (!activeLine) {
    return recentLines;
  }

  return [activeLine, ...lines.slice(-(maxLines - 1))];
}

function overlayHistoryLimit(layer: OverlayLayer): number {
  void layer;
  return OVERLAY_DISPLAY_WINDOW_LINE_LIMIT;
}

function selectLatestCaptionLine(
  lines: CaptionLine[],
  predicate: (line: CaptionLine) => boolean,
  orderOf: (line: CaptionLine, index: number) => number = (line, index) => line.receivedAtMs ?? index
): CaptionLine | undefined {
  let latestLine: CaptionLine | undefined;
  let latestOrder = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!predicate(line)) {
      continue;
    }
    const order = orderOf(line, index);
    if (order >= latestOrder) {
      latestLine = line;
      latestOrder = order;
    }
  }
  return latestLine;
}

function upsertPartial(lines: CaptionLine[], event: SubtitleEvent, receivedAtMs: number): CaptionLine[] {
  const previousIndex = findLineIndexFromTail(lines, event.segment_id);
  const previousLine = previousIndex === -1 ? undefined : lines[previousIndex];
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
      }, receivedAtMs, { previousLine, target: true });

      return replaceLineAt(lines, previousIndex, nextLine);
    }

    return lines;
  }
  const target = selectTranslationTargetText(previousLine, event);
  const nextLine: CaptionLine = withReceivedAt({
    id: event.segment_id,
    rev: event.rev,
    state: mapStatus(event.status),
    sourceText: selectTranslationSourceText(previousLine, event.source_text),
    targetText: target.text,
    stability: event.stability,
    startMs: event.start_ms,
    endMs: event.end_ms,
    patchCount: previousLine?.patchCount ?? 0
  }, receivedAtMs, {
    previousLine,
    source: !previousLine,
    target: target.accepted
  });

  if (previousIndex !== -1) {
    return replaceLineAt(lines, previousIndex, nextLine);
  }

  return [...lines, nextLine];
}

function upsertTranscriptDraft(lines: CaptionLine[], event: CaptionTextEvent, receivedAtMs: number): CaptionLine[] {
  const previousIndex = findLineIndexFromTail(lines, event.segment_id);
  const previousLine = previousIndex === -1 ? undefined : lines[previousIndex];
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
  }, receivedAtMs, { previousLine, source: true });

  if (previousLine) {
    return replaceLineAt(lines, previousIndex, nextLine);
  }

  return [...lines, nextLine];
}

function upsertCaptionUpdate(lines: CaptionLine[], event: CaptionUpdateEvent, receivedAtMs: number): CaptionLine[] {
  const previousIndex = findLineIndexFromTail(lines, event.segment_id);
  const previousLine = previousIndex === -1 ? undefined : lines[previousIndex];
  const sourceText = event.source.full_text;
  const targetText = event.target?.full_text ?? "";

  if (!previousLine && !sourceText.trim() && !targetText.trim()) {
    return lines;
  }

  if (previousLine?.state === "locked" && event.state !== "final") {
    return lines;
  }

  if (previousLine && event.revision < previousLine.rev) {
    if (previousLine.targetText.trim() === "" && targetText.trim() !== "" && countVisibleCharacters(sourceText) >= 8) {
      const nextLine = withReceivedAt(
        {
          ...previousLine,
          targetText,
          stability: Math.max(previousLine.stability, captionUpdateStability(event))
        },
        receivedAtMs,
        { previousLine, target: true }
      );

      return replaceLineAt(lines, previousIndex, nextLine);
    }

    return lines;
  }

  const target = selectCaptionUpdateTargetText(previousLine, event);
  const nextLine: CaptionLine = withReceivedAt(
    {
      id: event.segment_id,
      rev: event.revision,
      state: mapCaptionUpdateState(event.state),
      sourceText: selectCaptionUpdateSourceText(previousLine, event),
      targetText: target.text,
      stability: captionUpdateStability(event),
      startMs: event.timing.start_ms,
      endMs: event.timing.end_ms,
      patchCount: previousLine?.patchCount ?? 0
    },
    receivedAtMs,
    {
      previousLine,
      source: !previousLine || sourceText !== previousLine.sourceText,
      target: target.accepted
    }
  );

  if (previousIndex !== -1) {
    return replaceLineAt(lines, previousIndex, nextLine);
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
  const index = findLineIndexFromTail(lines, event.segment_id);
  if (index === -1) {
    return lines;
  }
  const line = lines[index];
  if (line.state === "locked" || line.rev !== event.base_rev) {
    return lines;
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

  return replaceLineAt(
    lines,
    index,
    withReceivedAt({
      ...line,
      rev: event.rev,
      state: "revised",
      targetText,
      stability: event.stability,
      patchCount: line.patchCount + event.operations.length
    }, receivedAtMs, { previousLine: line, target: true })
  );
}

function findLineIndexFromTail(lines: CaptionLine[], segmentId: string): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].id === segmentId) {
      return index;
    }
  }
  return -1;
}

function findLineBeforeIndex(lines: CaptionLine[], segmentId: string, beforeIndex: number): CaptionLine | undefined {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    if (lines[index].id === segmentId) {
      return lines[index];
    }
  }
  return undefined;
}

function replaceLineAt(lines: CaptionLine[], index: number, nextLine: CaptionLine): CaptionLine[] {
  const nextLines = lines.slice();
  nextLines[index] = nextLine;
  return nextLines;
}

function withReceivedAt(
  line: CaptionLine,
  receivedAtMs: number,
  options: { previousLine?: CaptionLine; source?: boolean; target?: boolean } = {}
): CaptionLine {
  const sourceReceivedAtMs = options.source ? receivedAtMs : options.previousLine?.sourceReceivedAtMs;
  const targetReceivedAtMs = options.target ? receivedAtMs : options.previousLine?.targetReceivedAtMs;
  Object.defineProperty(line, "receivedAtMs", {
    configurable: true,
    enumerable: false,
    value: receivedAtMs,
    writable: true
  });
  if (sourceReceivedAtMs !== undefined) {
    Object.defineProperty(line, "sourceReceivedAtMs", {
      configurable: true,
      enumerable: false,
      value: sourceReceivedAtMs,
      writable: true
    });
  }
  if (targetReceivedAtMs !== undefined) {
    Object.defineProperty(line, "targetReceivedAtMs", {
      configurable: true,
      enumerable: false,
      value: targetReceivedAtMs,
      writable: true
    });
  }
  return line;
}

function mapStatus(status: SubtitleEvent["status"]): CaptionLineState {
  if (status === "stable" || status === "committed") {
    return "stable";
  }

  return "interim";
}

function mapCaptionUpdateState(state: CaptionUpdateEvent["state"]): CaptionLineState {
  if (state === "final") {
    return "locked";
  }

  if (state === "stable") {
    return "stable";
  }

  return "interim";
}

function captionUpdateStability(event: CaptionUpdateEvent): number {
  if (event.state === "final") {
    return 1;
  }

  if (event.state === "stable") {
    return 0.9;
  }

  if (event.source.stable_text?.trim() || event.target?.stable_text?.trim()) {
    return 0.72;
  }

  return 0.5;
}

function countVisibleCharacters(text: string): number {
  return Array.from(text).filter((char) => char.trim() !== "").length;
}

function selectTranslationSourceText(previousLine: CaptionLine | undefined, sourceText: string): string {
  if (!previousLine) {
    return sourceText;
  }

  if (countVisibleCharacters(sourceText) < countVisibleCharacters(previousLine.sourceText)) {
    return previousLine.sourceText;
  }

  return sourceText;
}

function selectCaptionUpdateSourceText(previousLine: CaptionLine | undefined, event: CaptionUpdateEvent): string {
  if (event.state === "final" || !previousLine) {
    return event.source.full_text;
  }

  return selectTranslationSourceText(previousLine, event.source.full_text);
}

function selectTranslationTargetText(
  previousLine: CaptionLine | undefined,
  event: SubtitleEvent
): { text: string; accepted: boolean } {
  const nextTarget = event.target_text;
  if (!previousLine) {
    return { text: nextTarget, accepted: Boolean(nextTarget.trim()) };
  }

  if (!nextTarget.trim()) {
    return { text: previousLine.targetText, accepted: false };
  }

  if (shouldHoldTransientTargetShrink(previousLine.targetText, nextTarget, event.status)) {
    return { text: previousLine.targetText, accepted: false };
  }

  return { text: nextTarget, accepted: nextTarget !== previousLine.targetText };
}

function selectCaptionUpdateTargetText(
  previousLine: CaptionLine | undefined,
  event: CaptionUpdateEvent
): { text: string; accepted: boolean } {
  const nextTarget = event.target?.full_text ?? "";
  if (!previousLine) {
    return { text: nextTarget, accepted: Boolean(nextTarget.trim()) };
  }

  if (!nextTarget.trim()) {
    return { text: previousLine.targetText, accepted: false };
  }

  if (event.state !== "final" && shouldHoldTransientTargetShrink(previousLine.targetText, nextTarget, "stable")) {
    return { text: previousLine.targetText, accepted: false };
  }

  return { text: nextTarget, accepted: nextTarget !== previousLine.targetText };
}

function shouldHoldTransientTargetShrink(
  previousTarget: string,
  nextTarget: string,
  status: SubtitleEvent["status"]
): boolean {
  if (!previousTarget.trim() || !nextTarget.trim()) {
    return false;
  }

  const previousLength = countVisibleCharacters(previousTarget);
  const nextLength = countVisibleCharacters(nextTarget);
  return nextLength < previousLength;
}
