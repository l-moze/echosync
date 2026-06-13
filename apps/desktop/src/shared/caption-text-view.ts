/**
 * 字幕文本视图 - 逐行动画和断行逻辑
 *
 * 【核心设计理念】：
 * 1. 原文持续流畅显示（打字机效果），不因标点符号或译文延迟而停顿
 * 2. 达到阈值（~118字符，约3行）后，在自然边界（句号、逗号）自然断行
 * 3. 断行后，前面内容上移/淡出，当前文本继续在底部累积
 * 4. 所有内容完整显示，不使用 "..." 省略
 *
 * 【关键常量】：
 * - SOURCE_PENDING_CHARS = 118：原文开始考虑断行的字符数
 * - TARGET_PENDING_CHARS = 68：译文开始考虑断行的字符数
 * - SOFT_SPLIT_GRACE_MS = 380ms：断行延迟，给用户阅读时间
 *
 * 【数据结构】：
 * - CaptionTextBlockLaneState.committedBreaks：记录所有断行位置
 * - 用于将长文本分成多个"块"（block），每个块一行显示
 *
 * 【为什么不能"遇到句号就断行"】：
 * - 短句子（<118字符）不应该断行，否则每句话都是新行，造成闪烁
 * - 原文必须持续显示，不能等待译文
 * - 断行是为了避免单行过长，不是为了"分句"
 */
import type { CaptionLine } from "./caption-store";
import { normalizeSubtitleDisplayMode, type SubtitleStyleState } from "./subtitle-style-state";
import { countVisibleChars } from "./text-utils";

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

/**
 * 断行阈值常量
 *
 * 软断行（SOFT）：达到此字符数后开始考虑断行，延迟 900ms
 * 硬断行（HARD）：达到此字符数后必须断行，延迟 450ms
 * 待定断行（PENDING）：开始考虑断行的触发点
 *
 * 为什么是 118 字符？
 * - 约 3 行英文文本的长度
 * - 足够累积一个完整的语义单元
 * - 避免短句子频繁断行造成闪烁
 */
const SOURCE_SOFT_BLOCK_CHARS = 112;
const TARGET_SOFT_BLOCK_CHARS = 44;
const SOURCE_HARD_BLOCK_CHARS = 148;
const TARGET_HARD_BLOCK_CHARS = 64;
const SOURCE_PENDING_CHARS = 118;
const TARGET_PENDING_CHARS = 68;
const SOURCE_HARD_PENDING_CHARS = 230;
const TARGET_HARD_PENDING_CHARS = 132;

/**
 * 断行延迟常量
 *
 * SOFT_SPLIT_GRACE_MS：正常情况下的延迟（900ms）
 * HARD_SPLIT_GRACE_MS：文本过长时的延迟（450ms）
 *
 * 为什么需要延迟？
 * - 给用户阅读前面内容的时间
 * - 避免断行发生得太突然
 * - 让打字机动画更自然
 */
const SOFT_SPLIT_GRACE_MS = 900;
const HARD_SPLIT_GRACE_MS = 450;

/**
 * 话语边界模式（英文）
 *
 * 用于在连词、转折词前断行
 * 例如："I think", "That is", "And", "But"
 */
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

  const sourceIsPlaceholder = !sourceText;
  const sourceBlocks = splitDisplayBlocks(sourceIsPlaceholder ? "等待音频输入..." : sourceText, "source");
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
      isSourcePlaceholder: sourceIsPlaceholder || !sourceBlock,
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

  return blocks;
}

