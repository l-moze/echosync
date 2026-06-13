import { useLayoutEffect, useRef } from "react";

import { selectCaptionTextBlocks } from "../../../shared/caption-text-view";
import type { CaptionLine } from "../../../shared/caption-store";
import {
  selectSubtitleFontWeight,
  type SubtitleStyleState
} from "../../../shared/subtitle-style-state";
import { fontFamilyValue } from "../../utils/style";

export function ZonedCaptionRail({ lines, subtitleStyle }: { lines: CaptionLine[]; subtitleStyle: SubtitleStyleState }) {
  return (
    <div className="zonedCaptionRail" aria-label="分区对照字幕">
      <ZonedCaptionLane kind="source" lines={lines} subtitleStyle={subtitleStyle} />
      <ZonedCaptionLane kind="target" lines={lines} subtitleStyle={subtitleStyle} />
    </div>
  );
}

function ZonedCaptionLane({
  kind,
  lines,
  subtitleStyle
}: {
  kind: "source" | "target";
  lines: CaptionLine[];
  subtitleStyle: SubtitleStyleState;
}) {
  const laneRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<HTMLElement | null>(null);
  const isSource = kind === "source";
  const zonedStyle: SubtitleStyleState = { ...subtitleStyle, displayMode: "zonedPair" };
  const fallbackBlock = selectCaptionTextBlocks(undefined, zonedStyle)[0];
  const fallbackText = isSource ? fallbackBlock.sourceText : fallbackBlock.targetText;
  const selectedChunks = lines.length > 0
    ? selectZonedCaptionLaneChunks(kind, lines, zonedStyle)
    : [];
  const chunks = lines.length > 0
    ? selectedChunks
    : [createZonedCaptionFallbackChunk(fallbackText)];
  const streamState = chunks.at(-1)?.state ?? "interim";
  const isPlaceholder = chunks.length > 0 && chunks.every((chunk) => chunk.isPlaceholder);
  const itemKey = chunks.map((chunk) => `${chunk.key}:${chunk.text.length}`).join("|");
  const layoutKey = chunks.map((chunk) => `${chunk.key}:${chunk.text.length}:${zonedCaptionTextFingerprint(chunk.text)}`).join("|");
  useZonedCaptionLaneViewport(laneRef, streamRef, `${kind}:${layoutKey}`);

  return (
    <div
      aria-label={isSource ? "原文字幕区" : "译文字幕区"}
      className={`zonedCaptionLane ${kind}Lane`}
      ref={laneRef}
    >
      <article
        className={`zonedCaptionStream ${streamState} current${isPlaceholder ? " placeholderText" : ""}`}
        data-caption-item-key={itemKey || "placeholder"}
        ref={streamRef}
      >
        <p
          aria-hidden={isPlaceholder ? true : undefined}
          className={`zonedCaptionText ${kind}Text ${streamState}${isPlaceholder ? " placeholderText" : ""}`}
          style={{
            fontFamily: fontFamilyValue(isSource ? subtitleStyle.sourceFont : subtitleStyle.targetFont),
            fontWeight: selectSubtitleFontWeight(isSource ? "source" : "target", isSource ? subtitleStyle.sourceBold : subtitleStyle.targetBold)
          }}
        >
          {chunks.map((chunk, index) => (
            <span
              aria-hidden={chunk.isPlaceholder ? true : undefined}
              className={`zonedCaptionChunk ${chunk.state}${chunk.isPlaceholder ? " placeholderText" : ""}`}
              data-caption-item-key={chunk.key}
              key={chunk.key}
            >
              {chunk.text}{index < chunks.length - 1 ? " " : ""}
            </span>
          ))}
        </p>
      </article>
    </div>
  );
}

