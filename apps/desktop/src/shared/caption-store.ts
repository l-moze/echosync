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

  // 🔍 调试日志：追踪事件处理
  if (typeof console !== "undefined" && event.type !== "tts.audio") {
    console.log("[caption-store] applyRealtimeEvent", {
      type: event.type,
      segment_id: "segment_id" in event ? event.segment_id : undefined,
      rev: "rev" in event ? event.rev : undefined,
      status: "status" in event ? event.status : undefined,
      text_preview: "source_text" in event ? event.source_text?.substring(0, 40) : undefined,
      text_len: "source_text" in event ? event.source_text?.length : undefined,
      lines_count: lines.length,
      timestamp: receivedAtMs
    });
  }

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

    // 修复：commit 时优先使用之前累积的完整文本
    // 如果 previousLine 的文本更长，说明实时流中累积了更多内容，使用累积的
    const finalSourceText = previousLine?.sourceText && previousLine.sourceText.length > event.source_text.length
      ? previousLine.sourceText
      : event.source_text;

    const finalTargetText = previousLine?.targetText && previousLine.targetText.length > event.target_text.length
      ? previousLine.targetText
      : event.target_text;

    // 🔍 调试日志
    if (typeof console !== "undefined" && previousLine) {
      console.log("[caption-store] segment.commit", {
        segment_id: event.segment_id,
        prev_source_len: previousLine.sourceText.length,
        event_source_len: event.source_text.length,
        final_source_len: finalSourceText.length,
        used_previous: finalSourceText === previousLine.sourceText
      });
    }

    const nextLine: CaptionLine = withReceivedAt({
      id: event.segment_id,
      rev: event.rev,
      state: "locked",
      sourceText: finalSourceText,
      targetText: finalTargetText,
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

  // 🔍 关键调试：记录所有可能导致文本丢失的更新
  if (previousLine && typeof console !== "undefined") {
    const logData = {
      timestamp: new Date().toISOString(),
      segment_id: event.segment_id,
      rev: event.rev,
      prev_rev: previousLine.rev,
      prev_text_len: previousLine.sourceText.length,
      prev_text_full: previousLine.sourceText,
      new_text_len: event.source_text.length,
      new_text_full: event.source_text,
      is_longer: event.source_text.length > previousLine.sourceText.length,
      starts_with_prev: event.source_text.startsWith(previousLine.sourceText),
      contains_prev_start: event.source_text.includes(previousLine.sourceText.substring(0, Math.min(20, previousLine.sourceText.length))),
      text_shrink_amount: previousLine.sourceText.length - event.source_text.length
    };

    console.log("[transcript.partial] 行为分析", logData);

    // 如果文本异常缩短 >10 字符，额外记录详细信息
    if (logData.text_shrink_amount > 10) {
      console.error("[transcript.partial] ⚠️ 检测到文本异常缩短！", {
        ...logData,
        alert: "文本从 " + logData.prev_text_len + " 缩短到 " + logData.new_text_len
      });
    }
  }

  if (!previousLine && !event.source_text.trim()) {
    return lines;
  }
  if (previousLine?.state === "locked") {
    return lines;
  }
  if (previousLine && event.rev < previousLine.rev) {
    return lines;
  }

  // 修复：保护已有的更长文本，防止短文本或错误文本覆盖
  let finalSourceText = event.source_text;
  if (previousLine && previousLine.sourceText.length > 0) {
    // 如果新文本明显比旧文本短，且旧文本不是新文本的前缀，保留旧文本
    const prevLen = previousLine.sourceText.length;
    const newLen = event.source_text.length;

    // 情况1：新文本是旧文本的扩展 → 使用新文本
    if (event.source_text.startsWith(previousLine.sourceText)) {
      finalSourceText = event.source_text;
    }
    // 情况2：新文本更长 → 使用新文本
    else if (newLen >= prevLen) {
      finalSourceText = event.source_text;
    }
    // 情况3：新文本短很多（可能是错误） → 保留旧文本
    else if (prevLen > newLen + 10) {
      console.warn("[transcript.partial] 检测到文本异常缩短", {
        segment_id: event.segment_id,
        rev: event.rev,
        prev_len: prevLen,
        new_len: newLen,
        prev_preview: previousLine.sourceText.substring(0, 50),
        new_preview: event.source_text.substring(0, 50),
        action: "保留旧文本"
      });
      finalSourceText = previousLine.sourceText;
    }
    // 情况4：略短，可能是正常修正 → 使用新文本
    else {
      finalSourceText = event.source_text;
    }
  }

  const nextLine: CaptionLine = withReceivedAt({
    id: event.segment_id,
    rev: event.rev,
    state: mapStatus(event.status),
    sourceText: finalSourceText,
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
