import {
  selectActiveCaptionLineForDisplay,
  type CaptionLine,
  type CaptionLineDisplayMode
} from "./caption-store";

export type CaptionDisplayPhase = "active" | "readable" | "past";
export type CaptionDisplayLaneName = "source" | "target";

export type CaptionDisplayLane = {
  desiredText: string;
  visibleText: string;
  lastTypedAtMs: number;
  revisedUntilMs: number | null;
};

export type CaptionDisplayEntry = {
  source: CaptionDisplayLane;
  target: CaptionDisplayLane;
  firstSeenAtMs: number;
  lastVisibleAtMs: number;
  phase: CaptionDisplayPhase;
  settledAtMs: number | null;
  dwellUntilMs?: number | null;
};

export type CaptionDisplayBuffer = {
  entries: Record<string, CaptionDisplayEntry>;
};

export type CaptionDisplaySelection = {
  buffer: CaptionDisplayBuffer;
  desiredLines: CaptionLine[];
  displayLag: CaptionDisplayLag;
  lines: CaptionLine[];
  nowMs: number;
  pendingLineIds: string[];
};

export type CaptionDisplayPresentation = {
  activeLine?: CaptionLine;
  settlingLines: CaptionLine[];
  historyLines: CaptionLine[];
};

export type CaptionDisplayLag = {
  max: number;
  sourceMax: number;
  targetMax: number;
  total: number;
};

type LaneTiming = {
  sourceIntervalMs: number;
  targetIntervalMs: number;
  maxSourceCharsPerTick: number;
  maxTargetCharsPerTick: number;
  revisionDecayMs: number;
};

type GraphemeSegmenter = {
  segment: (text: string) => Iterable<{ segment: string }>;
};

const DEFAULT_TIMING: LaneTiming = {
  sourceIntervalMs: 22,
  targetIntervalMs: 36,
  maxSourceCharsPerTick: 3,
  maxTargetCharsPerTick: 2,
  revisionDecayMs: 2000
};
const READABLE_DWELL_BASE_MS = 2200;
const READABLE_DWELL_MIN_MS = 3600;
const READABLE_DWELL_MAX_MS = 9000;
const SOURCE_READ_MS_PER_GRAPHEME = 34;
const TARGET_READ_MS_PER_GRAPHEME = 56;
const SOURCE_READ_MS_CAP = 3200;
const TARGET_READ_MS_CAP = 5200;
const READABLE_FOREGROUND_GRACE_MS = 1300;
const LIVE_SOURCE_CATCH_UP_TRIGGER = 42;
const LIVE_TARGET_CATCH_UP_TRIGGER = 28;
const LIVE_SOURCE_MAX_LAG = 34;
const LIVE_TARGET_MAX_LAG = 18;
const graphemeSegmenter = createGraphemeSegmenter();
const GRAPHEME_CACHE_LIMIT = 2048;
const graphemeCache = new Map<string, string[]>();

export function createInitialCaptionDisplayBuffer(): CaptionDisplayBuffer {
  return { entries: {} };
}

export function selectDisplayCaptionLines(
  buffer: CaptionDisplayBuffer,
  desiredLines: CaptionLine[],
  nowMs: number,
  _options: Record<string, never> = {}
): CaptionDisplaySelection {
  const nextEntries: Record<string, CaptionDisplayEntry> = {};
  const visibleLines: CaptionLine[] = [];
  const pendingLineIds: string[] = [];
  const displayLag: CaptionDisplayLag = {
    max: 0,
    sourceMax: 0,
    targetMax: 0,
    total: 0
  };

  for (const line of desiredLines) {
    const previous = buffer.entries[line.id];
    const entry = updateEntry(previous, line, nowMs);
    nextEntries[line.id] = entry;
    collectDisplayLag(displayLag, entry);

    const visibleLine = withVisibleText(line, entry);
    visibleLines.push(visibleLine);

    if (
      entry.source.visibleText !== entry.source.desiredText ||
      entry.target.visibleText !== entry.target.desiredText ||
      entry.phase === "readable"
    ) {
      pendingLineIds.push(line.id);
    }
  }

  return {
    buffer: { entries: nextEntries },
    desiredLines,
    displayLag,
    lines: visibleLines,
    nowMs,
    pendingLineIds
  };
}

