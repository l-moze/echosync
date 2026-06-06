import type { CaptionLine } from "./caption-store";
import { normalizeSubtitleDisplayMode, type SubtitleStyleState } from "./subtitle-style-state";

export type CaptionTextPart = {
  kind: "source" | "target";
  text: string;
  state: CaptionLine["state"];
};

export function selectCaptionTextParts(
  line: CaptionLine | undefined,
  subtitleStyle: SubtitleStyleState
): CaptionTextPart[] {
  const displayMode = normalizeSubtitleDisplayMode(subtitleStyle.displayMode);
  const sourceText = line?.sourceText.trim() || "Waiting for audio stream...";
  const targetText = line
    ? line.targetText.trim()
    : "等待 Windows 系统声音或麦克风输入";
  const state = line?.state ?? "interim";
  const source: CaptionTextPart = { kind: "source", text: sourceText, state };
  const target: CaptionTextPart | null = targetText
    ? { kind: "target", text: targetText, state }
    : null;

  if (displayMode === "source") {
    return [source];
  }

  if (displayMode === "translation") {
    return target ? [target] : [];
  }

  if (subtitleStyle.translationFirst && target) {
    return [target, source];
  }

  return target ? [source, target] : [source];
}
