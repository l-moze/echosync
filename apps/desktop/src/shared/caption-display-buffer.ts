import type { CaptionLine } from "./caption-store";

export type CaptionDisplayEntry = {
  sourceText: string;
  targetText: string;
  firstSeenAtMs: number;
  lastVisibleAtMs: number;
};

export type CaptionDisplayBuffer = {
  entries: Record<string, CaptionDisplayEntry>;
};

export type CaptionDisplaySelection = {
  buffer: CaptionDisplayBuffer;
  lines: CaptionLine[];
  pendingLineIds: string[];
};

type CaptionDisplayOptions = {
  initialHoldMs: number;
  deltaHoldMs: number;
  minInitialGraphemes: number;
  minDeltaGraphemes: number;
  maxAppendGraphemes: number;
};

const DEFAULT_DISPLAY_OPTIONS: CaptionDisplayOptions = {
  initialHoldMs: 140,
  deltaHoldMs: 80,
  minInitialGraphemes: 6,
  minDeltaGraphemes: 6,
  maxAppendGraphemes: 6
};

const FLUSH_PUNCTUATION = /[。！？!?，,；;：:]$/;

export function createInitialCaptionDisplayBuffer(): CaptionDisplayBuffer {
  return { entries: {} };
}

export function selectDisplayCaptionLines(
  buffer: CaptionDisplayBuffer,
  desiredLines: CaptionLine[],
  nowMs: number,
  options: Partial<CaptionDisplayOptions> = {}
): CaptionDisplaySelection {
  const resolvedOptions = { ...DEFAULT_DISPLAY_OPTIONS, ...options };
  const nextEntries: Record<string, CaptionDisplayEntry> = {};
  const pendingLineIds: string[] = [];
  const lines = desiredLines.map((line) => {
    const previous = buffer.entries[line.id];
    const entry = nextDisplayEntry(previous, line, nowMs, resolvedOptions);
    nextEntries[line.id] = entry;
    if (entry.targetText !== line.targetText) {
      pendingLineIds.push(line.id);
    }
    return {
      ...line,
      sourceText: entry.sourceText,
      targetText: entry.targetText
    };
  });

  return {
    buffer: { entries: nextEntries },
    lines,
    pendingLineIds
  };
}

function nextDisplayEntry(
  previous: CaptionDisplayEntry | undefined,
  line: CaptionLine,
  nowMs: number,
  options: CaptionDisplayOptions
): CaptionDisplayEntry {
  if (!previous) {
    return createEntry(line, nowMs, options);
  }

  const targetText = nextVisibleTarget(previous, line, nowMs, options);
  return {
    sourceText: line.sourceText,
    targetText,
    firstSeenAtMs: previous.firstSeenAtMs,
    lastVisibleAtMs: targetText === previous.targetText ? previous.lastVisibleAtMs : nowMs
  };
}

function createEntry(line: CaptionLine, nowMs: number, options: CaptionDisplayOptions): CaptionDisplayEntry {
  const targetText = shouldShowInitialTarget(line, nowMs, nowMs, options) ? line.targetText : "";
  return {
    sourceText: line.sourceText,
    targetText,
    firstSeenAtMs: nowMs,
    lastVisibleAtMs: targetText ? nowMs : 0
  };
}

function nextVisibleTarget(
  previous: CaptionDisplayEntry,
  line: CaptionLine,
  nowMs: number,
  options: CaptionDisplayOptions
): string {
  if (line.state === "locked") {
    return line.targetText;
  }

  if (!line.targetText) {
    return "";
  }

  if (!previous.targetText) {
    return shouldShowInitialTarget(line, previous.firstSeenAtMs, nowMs, options) ? line.targetText : "";
  }

  if (line.targetText === previous.targetText) {
    return previous.targetText;
  }

  if (!line.targetText.startsWith(previous.targetText)) {
    return line.targetText;
  }

  const delta = line.targetText.slice(previous.targetText.length);
  if (!shouldShowDelta(delta, line.targetText, previous.lastVisibleAtMs, nowMs, options)) {
    return previous.targetText;
  }

  return appendGraphemeChunk(previous.targetText, line.targetText, options.maxAppendGraphemes);
}

function shouldShowInitialTarget(
  line: CaptionLine,
  firstSeenAtMs: number,
  nowMs: number,
  options: CaptionDisplayOptions
): boolean {
  return (
    line.state === "locked" ||
    endsWithFlushPunctuation(line.targetText) ||
    visibleGraphemeCount(line.targetText) >= options.minInitialGraphemes ||
    nowMs - firstSeenAtMs >= options.initialHoldMs
  );
}

function shouldShowDelta(
  delta: string,
  nextTargetText: string,
  lastVisibleAtMs: number,
  nowMs: number,
  options: CaptionDisplayOptions
): boolean {
  return (
    endsWithFlushPunctuation(nextTargetText) ||
    visibleGraphemeCount(delta) >= options.minDeltaGraphemes ||
    nowMs - lastVisibleAtMs >= options.deltaHoldMs
  );
}

function appendGraphemeChunk(previousText: string, desiredText: string, maxAppendGraphemes: number): string {
  const graphemes = splitGraphemes(desiredText);
  const previousLength = splitGraphemes(previousText).length;
  let visibleBudget = maxAppendGraphemes;
  let endIndex = previousLength;

  while (endIndex < graphemes.length && visibleBudget > 0) {
    const grapheme = graphemes[endIndex];
    endIndex += 1;
    if (countsAgainstAppendBudget(grapheme)) {
      visibleBudget -= 1;
    }
  }

  while (endIndex < graphemes.length && !countsAgainstAppendBudget(graphemes[endIndex])) {
    endIndex += 1;
  }

  return graphemes.slice(0, endIndex).join("");
}

function visibleGraphemeCount(value: string): number {
  return splitGraphemes(value).filter((item) => item.trim()).length;
}

function countsAgainstAppendBudget(value: string): boolean {
  return Boolean(value.trim()) && !/^[\p{P}\p{S}]$/u.test(value);
}

function splitGraphemes(value: string): string[] {
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: "grapheme" }
      ) => { segment(input: string): Iterable<{ segment: string }> };
    }
  ).Segmenter;

  if (!Segmenter) {
    return Array.from(value);
  }

  return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(value), (item) => item.segment);
}

function endsWithFlushPunctuation(value: string): boolean {
  return FLUSH_PUNCTUATION.test(value.trim());
}