export function selectDisplayCaptionPresentation(
  selection: CaptionDisplaySelection,
  displayMode: CaptionLineDisplayMode
): CaptionDisplayPresentation {
  const activeCandidates = selection.lines.filter((line) => selection.buffer.entries[line.id]?.phase === "active");
  const settlingLines = selection.lines.filter((line) => {
    const entry = selection.buffer.entries[line.id];
    return entry?.phase === "readable" && hasVisibleTextForMode(line, displayMode);
  });
  const historyLines = selection.lines.filter((line) => {
    const entry = selection.buffer.entries[line.id];
    return entry?.phase === "past" && hasVisibleTextForMode(line, displayMode);
  });

  const activeLine = selectActiveCaptionLineForDisplay(activeCandidates, displayMode);
  const foregroundSettlingLine = selectForegroundSettlingLine(settlingLines, selection, activeLine, displayMode);

  return {
    activeLine: foregroundSettlingLine ?? activeLine,
    settlingLines,
    historyLines
  };
}

function updateEntry(previous: CaptionDisplayEntry | undefined, line: CaptionLine, nowMs: number): CaptionDisplayEntry {
  if (!previous) {
    const settledAtMs = line.state === "locked" ? nowMs : null;
    const dwellUntilMs = settledAtMs === null ? null : nowMs + calculateReadableDwellMs(line.sourceText, line.targetText);
    const source = createLane(line.sourceText, nowMs, "source");
    const target = createLane(line.targetText, nowMs, "target");
    return {
      source,
      target,
      firstSeenAtMs: nowMs,
      lastVisibleAtMs: nowMs,
      phase: line.state === "locked" ? selectLockedPhase(dwellUntilMs, nowMs, source, target) : "active",
      settledAtMs,
      dwellUntilMs
    };
  }

  const locked = line.state === "locked";
  const lockedSettledAtMs = previous.settledAtMs ?? nowMs;
  const settledAtMs = locked ? lockedSettledAtMs : null;
  const previousDesiredChanged = previous.source.desiredText !== line.sourceText || previous.target.desiredText !== line.targetText;
  const previousDwellUntilMs = previous.dwellUntilMs ?? lockedSettledAtMs + calculateReadableDwellMs(previous.source.desiredText, previous.target.desiredText);
  const dwellUntilMs = locked
    ? previousDesiredChanged
      ? Math.max(previousDwellUntilMs, nowMs + calculateReadableDwellMs(line.sourceText, line.targetText))
      : previousDwellUntilMs
    : null;
  const source = updateLane(previous.source, line.sourceText, nowMs, "source", locked, line.state === "revised");
  const target = updateLane(previous.target, line.targetText, nowMs, "target", locked, line.state === "revised");
  return {
    source,
    target,
    firstSeenAtMs: previous.firstSeenAtMs,
    lastVisibleAtMs:
      previous.source.visibleText === line.sourceText && previous.target.visibleText === line.targetText
        ? previous.lastVisibleAtMs
        : nowMs,
    phase: locked ? selectLockedPhase(dwellUntilMs, nowMs, source, target) : "active",
    settledAtMs,
    dwellUntilMs
  };
}

function createLane(
  desiredText: string,
  nowMs: number,
  lane: CaptionDisplayLaneName
): CaptionDisplayLane {
  const visibleText = takeGraphemes(desiredText, initialGraphemeBudget(lane));
  return {
    desiredText,
    visibleText,
    lastTypedAtMs: nowMs,
    revisedUntilMs: null
  };
}

function updateLane(
  previous: CaptionDisplayLane,
  desiredText: string,
  nowMs: number,
  lane: CaptionDisplayLaneName,
  flush: boolean,
  revised: boolean
): CaptionDisplayLane {
  const revisedUntilMs = revised ? nowMs + DEFAULT_TIMING.revisionDecayMs : previous.revisedUntilMs;
  const desiredTextForDisplay = selectDesiredTextForDisplay(previous, desiredText, flush, revised);
  if (desiredText === previous.desiredText) {
    const visibleText = advanceVisibleText(previous.visibleText, desiredTextForDisplay, previous.lastTypedAtMs, nowMs, lane, !flush);
    return {
      desiredText,
      visibleText,
      lastTypedAtMs: visibleText === previous.visibleText ? previous.lastTypedAtMs : nowMs,
      revisedUntilMs
    };
  }

  const commonPrefix = longestCommonPrefix(previous.visibleText, desiredTextForDisplay);
  const stablePrefix = previous.visibleText.slice(0, commonPrefix);
  const visibleText = advanceVisibleText(stablePrefix, desiredTextForDisplay, previous.lastTypedAtMs, nowMs, lane, !flush);
  return {
    desiredText: desiredTextForDisplay,
    visibleText,
    lastTypedAtMs: visibleText === previous.visibleText ? previous.lastTypedAtMs : nowMs,
    revisedUntilMs: nowMs + DEFAULT_TIMING.revisionDecayMs
  };
}

