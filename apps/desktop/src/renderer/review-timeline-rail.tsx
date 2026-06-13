import { useState, type MouseEvent } from "react";
import type { ReviewTimeline, TimelineSpan } from "../shared/review-timeline";

type TimelineTooltipState = {
  leftPercent: number;
  span: TimelineSpan;
} | null;

export type ReviewTimelineRailProps = {
  timeline: ReviewTimeline;
  reviewMs: number;
  reviewDurationMs: number;
  onChange: (reviewMs: number) => void;
  ariaLabel?: string;
};

export function ReviewTimelineRail({
  timeline,
  reviewMs,
  reviewDurationMs,
  onChange,
  ariaLabel = "复盘时间线"
}: ReviewTimelineRailProps) {
  const safeDurationMs = Math.max(reviewDurationMs, 1);
  const [tooltip, setTooltip] = useState<TimelineTooltipState>(null);
  const segments = timeline.spans.map((span, index) => {
    const left = (span.reviewStartMs / safeDurationMs) * 100;
    const width = ((span.reviewEndMs - span.reviewStartMs) / safeDurationMs) * 100;
    const isActive = reviewMs >= span.reviewStartMs && reviewMs < span.reviewEndMs;
    const className = span.type === "long_silence" ? "timelineSegment silence" : "timelineSegment content";

    return (
      <div
        key={`${span.rawStartMs}-${span.rawEndMs}-${index}`}
        className={isActive ? `${className} active` : className}
        onMouseEnter={() => setTooltip({ leftPercent: left + width / 2, span })}
        onMouseLeave={() => setTooltip(null)}
        style={{
          left: `${left}%`,
          width: `${width}%`
        }}
      />
    );
  });

  function handleRailClick(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    const nextReviewMs = Math.max(0, Math.min(ratio * reviewDurationMs, reviewDurationMs));
    onChange(nextReviewMs);
  }

  return (
    <div className="reviewTimelineRail" aria-label={ariaLabel}>
      <div className="timelineTrack" onClick={handleRailClick}>
        <div className="timelineSegments">{segments}</div>
        <div
          className="timelineMarker"
          style={{
            left: `${(Math.min(reviewMs, reviewDurationMs) / safeDurationMs) * 100}%`
          }}
        />
      </div>
      {tooltip ? <TimelineTooltip tooltip={tooltip} /> : null}
      <input
        aria-label={ariaLabel}
        className="timelineRangeInput"
        max={reviewDurationMs}
        min={0}
        onChange={(event) => onChange(Number(event.target.value))}
        step={250}
        type="range"
        value={Math.min(reviewMs, reviewDurationMs)}
      />
    </div>
  );
}

function TimelineTooltip({ tooltip }: { tooltip: NonNullable<TimelineTooltipState> }) {
  const { span } = tooltip;
  const rawDurationMs = Math.max(0, span.rawEndMs - span.rawStartMs);
  const reviewDurationMs = Math.max(0, span.reviewEndMs - span.reviewStartMs);
  const isCompacted = span.type === "long_silence" && reviewDurationMs < rawDurationMs;
  return (
    <div
      className="timelineTooltip"
      style={{
        left: `${Math.min(96, Math.max(4, tooltip.leftPercent))}%`
      }}
    >
      {span.type === "long_silence" ? (
        <>
          <strong>{isCompacted ? "已压缩静音" : "静音"}</strong>
          <span>原始 {formatTimelineDuration(rawDurationMs)}</span>
          <span>复盘保留 {formatTimelineDuration(reviewDurationMs)}</span>
        </>
      ) : (
        <>
          <strong>内容</strong>
          <span>原始 {formatTimelineRange(span.rawStartMs, span.rawEndMs)}</span>
          <span>复盘 {formatTimelineRange(span.reviewStartMs, span.reviewEndMs)}</span>
        </>
      )}
    </div>
  );
}

function formatTimelineRange(startMs: number, endMs: number) {
  return `${formatTimelineTime(startMs)}-${formatTimelineTime(endMs)}`;
}

function formatTimelineDuration(ms: number) {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return formatTimelineTime(ms);
}

function formatTimelineTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((Math.max(0, ms) % 1000) / 100);
  return ms < 10_000 && ms % 1000 !== 0
    ? `${minutes}:${seconds.toString().padStart(2, "0")}.${tenths}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
