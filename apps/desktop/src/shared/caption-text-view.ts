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
  isSplitPending?: boolean;
  isTargetPlaceholder?: boolean;
};

export type CaptionTextBlockLaneState = {
  text: string;
  committedBreaks: number[];
  pendingSinceMs: number | null;
};

export type CaptionTextBlockEntry = {
  lineId: string;
  mode: "sentencePair" | "zonedPair";
  source: CaptionTextBlockLaneState;
  target: CaptionTextBlockLaneState;
};

export type CaptionTextBlockBuffer = {
  entries: Record<string, CaptionTextBlockEntry>;
};

export type CaptionTextBlockSelection = {
  blocks: CaptionTextBlock[];
  buffer: CaptionTextBlockBuffer;
  pending: boolean;
};

const SOURCE_SOFT_BLOCK_CHARS = 112;
const TARGET_SOFT_BLOCK_CHARS = 44;
const SOURCE_HARD_BLOCK_CHARS = 148;
const TARGET_HARD_BLOCK_CHARS = 64;
const SOURCE_PENDING_CHARS = 118;
const TARGET_PENDING_CHARS = 68;
const SOURCE_HARD_PENDING_CHARS = 230;
const TARGET_HARD_PENDING_CHARS = 132;
const SOFT_SPLIT_GRACE_MS = 900;
const HARD_SPLIT_GRACE_MS = 450;
const SOURCE_DISCOURSE_BOUNDARY = /\s+(?=(?:I would|I think|I mean|That is|This is|And|But|So|Now|Then)\b)/g;

export function createInitialCaptionTextBlockBuffer(): CaptionTextBlockBuffer {
  return { entries: {} };
}

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