function advanceVisibleText(
  currentVisibleText: string,
  desiredText: string,
  lastTypedAtMs: number,
  nowMs: number,
  lane: CaptionDisplayLaneName,
  liveCatchUp: boolean
): string {
  if (currentVisibleText === desiredText) {
    return currentVisibleText;
  }

  const desiredChars = graphemes(desiredText);
  let currentChars = graphemes(currentVisibleText);
  if (!desiredText.startsWith(currentVisibleText)) {
    const commonPrefix = longestCommonGraphemePrefix(currentChars, desiredChars);
    currentChars = currentChars.slice(0, commonPrefix);
    currentVisibleText = currentChars.join("");
  }

  const missing = desiredChars.length - currentChars.length;
  if (missing <= 0) {
    return takeGraphemeSegments(desiredChars, desiredChars.length);
  }

  const elapsedMs = Math.max(nowMs - lastTypedAtMs, 0);
  const interval = lane === "source" ? DEFAULT_TIMING.sourceIntervalMs : DEFAULT_TIMING.targetIntervalMs;
  const maxPerTick = lane === "source" ? DEFAULT_TIMING.maxSourceCharsPerTick : DEFAULT_TIMING.maxTargetCharsPerTick;
  const elapsedBudget = Math.floor(elapsedMs / interval);
  const typewriterBudget = elapsedBudget <= 0 ? 0 : Math.min(elapsedBudget, maxPerTick, missing);
  const catchUpLength = liveCatchUp ? calculateLiveCatchUpLength(desiredChars.length, currentChars.length, lane) : currentChars.length;
  const nextLength = Math.max(currentChars.length + typewriterBudget, catchUpLength);
  if (nextLength <= currentChars.length) {
    return currentVisibleText;
  }
  return takeGraphemeSegments(desiredChars, Math.min(nextLength, desiredChars.length));
}

function calculateLiveCatchUpLength(
  desiredLength: number,
  currentLength: number,
  lane: CaptionDisplayLaneName
): number {
  const missing = desiredLength - currentLength;
  const trigger = lane === "source" ? LIVE_SOURCE_CATCH_UP_TRIGGER : LIVE_TARGET_CATCH_UP_TRIGGER;
  if (missing <= trigger) {
    return currentLength;
  }

  const maxLag = lane === "source" ? LIVE_SOURCE_MAX_LAG : LIVE_TARGET_MAX_LAG;
  return Math.max(currentLength, desiredLength - maxLag);
}

function initialGraphemeBudget(lane: CaptionDisplayLaneName): number {
  return lane === "source" ? 1 : 1;
}

function longestCommonPrefix(a: string, b: string): number {
  const aChars = graphemes(a);
  const bChars = graphemes(b);
  return takeGraphemeSegments(aChars, longestCommonGraphemePrefix(aChars, bChars)).length;
}

function longestCommonGraphemePrefix(aChars: string[], bChars: string[]): number {
  let index = 0;
  while (index < aChars.length && index < bChars.length && aChars[index] === bChars[index]) {
    index += 1;
  }
  return index;
}

function takeGraphemes(text: string, count: number): string {
  return takeGraphemeSegments(graphemes(text), count);
}

function takeGraphemeSegments(chars: string[], count: number): string {
  return chars.slice(0, count).join("");
}

function selectLockedPhase(
  dwellUntilMs: number | null | undefined,
  nowMs: number,
  source: CaptionDisplayLane,
  target: CaptionDisplayLane
): CaptionDisplayPhase {
  const visibleComplete = source.visibleText === source.desiredText && target.visibleText === target.desiredText;
  return visibleComplete && dwellUntilMs !== null && dwellUntilMs !== undefined && nowMs >= dwellUntilMs ? "past" : "readable";
}

function selectDesiredTextForDisplay(
  previous: CaptionDisplayLane,
  desiredText: string,
  flush: boolean,
  revised: boolean
): string {
  if (flush || revised || desiredText.length >= previous.visibleText.length || !previous.visibleText.trim()) {
    return desiredText;
  }

  const severeRestart = desiredText.length <= Math.max(6, Math.floor(previous.visibleText.length * 0.45));
  if (previous.visibleText.startsWith(desiredText) || severeRestart) {
    return previous.desiredText.length >= previous.visibleText.length ? previous.desiredText : previous.visibleText;
  }

  return desiredText;
}

