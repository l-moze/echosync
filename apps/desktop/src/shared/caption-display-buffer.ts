import type { CaptionLine } from "./caption-store";

export type CaptionDisplayPhase = "active" | "settling" | "history";
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
};

export type CaptionDisplayBuffer = {
  entries: Record<string, CaptionDisplayEntry>;
};

export type CaptionDisplaySelection = {
  buffer: CaptionDisplayBuffer;
  desiredLines: CaptionLine[];
  lines: CaptionLine[];
  pendingLineIds: string[];
};

type LaneTiming = {
  sourceIntervalMs: number;
  targetIntervalMs: number;
  maxSourceCharsPerTick: number;
  maxTargetCharsPerTick: number;
  revisionDecayMs: number;
};

const DEFAULT_TIMING: LaneTiming = {
  sourceIntervalMs: 22,
  targetIntervalMs: 36,
  maxSourceCharsPerTick: 3,
  maxTargetCharsPerTick: 2,
  revisionDecayMs: 2000
};

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

  for (const line of desiredLines) {
    const previous = buffer.entries[line.id];
    const entry = updateEntry(previous, line, nowMs);
    nextEntries[line.id] = entry;

    const visibleLine = {
      ...line,
      sourceText: entry.source.visibleText,
      targetText: entry.target.visibleText
    };
    visibleLines.push(visibleLine);

    if (entry.source.visibleText !== entry.source.desiredText || entry.target.visibleText !== entry.target.desiredText) {
      pendingLineIds.push(line.id);
    }
  }

  return {
    buffer: { entries: nextEntries },
    desiredLines,
    lines: visibleLines,
    pendingLineIds
  };
}

function updateEntry(previous: CaptionDisplayEntry | undefined, line: CaptionLine, nowMs: number): CaptionDisplayEntry {
  if (!previous) {
    return {
      source: createLane(line.sourceText, nowMs, "source", line.state === "locked"),
      target: createLane(line.targetText, nowMs, "target", line.state === "locked"),
      firstSeenAtMs: nowMs,
      lastVisibleAtMs: nowMs,
      phase: line.state === "locked" ? "settling" : "active",
      settledAtMs: line.state === "locked" ? nowMs : null
    };
  }

  const locked = line.state === "locked";
  return {
    source: updateLane(previous.source, line.sourceText, nowMs, "source", locked, line.state === "revised"),
    target: updateLane(previous.target, line.targetText, nowMs, "target", locked, line.state === "revised"),
    firstSeenAtMs: previous.firstSeenAtMs,
    lastVisibleAtMs:
      previous.source.visibleText === line.sourceText && previous.target.visibleText === line.targetText
        ? previous.lastVisibleAtMs
        : nowMs,
    phase: locked ? "settling" : previous.phase === "history" ? "history" : "active",
    settledAtMs: locked ? previous.settledAtMs ?? nowMs : null
  };
}

function createLane(
  desiredText: string,
  nowMs: number,
  lane: CaptionDisplayLaneName,
  flush: boolean
): CaptionDisplayLane {
  const visibleText = flush ? desiredText : takeGraphemes(desiredText, initialGraphemeBudget(lane));
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
  if (flush) {
    return {
      desiredText,
      visibleText: desiredText,
      lastTypedAtMs: nowMs,
      revisedUntilMs: revised ? nowMs + DEFAULT_TIMING.revisionDecayMs : previous.revisedUntilMs
    };
  }

  const revisedUntilMs = revised ? nowMs + DEFAULT_TIMING.revisionDecayMs : previous.revisedUntilMs;
  if (desiredText === previous.desiredText) {
    return {
      desiredText,
      visibleText: advanceVisibleText(previous.visibleText, desiredText, previous.lastTypedAtMs, nowMs, lane),
      lastTypedAtMs: nowMs,
      revisedUntilMs
    };
  }

  const commonPrefix = longestCommonPrefix(previous.visibleText, desiredText);
  const stablePrefix = previous.visibleText.slice(0, commonPrefix);
  const visibleText = advanceVisibleText(stablePrefix, desiredText, previous.lastTypedAtMs, nowMs, lane);
  return {
    desiredText,
    visibleText,
    lastTypedAtMs: nowMs,
    revisedUntilMs: nowMs + DEFAULT_TIMING.revisionDecayMs
  };
}

function advanceVisibleText(
  currentVisibleText: string,
  desiredText: string,
  lastTypedAtMs: number,
  nowMs: number,
  lane: CaptionDisplayLaneName
): string {
  if (currentVisibleText === desiredText) {
    return currentVisibleText;
  }

  if (!desiredText.startsWith(currentVisibleText)) {
    const commonPrefix = longestCommonPrefix(currentVisibleText, desiredText);
    currentVisibleText = currentVisibleText.slice(0, commonPrefix);
  }

  const currentLength = graphemes(currentVisibleText).length;
  const desiredLength = graphemes(desiredText).length;
  const missing = desiredLength - currentLength;
  if (missing <= 0) {
    return takeGraphemes(desiredText, desiredLength);
  }

  const elapsedMs = Math.max(nowMs - lastTypedAtMs, 0);
  const interval = lane === "source" ? DEFAULT_TIMING.sourceIntervalMs : DEFAULT_TIMING.targetIntervalMs;
  const maxPerTick = lane === "source" ? DEFAULT_TIMING.maxSourceCharsPerTick : DEFAULT_TIMING.maxTargetCharsPerTick;
  const elapsedBudget = Math.floor(elapsedMs / interval);
  if (elapsedBudget <= 0) {
    return currentVisibleText;
  }
  const budget = Math.min(elapsedBudget, maxPerTick, missing);
  return takeGraphemes(desiredText, currentLength + budget);
}

function initialGraphemeBudget(lane: CaptionDisplayLaneName): number {
  return lane === "source" ? 1 : 1;
}

function longestCommonPrefix(a: string, b: string): number {
  const aChars = graphemes(a);
  const bChars = graphemes(b);
  let index = 0;
  while (index < aChars.length && index < bChars.length && aChars[index] === bChars[index]) {
    index += 1;
  }
  return aChars.slice(0, index).join("").length;
}

function takeGraphemes(text: string, count: number): string {
  return graphemes(text).slice(0, count).join("");
}

function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (segment) => segment.segment);
  }
  return Array.from(text);
}
