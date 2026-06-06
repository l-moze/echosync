export type SubtitleDisplayMode = "bilingual" | "source" | "translation";
export type SubtitleOutlineStyle = "outline" | "shadow" | "none";

export type SubtitleStyleState = {
  sourceScale: number;
  targetScale: number;
  sourceColor: string;
  targetColor: string;
  sourceFont: string;
  targetFont: string;
  sourceBold: boolean;
  targetBold: boolean;
  backgroundOpacity: number;
  backgroundBlur: number;
  windowShadow: number;
  outlineStyle: SubtitleOutlineStyle;
  translationFirst: boolean;
  displayMode: SubtitleDisplayMode;
};

export const defaultSubtitleStyle: SubtitleStyleState = {
  sourceScale: 18,
  targetScale: 30,
  sourceColor: "#e4e7ee",
  targetColor: "#ffffff",
  sourceFont: "System",
  targetFont: "System",
  sourceBold: false,
  targetBold: true,
  backgroundOpacity: 0.76,
  backgroundBlur: 24,
  windowShadow: 0.72,
  outlineStyle: "shadow",
  translationFirst: false,
  displayMode: "bilingual"
};

export function reduceSubtitleStyleState(
  state: SubtitleStyleState,
  patch: Partial<SubtitleStyleState>
): SubtitleStyleState {
  const next = { ...state, ...patch };
  return { ...next, displayMode: normalizeSubtitleDisplayMode(next.displayMode) };
}

export function selectSubtitleFontWeight(kind: "source" | "target", bold: boolean) {
  if (kind === "source") {
    return bold ? 800 : 400;
  }

  return bold ? 850 : 500;
}

export function normalizeSubtitleDisplayMode(mode: SubtitleDisplayMode | "line" | "split"): SubtitleDisplayMode {
  if (mode === "source" || mode === "translation") {
    return mode;
  }

  return "bilingual";
}

export function subtitleDisplayModeLabel(mode: SubtitleDisplayMode): string {
  const labels: Record<SubtitleDisplayMode, string> = {
    bilingual: "双语字幕",
    source: "只看原文",
    translation: "只看译文"
  };
  return labels[mode];
}

export type CaptionStateDisplay = "interim" | "stable" | "revised" | "locked";

export function captionStateDisplayLabel(state: CaptionStateDisplay): string {
  const labels: Record<CaptionStateDisplay, string> = {
    interim: "临时",
    stable: "稳定",
    revised: "已修订",
    locked: "已锁定"
  };
  return labels[state];
}
