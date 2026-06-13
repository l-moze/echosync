import { useEffect, useRef, useState } from "react";

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
  // 拖动中维护本地进度，让视觉跟手；松手或外部播放时回落到 currentMs
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingSeekMsRef = useRef<number | null>(null);

  // 通过 rAF 节流 seek 调用：mousemove 可达 120Hz，但每帧最多 seek 一次
  const scheduleSeek = (ms: number) => {
    pendingSeekMsRef.current = ms;
    setScrubMs(ms);
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (pendingSeekMsRef.current !== null) {
        onSeek(pendingSeekMsRef.current);
        pendingSeekMsRef.current = null;
      }
    });
  };

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const effectiveMs = scrubMs ?? currentMs;
  const progress = durationMs > 0 ? (effectiveMs / durationMs) * 100 : 0;
  const boundedCurrentMs = Math.min(effectiveMs, durationMs);

  const seekFromClientX = (clientX: number, rect: DOMRect) => {
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    scheduleSeek(percent * durationMs);
  };

  const handleInteraction = (e: React.MouseEvent<HTMLDivElement>) => {
    seekFromClientX(e.clientX, e.currentTarget.getBoundingClientRect());
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
          const rect = e.currentTarget.getBoundingClientRect();
          seekFromClientX(e.clientX, rect);

          const handleMouseMove = (moveEvent: MouseEvent) => {
            seekFromClientX(moveEvent.clientX, rect);
          };

          const handleMouseUp = (upEvent: MouseEvent) => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
            // 松手时立即 commit 最终位置，并清除本地 scrub，回落到外部播放进度
            if (rafRef.current !== null) {
              cancelAnimationFrame(rafRef.current);
              rafRef.current = null;
            }
            const percent = Math.max(0, Math.min(1, (upEvent.clientX - rect.left) / rect.width));
            onSeek(percent * durationMs);
            pendingSeekMsRef.current = null;
            setScrubMs(null);
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
