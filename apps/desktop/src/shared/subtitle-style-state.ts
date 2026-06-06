export type SubtitleDisplayMode = "sentencePair" | "zonedPair";
export type LegacySubtitleDisplayMode = "bilingual" | "source" | "translation" | "line" | "split";
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
  displayMode: "sentencePair"
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

export function normalizeSubtitleDisplayMode(mode: SubtitleDisplayMode | LegacySubtitleDisplayMode): SubtitleDisplayMode {
  if (mode === "zonedPair") {
    return "zonedPair";
  }

  return "sentencePair";
}

export function subtitleDisplayModeLabel(mode: SubtitleDisplayMode): string {
  const labels: Record<SubtitleDisplayMode, string> = {
    sentencePair: "逐句对照",
    zonedPair: "分区对照"
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