/**
 * 更新文本块的断行状态（核心逻辑）
 *
 * 【逐行动画的完整流程】：
 * 1. ASR 持续输出打字机效果的文本（reconcileLaneState 控制打字速度）
 * 2. 文本累积到 SOURCE_PENDING_CHARS (118字符) 后，开始"考虑"断行
 * 3. 等待 graceMs 延迟（380ms），给用户阅读时间
 * 4. 在自然边界（句号、逗号等）断行，将前面部分"提交"
 * 5. 后续文本继续在当前位置累积显示
 *
 * 【关键设计原则】：
 * - 原文必须持续流畅显示，不能因为等待译文而停顿
 * - 不在短文本时断行（避免"遇到句号就断"）
 * - 断行后的内容完整显示（committedBreaks 记录所有断行位置）
 * - 不使用 "..." 省略，所有字符都呈现
 *
 * @param previous 上一次的状态（包含已提交的断行位置）
 * @param text 当前完整文本
 * @param lane "source" 原文 | "target" 译文
 * @param nowMs 当前时间戳（用于计算延迟）
 */
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

  // 步骤1：调和状态（处理文本更新、RESET、EXTEND、REVISE）
  const base = reconcileLaneState(previous, normalized);
  const lastCommittedBreak = base.committedBreaks.at(-1) ?? 0;
  const tail = normalized.slice(lastCommittedBreak).trimStart();

  // 步骤2：检查是否达到断行阈值（118字符）
  if (!shouldStartPendingSplit(tail, lane)) {
    return { ...base, pendingSinceMs: null };
  }

  // 步骤3：延迟断行，给用户阅读时间（380ms）
  const pendingSinceMs = base.pendingSinceMs ?? nowMs;
  const graceMs = shouldHardSplit(tail, lane) ? HARD_SPLIT_GRACE_MS : SOFT_SPLIT_GRACE_MS;
  if (nowMs - pendingSinceMs < graceMs) {
    return { ...base, pendingSinceMs };
  }

  // 步骤4：在自然边界（句号、逗号等）找到断行位置
  const nextBreak = findNextCommittedBreak(normalized, lastCommittedBreak, lane);
  if (nextBreak <= lastCommittedBreak || nextBreak >= normalized.length) {
    // 没有找到合适的断行位置，继续等待
    return { ...base, pendingSinceMs };
  }

  // 步骤5：提交断行位置，将前面的文本"固化"
  // committedBreaks 记录所有断行位置，用于 selectBlocksForBreaks 分块显示
  const committedBreaks = [...base.committedBreaks, nextBreak];
  const remainingTail = normalized.slice(nextBreak).trimStart();

  // 步骤6：检查剩余文本是否需要继续断行
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

/**
 * 判断新文本是否是旧文本的"修订"（而非完全无关的新内容）
 *
 * 用途：reconcileLaneState 据此决定是保留已提交的断行位置（修订），
 * 还是重置状态（无关文本）。误判为非修订会导致已显示文本重新逐字弹出。
 *
 * 判断顺序（从宽松到严格）：
 * 1. 短文本（< 8 可见字符）：公共前缀占比 ≥ 50% 即视为修订
 * 2. 一般文本（≥ 8 可见字符）：公共前缀占比 ≥ 40% 即视为修订
 * 3. 极短文本（< 24 可见字符）且前两条都不满足：判定为非修订
 * 4. 较长文本：前缀占比 ≥ 42% 或词级重叠率 ≥ 62% 视为修订
 *
 * 注意：所有"占比"统一使用可见字符数（countVisibleChars），
 * 避免空格导致的单位不一致。
 */
