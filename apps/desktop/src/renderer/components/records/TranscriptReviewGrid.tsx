import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";

import type { CaptionLine } from "../../../shared/caption-store";
import { TRANSCRIPT_REVIEW_STACKED_WIDTH_PX } from "../../constants/layout";
import { formatPreciseTime } from "../../utils/format";
import { selectTranscriptReviewColumnTemplate } from "../../utils/session-review-layout";

export function TranscriptReviewGrid({
  activeSegmentId,
  lines,
  onLineClick
}: {
  activeSegmentId: string | null;
  lines: CaptionLine[];
  onLineClick: (line: CaptionLine) => void;
}) {
  const gridRef = useRef<HTMLElement | null>(null);
  const [layoutMode, setLayoutMode] = useState<"balanced" | "stacked">("balanced");
  const columnTemplate = useMemo(() => selectTranscriptReviewColumnTemplate(lines), [lines]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }
    const updateLayoutMode = () => {
      setLayoutMode(grid.clientWidth < TRANSCRIPT_REVIEW_STACKED_WIDTH_PX ? "stacked" : "balanced");
    };
    updateLayoutMode();
    if (!("ResizeObserver" in window)) {
      return;
    }
    const observer = new ResizeObserver(updateLayoutMode);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  function handleReviewSegmentKeyDown(line: CaptionLine, event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    onLineClick(line);
  }

  return (
    <section
      className={`transcriptReviewGrid ${layoutMode === "stacked" ? "stacked" : ""}`}
      style={{ "--review-column-template": columnTemplate } as CSSProperties}
      ref={gridRef}
      aria-label="双语会话记录"
    >
      <div className="reviewHeader" aria-hidden="true">
        <span>时间</span>
        <span>原文</span>
        <span>译文</span>
      </div>
      {lines.map((line) => (
        <article
          className={line.id === activeSegmentId ? "reviewPair active" : "reviewPair"}
          key={line.id}
          onClick={() => onLineClick(line)}
          onKeyDown={(event) => handleReviewSegmentKeyDown(line, event)}
          role="button"
          tabIndex={0}
        >
          <span className="reviewTimestamp">{formatPreciseTime(line.startMs)}-{formatPreciseTime(line.endMs)}</span>
          <span className="reviewSegment reviewSource">
            <span className="reviewText reviewSource">{line.sourceText || "原文为空"}</span>
          </span>
          <span className="reviewSegment reviewTarget">
            <span className="reviewText reviewTarget">{line.targetText || "译文待补全"}</span>
          </span>
        </article>
      ))}
    </section>
  );
}
