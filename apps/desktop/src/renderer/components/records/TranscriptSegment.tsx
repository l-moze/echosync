import { forwardRef } from "react";

type TranscriptDisplayMode = "bilingual" | "source" | "translation";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const TranscriptSegment = forwardRef<HTMLElement, {
  timestamp: string;
  sourceText: string;
  translationText: string;
  displayMode?: TranscriptDisplayMode;
  isActive?: boolean;
  isMatch?: boolean;
  onPlay?: () => void;
  highlightQuery?: string;
}>(function TranscriptSegment({
  timestamp,
  sourceText,
  translationText,
  displayMode = "bilingual",
  isActive = false,
  isMatch = false,
  onPlay,
  highlightQuery
}, ref) {
  const query = highlightQuery?.trim() ?? "";
  const highlightText = (text: string) => {
    if (!query) return text;
    const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase()
        ? <mark key={i}>{part}</mark>
        : part
    );
  };
  const showSource = displayMode !== "translation";
  const showTranslation = displayMode !== "source";

  return (
    <article ref={ref} className={`recordSegment ${isActive ? "active" : ""} ${isMatch ? "match" : ""}`}>
      <button className="recordSegmentPlay" onClick={onPlay} aria-label="播放片段">
        ▶
      </button>
      <div className="recordSegmentTimestamp">{timestamp}</div>
      <div>
        {showSource ? <div className="recordSegmentSource">{highlightText(sourceText)}</div> : null}
        {showTranslation ? <div className="recordSegmentTranslation">{highlightText(translationText)}</div> : null}
      </div>
      <div className="recordSegmentMore">•••</div>
    </article>
  );
});
