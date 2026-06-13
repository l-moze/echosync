import type { CaptionContentMode } from "../types/caption";

export const captionContentModes: Array<{ id: CaptionContentMode; label: string }> = [
  { id: "source", label: "原文" },
  { id: "target", label: "译文" },
  { id: "bilingual", label: "双语" }
];
