import { useEffect, useRef, useState } from "react";

import {
  createInitialCaptionTextBlockBuffer,
  selectBufferedCaptionTextBlocks,
  selectCaptionTextBlocks,
  type CaptionTextBlockBuffer
} from "../../../shared/caption-text-view";
import type { CaptionLine } from "../../../shared/caption-store";
import {
  normalizeSubtitleDisplayMode,
  selectSubtitleFontWeight,
  type SubtitleStyleState
} from "../../../shared/subtitle-style-state";
import type { CaptionContentMode } from "../../types/caption";
import { fontFamilyValue } from "../../utils/style";

export function CaptionText({
  contentMode = "bilingual",
  line,
  subtitleStyle,
  useBufferedBlocks = false
}: {
  contentMode?: CaptionContentMode;
  line?: CaptionLine;
  subtitleStyle: SubtitleStyleState;
  useBufferedBlocks?: boolean;
}) {
  const blocks = useCaptionTextBlocks(line, subtitleStyle, useBufferedBlocks);
  const displayMode = normalizeSubtitleDisplayMode(subtitleStyle.displayMode);
  const showSource = contentMode !== "target";
  const showTarget = contentMode !== "source";

  return (
    <div className={`captionText mode-${displayMode} content-${contentMode}`}>
      {blocks.map((block) => (
        <article className={`captionTextBlock${block.isSplitPending ? " splitPending" : ""}`} key={block.id}>
          {showSource ? (
            <p
              aria-hidden={block.isSourcePlaceholder ? true : undefined}
              className={`overlaySource ${block.state}${block.isSourcePlaceholder ? " placeholderText" : ""}`}
              style={{
                fontFamily: fontFamilyValue(subtitleStyle.sourceFont),
                fontWeight: selectSubtitleFontWeight("source", subtitleStyle.sourceBold)
              }}
            >
              {block.sourceText}
            </p>
          ) : null}
          {showTarget ? (
            <h1
              aria-hidden={block.isTargetPlaceholder ? true : undefined}
              className={`${block.state}${block.isTargetPlaceholder ? " placeholderText" : ""}`}
              style={{
                fontFamily: fontFamilyValue(subtitleStyle.targetFont),
                fontWeight: selectSubtitleFontWeight("target", subtitleStyle.targetBold)
              }}
            >
              {block.targetText}
            </h1>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function useCaptionTextBlocks(
  line: CaptionLine | undefined,
  subtitleStyle: SubtitleStyleState,
  useBufferedBlocks: boolean
) {
  const blockBufferRef = useRef<CaptionTextBlockBuffer>(createInitialCaptionTextBlockBuffer());
  const [blockTickMs, setBlockTickMs] = useState(() => Date.now());
  const nowMs = Date.now();
  const bufferedSelection = useBufferedBlocks
    ? selectBufferedCaptionTextBlocks(blockBufferRef.current, line, subtitleStyle, nowMs)
    : null;
  if (bufferedSelection) {
    blockBufferRef.current = bufferedSelection.buffer;
  }
  const blocks = bufferedSelection?.blocks ?? selectCaptionTextBlocks(line, subtitleStyle);

  useEffect(() => {
    if (!bufferedSelection?.pending) {
      return;
    }
    const timer = window.setTimeout(() => setBlockTickMs(Date.now()), 48);
    return () => window.clearTimeout(timer);
  }, [bufferedSelection?.pending, blockTickMs]);

  return blocks;
}