export function selectBufferedCaptionTextBlocks(
  buffer: CaptionTextBlockBuffer,
  line: CaptionLine | undefined,
  subtitleStyle: SubtitleStyleState,
  nowMs: number
): CaptionTextBlockSelection {
  if (!line) {
    return {
      blocks: selectCaptionTextBlocks(line, subtitleStyle),
      buffer: createInitialCaptionTextBlockBuffer(),
      pending: false
    };
  }

  const displayMode = normalizeSubtitleDisplayMode(subtitleStyle.displayMode);
  const sourceText = line.sourceText.trim();
  const targetText = line.targetText.trim();
  if (displayMode === "zonedPair") {
    return {
      blocks: selectCaptionTextBlocks(line, subtitleStyle),
      buffer: {
        entries: {
          [line.id]: {
            lineId: line.id,
            mode: displayMode,
            source: createLaneState(sourceText),
            target: createLaneState(targetText)
          }
        }
      },
      pending: false
    };
  }

  const previous = buffer.entries[line.id];
  const previousForMode = previous?.mode === displayMode ? previous : undefined;
  const source = updateBlockLane(previousForMode?.source, sourceText, "source", nowMs);
  const target = updateBlockLane(previousForMode?.target, targetText, "target", nowMs);
  const entry: CaptionTextBlockEntry = {
    lineId: line.id,
    mode: displayMode,
    source,
    target
  };

  return {
    blocks: buildBlocksFromEntry(line, entry),
    buffer: { entries: { [line.id]: entry } },
    pending: source.pendingSinceMs !== null || target.pendingSinceMs !== null
  };
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

function buildBlocksFromEntry(line: CaptionLine, entry: CaptionTextBlockEntry): CaptionTextBlock[] {
  const sourceBlocks = selectBlocksForBreaks(entry.source.text || "等待音频输入...", entry.source.committedBreaks);
  const targetBlocks = entry.target.text ? selectBlocksForBreaks(entry.target.text, entry.target.committedBreaks) : [];
  const blockCount = Math.max(1, sourceBlocks.length, targetBlocks.length);
  const pendingBlockIndex = entry.source.pendingSinceMs !== null || entry.target.pendingSinceMs !== null
    ? blockCount - 1
    : -1;

  const blocks = Array.from({ length: blockCount }, (_, index) => {
    const sourceBlock = sourceBlocks[index] ?? "";
    const targetBlock = targetBlocks[index] ?? "";
    return {
      id: `${line.id}:visual:${index}`,
      sourceText: sourceBlock,
      targetText: targetBlock,
      state: line.state,
      isSourcePlaceholder: !sourceBlock,
      isSplitPending: index === pendingBlockIndex,
      isTargetPlaceholder: !targetBlock
    };
  });

  // 🔍 调试日志：追踪块拆分
  if (typeof console !== "undefined" && blockCount > 1) {
    console.log("[caption-text-view] buildBlocksFromEntry", {
      line_id: line.id,
      line_rev: line.rev,
      block_count: blockCount,
      source_breaks: entry.source.committedBreaks,
      target_breaks: entry.target.committedBreaks,
      pending_index: pendingBlockIndex,
      block_ids: blocks.map(b => b.id),
      block_previews: blocks.map(b => `${b.sourceText.substring(0, 20)}...`)
    });
  }

  return blocks;
}

function updateBlockLane(
  previous: CaptionTextBlockLaneState | undefined,
  text: string,
  lane: "source" | "target",
  nowMs: number
): CaptionTextBlockLaneState {
  const normalized = text.trim();
  if (!normalized) {
    return createLaneState(normalized);
  }

  const base = reconcileLaneState(previous, normalized);
  const lastCommittedBreak = base.committedBreaks.at(-1) ?? 0;
  const tail = normalized.slice(lastCommittedBreak).trimStart();
  if (!shouldStartPendingSplit(tail, lane)) {
    return { ...base, pendingSinceMs: null };
  }

  const pendingSinceMs = base.pendingSinceMs ?? nowMs;
  const graceMs = shouldHardSplit(tail, lane) ? HARD_SPLIT_GRACE_MS : SOFT_SPLIT_GRACE_MS;
  if (nowMs - pendingSinceMs < graceMs) {
    return { ...base, pendingSinceMs };
  }

  const nextBreak = findNextCommittedBreak(normalized, lastCommittedBreak, lane);
  if (nextBreak <= lastCommittedBreak || nextBreak >= normalized.length) {
    return { ...base, pendingSinceMs };
  }

  const committedBreaks = [...base.committedBreaks, nextBreak];
  const remainingTail = normalized.slice(nextBreak).trimStart();
  return {
    text: normalized,
    committedBreaks,
    pendingSinceMs: shouldStartPendingSplit(remainingTail, lane) ? nowMs : null
  };
}

function createLaneState(text: string): CaptionTextBlockLaneState {
  return {
    text,
    committedBreaks: [],
    pendingSinceMs: null
  };
}

function reconcileLaneState(
  previous: CaptionTextBlockLaneState | undefined,
  normalized: string
): CaptionTextBlockLaneState {
  if (!previous) {
    return createLaneState(normalized);
  }

  const isExtension = normalized.startsWith(previous.text);
  const isRevision = !isExtension && isLikelyStreamingRevision(previous.text, normalized);
  const stablePrefixLength = isRevision ? longestCommonPrefixLength(previous.text, normalized) : 0;

  // 🔍 调试日志：追踪文本更新类型
  if (typeof console !== "undefined" && (previous.text.length > 20 || normalized.length > 20)) {
    console.log("[caption-text-view] reconcileLaneState", {
      prev_len: previous.text.length,
      new_len: normalized.length,
      prev_preview: previous.text.substring(0, 50),
      new_preview: normalized.substring(0, 50),
      is_extension: isExtension,
      is_revision: isRevision,
      stable_prefix_len: stablePrefixLength,
      committed_breaks: previous.committedBreaks.length,
      action: isExtension ? "EXTEND" : isRevision ? "REVISE" : "RESET",
      will_reset_breaks: !isExtension && !isRevision
    });
  }

  if (isExtension) {
    return { ...previous, text: normalized };
  }

  if (!isRevision) {
    // 修复：即使判定为非修订，也尝试保留公共前缀的 breaks
    // 避免短文本或不相关文本导致的完全重置
    const commonPrefixLength = longestCommonPrefixLength(previous.text, normalized);
    if (commonPrefixLength > 10) {
      // 有明显的公共前缀，保留这部分的 breaks
      return {
        text: normalized,
        committedBreaks: previous.committedBreaks.filter((breakAt) => breakAt <= commonPrefixLength && breakAt < normalized.length),
        pendingSinceMs: null
      };
    }
    // 完全不相关的文本，才真正重置
    return createLaneState(normalized);
  }

  // ✅ 局部修订：保留稳定前缀的 breaks
  return {
    text: normalized,
    committedBreaks: previous.committedBreaks.filter((breakAt) => breakAt <= stablePrefixLength && breakAt < normalized.length),
    pendingSinceMs: previous.pendingSinceMs
  };
}

function isLikelyStreamingRevision(previousText: string, nextText: string): boolean {
  const previousLength = visibleLength(previousText);
  const nextLength = visibleLength(nextText);

  // 修复：放宽短文本限制，避免误判为 RESET
  // 原逻辑：< 24 直接返回 false，导致实时流式更新时频繁触发 RESET
  // 新逻�辑：只要有任何公共前缀，就尝试判断为修订
  const prefixLength = longestCommonPrefixLength(previousText, nextText);
  const minLength = Math.min(previousLength, nextLength);

  // 如果公共前缀占比 > 40%，视为修订
  if (prefixLength >= minLength * 0.4 && minLength >= 8) {
    return true;
  }

  // 对于更短的文本（< 8字符），只要有 50% 以上公共前缀就视为修订
  if (minLength < 8 && prefixLength >= minLength * 0.5) {
    return true;
  }

  // 原有的相似度判断保留
  if (minLength < 24) {
    return false;
  }

  const stablePrefixLength = visibleLength(previousText.slice(0, prefixLength));
  if (stablePrefixLength >= minLength * 0.42) {
    return true;
  }

  const previousTokens = tokenizeForSimilarity(previousText);
  const nextTokens = tokenizeForSimilarity(nextText);
  if (Math.min(previousTokens.length, nextTokens.length) < 4) {
    return false;
  }

  const nextTokenSet = new Set(nextTokens);
  const overlap = previousTokens.filter((token) => nextTokenSet.has(token)).length;
  return overlap / Math.min(previousTokens.length, nextTokens.length) >= 0.62;
}

function longestCommonPrefixLength(a: string, b: string): number {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) {
    index += 1;
  }
  return index;
}

