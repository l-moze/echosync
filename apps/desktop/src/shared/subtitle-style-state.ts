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

export function normalizeSubtitleDisplayMode(mode: SubtitleDisplayMode | "line" | "split"): SubtitleDisplayMode {
  if (mode === "source" || mode === "translation") {
    return mode;
  }

  return "bilingual";
}