function isLikelyStreamingRevision(previousText: string, nextText: string): boolean {
  // Fix 1: Type safety - guard against null/undefined
  if (!previousText || !nextText) {
    return false;
  }

  const previousLength = countVisibleChars(previousText);
  const nextLength = countVisibleChars(nextText);

  // Fix 2: Empty/whitespace-only strings are not revisions
  if (previousLength === 0 || nextLength === 0) {
    return false;
  }

  const minLength = Math.min(previousLength, nextLength);

  // CRITICAL: 单位一致性 - rawPrefixLength 是 UTF-16 索引，必须转换为可见字符数
  const rawPrefixLength = longestCommonPrefixLength(previousText, nextText);
  const visiblePrefixLength = countVisibleChars(previousText.slice(0, rawPrefixLength));

  // 一般文本：公共前缀占比 ≥ 40% 视为修订
  if (minLength >= 8 && visiblePrefixLength >= minLength * 0.4) {
    return true;
  }

  // 极短文本（< 8 可见字符）：公共前缀占比 ≥ 50% 视为修订
  if (minLength < 8 && visiblePrefixLength >= minLength * 0.5) {
    return true;
  }

  // 文本过短且前缀不足，无法可靠判断，按非修订处理
  if (minLength < 24) {
    return false;
  }

  // 较长文本：前缀占比 ≥ 42% 直接视为修订
  if (visiblePrefixLength >= minLength * 0.42) {
    return true;
  }

  // 否则按词级重叠率判断（应对中间词被替换、前缀较短的修订）
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

/**
 * 判断是否应该开始考虑断行（Pending Split）
 *
 * 重要：只有文本累积到一定长度（118 字符）后才触发断行
 * 这样可以避免"遇到句号就立即断行"导致的闪烁
 *
 * 设计原则：
 * - 原文应该持续流畅显示（打字机效果）
 * - 不因为标点符号就强制分段
 * - 达到阈值后，自然地将前面内容上移，当前文本继续显示
 */
function shouldStartPendingSplit(text: string, lane: "source" | "target"): boolean {
  const limit = lane === "source" ? SOURCE_PENDING_CHARS : TARGET_PENDING_CHARS;
  return countVisibleChars(text) > limit && findNextCommittedBreak(text, 0, lane) < text.length;
}

/**
 * 判断是否应该强制断行（Hard Split）
 *
 * 当文本超过硬限制（230字符）时，必须立即断行
 * 延迟时间从 SOFT_SPLIT_GRACE_MS (900ms) 降为 HARD_SPLIT_GRACE_MS (450ms)
 */
function shouldHardSplit(text: string, lane: "source" | "target"): boolean {
  const limit = lane === "source" ? SOURCE_HARD_PENDING_CHARS : TARGET_HARD_PENDING_CHARS;
  return countVisibleChars(text) > limit;
}

/**
 * 查找下一个可以断行的位置
 *
 * 断行策略：
 * 1. 优先在自然边界断行（句号、逗号、连词等）
 * 2. 选择第一个合适的边界（不等待多个句子累积）
 * 3. 如果没有自然边界，返回文本末尾（不强制断行）
 *
 * 注意：这个函数只是"查找"断行位置，真正是否断行由 shouldStartPendingSplit 控制
 */
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

/**
 * 将文本分割成多个显示块（用于断行）
 *
 * 分割优先级（从高到低）：
 * 1. 强边界：句号、感叹号、问号后（splitByStrongBoundaries）
 * 2. 话语边界：连词、转折词（splitByDiscourseBoundary）
 * 3. 长块强制分割：超过硬限制时按字符数切分（splitLongBlock）
 *
 * 重要：这个函数只是"准备"分割点，不会立即应用
 * 真正的断行时机由 advanceLaneBreaks 中的 graceMs 延迟控制
 */

/**
 * 分割显示文本块（用于静态显示，不涉及动态断行）
 *
 * 3 种分割优先级：
 * 1. 强边界（句号、感叹号、问号）
 * 2. 话语边界（连词、转折词）
 * 3. 长块强制分割（超过硬限制）
 *
 * 注意：这个函数用于已完成的文本显示，不控制实时断行的 graceMs 延迟
 * 实时断行的延迟由 updateBlockLane 中的 SOFT_SPLIT_GRACE_MS 控制
 */
function splitDisplayBlocks(text: string, lane: "source" | "target"): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const softLimit = lane === "source" ? SOURCE_SOFT_BLOCK_CHARS : TARGET_SOFT_BLOCK_CHARS;
  const hardLimit = lane === "source" ? SOURCE_HARD_BLOCK_CHARS : TARGET_HARD_BLOCK_CHARS;
  if (countVisibleChars(normalized) <= softLimit) {
    return [normalized];
  }
  const sentenceParts = splitByStrongBoundaries(normalized, lane);
  const boundaryParts = sentenceParts.flatMap((part) => splitByDiscourseBoundary(part, lane, softLimit));
  return boundaryParts.flatMap((part) => splitLongBlock(part, softLimit, hardLimit));
}

/**
 * 按强边界分割文本（句号、感叹号、问号）
 *
 * 英文：/[.!?]+[“’)\]]?\s+/g  - 句号后必须有空格
 * 中文：/[。！？!?]+[“’”’）\]]?\s* /g - 句号后可以没有空格
 *
 * 注意：这个函数不会”立即断行”！
 * 它只是标记出可能的断行位置，真正断行需要满足：
 * 1. 文本长度 > SOURCE_PENDING_CHARS (118字符)
 * 2. 经过 graceMs 延迟（SOFT_SPLIT_GRACE_MS = 380ms）
 * 3. 选择第一个自然边界
 */
function splitByStrongBoundaries(text: string, lane: "source" | "target"): string[] {
  const pattern = lane === "source" ? /[.!?]+[“’)\]]?\s+/g : /[。！？!?]+[“’”’）\]]?\s*/g;
  return splitAfterPattern(text, pattern);
}

function splitByDiscourseBoundary(text: string, lane: "source" | "target", softLimit: number): string[] {
  if (lane !== "source" || countVisibleChars(text) <= softLimit) {
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
  while (countVisibleChars(remaining) > hardLimit) {
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