function calculateReadableDwellMs(sourceText: string, targetText: string): number {
  const sourceReadMs = Math.min(SOURCE_READ_MS_CAP, graphemes(sourceText).length * SOURCE_READ_MS_PER_GRAPHEME);
  const targetReadMs = Math.min(TARGET_READ_MS_CAP, graphemes(targetText).length * TARGET_READ_MS_PER_GRAPHEME);
  return clamp(READABLE_DWELL_BASE_MS + Math.max(sourceReadMs, targetReadMs), READABLE_DWELL_MIN_MS, READABLE_DWELL_MAX_MS);
}

function selectForegroundSettlingLine(
  settlingLines: CaptionLine[],
  selection: CaptionDisplaySelection,
  activeLine: CaptionLine | undefined,
  displayMode: CaptionLineDisplayMode
): CaptionLine | undefined {
  if (!activeLine || !hasVisibleTextForMode(activeLine, displayMode)) {
    return selectNewestSettlingLine(settlingLines, selection);
  }

  return selectNewestSettlingLine(settlingLines, selection, READABLE_FOREGROUND_GRACE_MS);
}

function selectNewestSettlingLine(
  settlingLines: CaptionLine[],
  selection: CaptionDisplaySelection,
  maxAgeMs?: number
): CaptionLine | undefined {
  let selectedLine: CaptionLine | undefined;
  let selectedSettledAtMs = Number.NEGATIVE_INFINITY;
  for (const line of settlingLines) {
    const settledAtMs = selection.buffer.entries[line.id]?.settledAtMs;
    if (settledAtMs === null || settledAtMs === undefined) {
      continue;
    }
    if (maxAgeMs !== undefined && selection.nowMs - settledAtMs > maxAgeMs) {
      continue;
    }
    if (settledAtMs >= selectedSettledAtMs) {
      selectedLine = line;
      selectedSettledAtMs = settledAtMs;
    }
  }

  return selectedLine;
}

function collectDisplayLag(displayLag: CaptionDisplayLag, entry: CaptionDisplayEntry) {
  const sourceLag = laneDisplayLag(entry.source);
  const targetLag = laneDisplayLag(entry.target);
  displayLag.sourceMax = Math.max(displayLag.sourceMax, sourceLag);
  displayLag.targetMax = Math.max(displayLag.targetMax, targetLag);
  displayLag.max = Math.max(displayLag.max, sourceLag, targetLag);
  displayLag.total += sourceLag + targetLag;
}

function laneDisplayLag(lane: CaptionDisplayLane): number {
  return Math.max(graphemes(lane.desiredText).length - graphemes(lane.visibleText).length, 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function withVisibleText(line: CaptionLine, entry: CaptionDisplayEntry): CaptionLine {
  const visibleLine: CaptionLine = {
    ...line,
    sourceText: entry.source.visibleText,
    targetText: entry.target.visibleText
  };

  copyHiddenTimestamp(line, visibleLine, "receivedAtMs");
  copyHiddenTimestamp(line, visibleLine, "sourceReceivedAtMs");
  copyHiddenTimestamp(line, visibleLine, "targetReceivedAtMs");
  return visibleLine;
}

function copyHiddenTimestamp(
  source: CaptionLine,
  target: CaptionLine,
  key: "receivedAtMs" | "sourceReceivedAtMs" | "targetReceivedAtMs"
) {
  const value = source[key];
  if (value === undefined) {
    return;
  }

  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: false,
    value,
    writable: true
  });
}

function hasVisibleTextForMode(line: CaptionLine, displayMode: CaptionLineDisplayMode): boolean {
  if (displayMode === "translation") {
    return Boolean(line.targetText.trim());
  }

  if (displayMode === "source") {
    return Boolean(line.sourceText.trim());
  }

  return Boolean(line.sourceText.trim() || line.targetText.trim());
}

function graphemes(text: string): string[] {
  const cached = graphemeCache.get(text);
  if (cached) {
    return cached;
  }
  let segments: string[];
  if (graphemeSegmenter) {
    segments = Array.from(graphemeSegmenter.segment(text), (segment) => segment.segment);
  } else {
    segments = Array.from(text);
  }
  if (graphemeCache.size >= GRAPHEME_CACHE_LIMIT) {
    const oldestKey = graphemeCache.keys().next().value;
    if (oldestKey !== undefined) {
      graphemeCache.delete(oldestKey);
    }
  }
  graphemeCache.set(text, segments);
  return segments;
}

function createGraphemeSegmenter(): GraphemeSegmenter | null {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return new Intl.Segmenter(undefined, { granularity: "grapheme" }) as GraphemeSegmenter;
  }
  return null;
}
