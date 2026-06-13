import { useLayoutEffect, useRef } from "react";

import type { CaptionLine } from "../../../shared/caption-store";
import type { SubtitleStyleState } from "../../../shared/subtitle-style-state";
import { useCompleteCaptionItemVisibility } from "../../hooks/useCompleteCaptionItemVisibility";
import type { CaptionContentMode } from "../../types/caption";
import { scrollCaptionRailToStableEdge } from "../../utils/dom";
import { CaptionText } from "./CaptionText";

export function OverlayCaptionHistory({
  contentMode,
  lines,
  subtitleStyle
}: {
  contentMode: CaptionContentMode;
  lines: CaptionLine[];
  subtitleStyle: SubtitleStyleState;
}) {
  const historyRef = useRef<HTMLDivElement | null>(null);
  const lineRenderKey = lines.map((line) => `${line.id}:${line.rev}:${line.state}:${line.sourceText.length}:${line.targetText.length}`).join("|");
  const hiddenItemKeys = useCompleteCaptionItemVisibility(historyRef, ".historyLine", lineRenderKey);

  useLayoutEffect(() => {
    scrollCaptionRailToStableEdge(historyRef.current, ".historyLine", "smooth");
  }, [lineRenderKey]);

  return (
    <div className="overlayCaptionHistory" ref={historyRef}>
      {lines.length > 0 ? lines.map((line, index, visibleLines) => (
        <article
          className={`historyLine ${line.state} ${index === visibleLines.length - 1 ? "current" : ""}${hiddenItemKeys.has(line.id) ? " clipped" : ""}`}
          data-caption-item-key={line.id}
          key={line.id}
        >
          <CaptionText
            contentMode={contentMode}
            line={line}
            subtitleStyle={subtitleStyle}
            useBufferedBlocks={index === visibleLines.length - 1}
          />
        </article>
      )) : (
        <article
          className={`historyLine interim current${hiddenItemKeys.has("placeholder") ? " clipped" : ""}`}
          data-caption-item-key="placeholder"
        >
          <CaptionText contentMode={contentMode} line={undefined} subtitleStyle={subtitleStyle} useBufferedBlocks />
        </article>
      )}
    </div>
  );
}
