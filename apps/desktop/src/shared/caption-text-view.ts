import type { CaptionLine } from "./caption-store";
import { normalizeSubtitleDisplayMode, type SubtitleStyleState } from "./subtitle-style-state";

export type CaptionTextPart = {
  kind: "source" | "target";
  text: string;
  state: CaptionLine["state"];
  isPlaceholder?: boolean;
};

export type CaptionTextBlock = {
  id: string;
  sourceText: string;
  targetText: string;
  state: CaptionLine["state"];
  isSourcePlaceholder?: boolean;
  isTargetPlaceholder?: boolean;
};

const SOURCE_SOFT_BLOCK_CHARS = 112;
const TARGET_SOFT_BLOCK_CHARS = 44;
const SOURCE_HARD_BLOCK_CHARS = 148;
const TARGET_HARD_BLOCK_CHARS = 64;
const SOURCE_DISCOURSE_BOUNDARY = /\s+(?=(?:I would|I think|I mean|That is|This is|And|But|So|Now|Then)\b)/g;

export function selectCaptionTextParts(
  line: CaptionLine | undefined,
  subtitleStyle: SubtitleStyleState
): CaptionTextPart[] {
  const block = selectCaptionTextBlocks(line, subtitleStyle)[0];
  const source: CaptionTextPart = {
    kind: "source",
    text: block.sourceText,
    state: block.state,
    isPlaceholder: block.isSourcePlaceholder
  };
  const target: CaptionTextPart | null = block.targetText || block.isTargetPlaceholder
    ? {
        kind: "target",
        text: block.targetText,
        state: block.state,
        isPlaceholder: block.isTargetPlaceholder
      }
    : null;

  return target ? [source, target] : [source];
}

export function selectCaptionTextBlocks(
  line: CaptionLine | undefined,
  subtitleStyle: SubtitleStyleState
): CaptionTextBlock[] {
  if (!line) {
    return [
      {
        id: "placeholder",
        sourceText: "等待音频输入...",
        targetText: "等待 Windows 系统声音或麦克风输入",
        state: "interim"
      }
    ];
  }

  const sourceText = line.sourceText.trim();
  const targetText = line.targetText.trim();
  const displayMode = normalizeSubtitleDisplayMode(subtitleStyle.displayMode);
  if (displayMode === "zonedPair") {
    return [
      {
        id: `${line.id}:zone`,
        sourceText: sourceText || "等待音频输入...",
        targetText,
        state: line.state,
        isSourcePlaceholder: !sourceText,
        isTargetPlaceholder: !targetText
      }
    ];
  }

  const sourceBlocks = splitDisplayBlocks(sourceText || "等待音频输入...", "source");
  const targetBlocks = targetText ? splitDisplayBlocks(targetText, "target") : [];
  const blockCount = Math.max(1, sourceBlocks.length, targetBlocks.length);

  return Array.from({ length: blockCount }, (_, index) => {
    const sourceBlock = sourceBlocks[index] ?? "";
    const targetBlock = targetBlocks[index] ?? "";
    return {
      id: `${line.id}:block:${index}`,
      sourceText: sourceBlock,
      targetText: targetBlock,
      state: line.state,
      isSourcePlaceholder: !sourceBlock,
      isTargetPlaceholder: !targetBlock
    };
  });
}

function splitDisplayBlocks(text: string, lane: "source" | "target"): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const softLimit = lane === "source" ? SOURCE_SOFT_BLOCK_CHARS : TARGET_SOFT_BLOCK_CHARS;
  const hardLimit = lane === "source" ? SOURCE_HARD_BLOCK_CHARS : TARGET_HARD_BLOCK_CHARS;
  const sentenceParts = splitByStrongBoundaries(normalized, lane);
  const boundaryParts = sentenceParts.flatMap((part) => splitByDiscourseBoundary(part, lane, softLimit));
  return boundaryParts.flatMap((part) => splitLongBlock(part, softLimit, hardLimit));
}

function splitByStrongBoundaries(text: string, lane: "source" | "target"): string[] {
  const pattern = lane === "source" ? /[.!?]+["')\]]?\s+/g : /[。！？!?]+["'”’）\]]?\s*/g;
  return splitAfterPattern(text, pattern);
}

function splitByDiscourseBoundary(text: string, lane: "source" | "target", softLimit: number): string[] {
  if (lane !== "source" || visibleLength(text) <= softLimit) {
    return [text];
  }
  return splitBeforePattern(text, SOURCE_DISCOURSE_BOUNDARY);
}

function splitAfterPattern(text: string, pattern: RegExp): string[] {
  const parts: string[] = [];
  let cursor = 0;
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const end = match.index + match[0].length;
    const part = text.slice(cursor, end).trim();
    if (part) {
      parts.push(part);
    }
    cursor = end;
  }
  const tail = text.slice(cursor).trim();
  if (tail) {
    parts.push(tail);
  }
  return parts.length > 0 ? parts : [text];
}

function splitBeforePattern(text: string, pattern: RegExp): string[] {
  const parts: string[] = [];
  let cursor = 0;
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start <= cursor) {
      continue;
    }
    const part = text.slice(cursor, start).trim();
    if (part) {
      parts.push(part);
    }
    cursor = start + match[0].length;
  }
  const tail = text.slice(cursor).trim();
  if (tail) {
    parts.push(tail);
  }
  return parts.length > 1 ? parts : [text];
}

function splitLongBlock(text: string, softLimit: number, hardLimit: number): string[] {
  const parts: string[] = [];
  let remaining = text.trim();
  while (visibleLength(remaining) > hardLimit) {
    const splitAt = findSoftSplitIndex(remaining, softLimit);
    const head = remaining.slice(0, splitAt).trim();
    if (!head) {
      break;
    }
    parts.push(head);
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) {
    parts.push(remaining);
  }
  return parts;
}

function findSoftSplitIndex(text: string, preferred: number): number {
  const minIndex = Math.max(1, Math.floor(preferred * 0.58));
  const maxIndex = Math.min(text.length - 1, Math.floor(preferred * 1.12));
  for (let index = maxIndex; index >= minIndex; index -= 1) {
    if (/[,，;；:：]/.test(text[index])) {
      return index + 1;
    }
  }
  for (let index = maxIndex; index >= minIndex; index -= 1) {
    if (/\s/.test(text[index])) {
      return index + 1;
    }
  }
  return maxIndex;
}

function visibleLength(text: string): number {
  return Array.from(text).filter((char) => char.trim() !== "").length;
}
