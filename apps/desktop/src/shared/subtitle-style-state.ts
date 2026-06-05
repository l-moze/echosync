export type SubtitleDisplayMode = "split" | "line";
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
  outlineStyle: "shadow",
  translationFirst: false,
  displayMode: "split"
};

export function reduceSubtitleStyleState(
  state: SubtitleStyleState,
  patch: Partial<SubtitleStyleState>
): SubtitleStyleState {
  return { ...state, ...patch };
}