function useZonedCaptionLaneViewport(
  laneRef: { current: HTMLDivElement | null },
  streamRef: { current: HTMLElement | null },
  layoutKey: string
) {
  const scheduleUpdateRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const lane = laneRef.current;
    const stream = streamRef.current;
    if (!lane || !stream) {
      return;
    }

    let frame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const updateViewport = () => {
      frame = null;
      const laneStyle = window.getComputedStyle(lane);
      const textElement = stream.querySelector<HTMLElement>(".zonedCaptionText") ?? stream;
      const textStyle = window.getComputedStyle(textElement);
      const lineHeight = resolveZonedCaptionLineHeight(textStyle);
      const verticalPadding = cssPixelValue(laneStyle.paddingTop) + cssPixelValue(laneStyle.paddingBottom);
      const availableHeight = Math.max(0, lane.clientHeight - verticalPadding);
      const visibleLines = Math.max(1, Math.floor(availableHeight / lineHeight));
      const visibleHeight = visibleLines * lineHeight;
      lane.style.setProperty("--zoned-visible-lines", String(visibleLines));
      lane.style.setProperty("--zoned-visible-height", `${visibleHeight}px`);
      const scrollTop = selectZonedCaptionAlignedScrollTop(stream, textElement, visibleLines, lineHeight);
      if (Math.abs(stream.scrollTop - scrollTop) > 1) {
        stream.scrollTop = scrollTop;
      }
    };

    const scheduleUpdate = () => {
      if (frame !== null) {
        return;
      }
      frame = window.requestAnimationFrame(updateViewport);
    };

    scheduleUpdateRef.current = scheduleUpdate;
    scheduleUpdate();
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleUpdate);
      resizeObserver.observe(lane);
      resizeObserver.observe(stream);
    }

    return () => {
      scheduleUpdateRef.current = () => {};
      resizeObserver?.disconnect();
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [laneRef, streamRef]);

  useLayoutEffect(() => {
    scheduleUpdateRef.current();
  }, [layoutKey]);
}

function selectZonedCaptionAlignedScrollTop(
  stream: HTMLElement,
  textElement: HTMLElement,
  visibleLines: number,
  lineHeight: number
) {
  const maxScrollTop = Math.max(0, stream.scrollHeight - stream.clientHeight);
  const lineOffsets = measureZonedCaptionLineOffsets(textElement);
  if (lineOffsets.length > visibleLines) {
    const firstVisibleLineTop = lineOffsets[Math.max(0, lineOffsets.length - visibleLines)] ?? 0;
    return Math.max(0, Math.min(maxScrollTop, Math.round(firstVisibleLineTop)));
  }

  const rawScrollTop = Math.max(0, stream.scrollHeight - stream.clientHeight);
  return Math.max(0, Math.min(rawScrollTop, Math.floor(rawScrollTop / Math.max(lineHeight, 1)) * lineHeight));
}

function measureZonedCaptionLineOffsets(textElement: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(textElement);
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  range.detach();
  if (rects.length === 0) {
    return [];
  }

  const tops: number[] = [];
  for (const rect of rects.sort((a, b) => a.top - b.top)) {
    const previousTop = tops.at(-1);
    if (previousTop === undefined || Math.abs(rect.top - previousTop) > 2) {
      tops.push(rect.top);
    }
  }

  const firstTop = tops[0] ?? 0;
  return tops.map((top) => top - firstTop);
}

function resolveZonedCaptionLineHeight(style: CSSStyleDeclaration) {
  const parsedLineHeight = cssPixelValue(style.lineHeight);
  if (parsedLineHeight > 0) {
    return parsedLineHeight;
  }
  const fontSize = cssPixelValue(style.fontSize);
  return Math.max(1, fontSize * 1.25);
}

function cssPixelValue(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function zonedCaptionTextFingerprint(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 31) + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

type ZonedCaptionLaneChunk = {
  key: string;
  text: string;
  state: CaptionLine["state"];
  isPlaceholder: boolean;
};

function createZonedCaptionFallbackChunk(text: string): ZonedCaptionLaneChunk {
  return {
    key: "placeholder",
    text,
    state: "interim",
    isPlaceholder: true
  };
}

function selectZonedCaptionLaneChunks(
  kind: "source" | "target",
  lines: CaptionLine[],
  subtitleStyle: SubtitleStyleState
): ZonedCaptionLaneChunk[] {
  const isSource = kind === "source";
  const chunks: ZonedCaptionLaneChunk[] = [];

  for (const line of lines) {
    const block = selectCaptionTextBlocks(line, subtitleStyle)[0];
    const rawText = isSource ? block.sourceText : block.targetText;
    const text = rawText.replace(/\s+/g, " ").trim();
    const blockIsPlaceholder = isSource ? block.isSourcePlaceholder : block.isTargetPlaceholder;
    if (!text || blockIsPlaceholder) {
      continue;
    }
    chunks.push({
      key: `${kind}:${line.id}`,
      text,
      state: line.state,
      isPlaceholder: false
    });
  }

  return chunks;
}
