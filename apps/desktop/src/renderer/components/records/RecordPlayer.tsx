import type { CSSProperties } from "react";

import type { ReviewTimeline } from "../../../shared/review-timeline";
import { WaveformProgress } from "../common/WaveformProgress";

function formatPlaybackSpeed(speed: number) {
  return Number.isInteger(speed) ? speed.toFixed(1) : speed.toString();
}

export function RecordPlayer({
  isPlaying,
  currentMs,
  durationMs,
  onPlayPause,
  onSeek,
  volume = 72,
  speed = 1.0,
  onVolumeChange,
  onSpeedChange,
  timeline
}: {
  isPlaying: boolean;
  currentMs: number;
  durationMs: number;
  onPlayPause: () => void;
  onSeek: (ms: number) => void;
  volume?: number;
  speed?: number;
  onVolumeChange?: (volume: number) => void;
  onSpeedChange?: () => void;
  timeline?: ReviewTimeline;
}) {
  return (
    <div className="recordPlayer">
      <button className="recordPlayButton" onClick={onPlayPause} aria-label={isPlaying ? "暂停" : "播放"}>
        {isPlaying ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5.8v12.4c0 .76.83 1.24 1.5.85l10.05-6.2a1 1 0 0 0 0-1.7L9.5 4.95A1 1 0 0 0 8 5.8z"/>
          </svg>
        )}
      </button>
      <WaveformProgress currentMs={currentMs} durationMs={durationMs} onSeek={onSeek} timeline={timeline} />
      <div className="recordPlayerControls">
        <label className="recordVolumeControl">
          <span>音量</span>
          <input
            aria-label="音量"
            className="recordVolumeSlider"
            max={100}
            min={0}
            onChange={(event) => onVolumeChange?.(Number(event.target.value))}
            style={{ "--volume-percent": `${volume}%` } as CSSProperties}
            type="range"
            value={volume}
          />
        </label>
        <button className="ghostBtn" onClick={onSpeedChange} disabled={!onSpeedChange}>
          {formatPlaybackSpeed(speed)}x
        </button>
      </div>
    </div>
  );
}
