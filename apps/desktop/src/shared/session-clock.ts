import type { CaptionLine } from "./caption-store";

export type SessionClockInput = {
  isListening: boolean;
  lines: Pick<CaptionLine, "endMs">[];
  nowMs: number;
  startedAtMs: number | null;
};

export function selectSessionClockMs({ isListening, lines, nowMs, startedAtMs }: SessionClockInput): number {
  const transcriptDurationMs = Math.max(0, ...lines.map((line) => line.endMs));
  if (!isListening) {
    return transcriptDurationMs;
  }

  const wallClockDurationMs = startedAtMs === null ? 0 : Math.max(0, nowMs - startedAtMs);
  return Math.max(transcriptDurationMs, wallClockDurationMs);
}
