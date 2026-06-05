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
  for (const line of desiredLines) {
    const previous = buffer.entries[line.id];
    const entry = {
      sourceText: line.sourceText,
      targetText: line.targetText,
      firstSeenAtMs: previous?.firstSeenAtMs ?? nowMs,
      lastVisibleAtMs: previous?.targetText === line.targetText ? previous.lastVisibleAtMs : nowMs
    };
    nextEntries[line.id] = entry;
  }

  return {
    buffer: { entries: nextEntries },
    lines: desiredLines,
    pendingLineIds: []
  };
}