function tokenizeForSimilarity(text: string): string[] {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (tokens && tokens.length > 0) {
    return tokens;
  }
  return Array.from(text).filter((char) => char.trim() !== "");
}

function selectBlocksForBreaks(text: string, breaks: number[]): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const parts: string[] = [];
  let cursor = 0;
  for (const breakAt of breaks) {
    const part = normalized.slice(cursor, breakAt).trim();
    if (part) {
      parts.push(part);
    }
    cursor = breakAt;
  }
  const tail = normalized.slice(cursor).trim();
  if (tail) {
    parts.push(tail);
  }
  return parts.length > 0 ? parts : [normalized];
}

function shouldStartPendingSplit(text: string, lane: "source" | "target"): boolean {
  const limit = lane === "source" ? SOURCE_PENDING_CHARS : TARGET_PENDING_CHARS;
  return visibleLength(text) > limit && findNextCommittedBreak(text, 0, lane) < text.length;
}

function shouldHardSplit(text: string, lane: "source" | "target"): boolean {
  const limit = lane === "source" ? SOURCE_HARD_PENDING_CHARS : TARGET_HARD_PENDING_CHARS;
  return visibleLength(text) > limit;
}

function findNextCommittedBreak(text: string, offset: number, lane: "source" | "target"): number {
  const rawTail = text.slice(offset);
  const tail = rawTail.trimStart();
  const skippedWhitespace = rawTail.length - tail.length;
  const candidateBlocks = splitDisplayBlocks(tail, lane);
  if (candidateBlocks.length <= 1) {
    return text.length;
  }
  return offset + skippedWhitespace + candidateBlocks[0].length;
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
