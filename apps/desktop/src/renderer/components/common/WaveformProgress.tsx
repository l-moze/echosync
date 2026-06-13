import type { ReviewTimeline } from "../../../shared/review-timeline";

export function WaveformProgress({
  currentMs,
  durationMs,
  onSeek,
  timeline
}: {
  currentMs: number;
  durationMs: number;
  onSeek: (ms: number) => void;
  timeline?: ReviewTimeline;
}) {
  const progress = durationMs > 0 ? (currentMs / durationMs) * 100 : 0;
  const boundedCurrentMs = Math.min(currentMs, durationMs);

  const handleInteraction = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(percent * durationMs);
  };

  // Timeline segments rendering (content/silence visualization)
  const timelineSegments = timeline?.spans.map((span, index) => {
    const left = durationMs > 0 ? (span.reviewStartMs / durationMs) * 100 : 0;
    const width = durationMs > 0 ? ((span.reviewEndMs - span.reviewStartMs) / durationMs) * 100 : 0;
    const className = span.type === "long_silence" ? "timelineSegment silence" : "timelineSegment content";

    return (
      <div
        key={`${span.rawStartMs}-${span.rawEndMs}-${index}`}
        className={className}
        style={{
          left: `${left}%`,
          width: `${width}%`
        }}
      />
    );
  });

  return (
    <div className="waveformProgress">
      <div className="timeRow">
        <span>{formatTime(currentMs)}</span>
        <span>{formatTime(durationMs)}</span>
      </div>
      <input
        aria-label="音频回放进度"
        className="srOnlyRange"
        max={durationMs}
        min={0}
        onChange={(event) => onSeek(Number(event.target.value))}
        type="range"
        value={boundedCurrentMs}
      />
      <div
        className="wave"
        onClick={handleInteraction}
        onMouseDown={(e) => {
          e.preventDefault();
          handleInteraction(e);

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const rect = (e.target as HTMLElement).getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
            onSeek(percent * durationMs);
          };

          const handleMouseUp = () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
          };

          document.addEventListener("mousemove", handleMouseMove);
          document.addEventListener("mouseup", handleMouseUp);
        }}
      >
        {timelineSegments}
        <div className="waveFill" style={{ width: `${progress}%` }} />
        <span className="knob" style={{ left: `${progress}%` }} />
      </div>
    </div>
  );
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
