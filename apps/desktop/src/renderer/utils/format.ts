import type { TtsErrorEvent } from "../../shared/realtime-events";

export function formatMetricMs(value: number | null) {
  if (value === null) {
    return "--";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} s`;
  }
  return `${value} ms`;
}

export function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

export function formatPercent(value: number | null) {
  if (value === null) {
    return "--";
  }
  return `${Math.round(value * 100)}%`;
}

export function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

export function formatPreciseTime(ms: number) {
  const safeMs = Math.max(0, Math.round(ms));
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  const centiseconds = Math.floor((safeMs % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}

export function formatClock(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function compactStatusMessage(message: string, maxChars = 36) {
  const compacted = message.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxChars) {
    return compacted;
  }
  return `${compacted.slice(0, maxChars)}...`;
}

export function formatTtsErrorNotice(event: TtsErrorEvent) {
  if (event.code) {
    return `语音合成失败：${event.code}`;
  }
  return `语音合成失败：${compactStatusMessage(event.message)}`;
}
