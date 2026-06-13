import { useEffect, useState } from "react";

import {
  defaultSubtitleStyle,
  reduceSubtitleStyleState,
  type SubtitleStyleState
} from "../../shared/subtitle-style-state";
import { onSubtitleStyleChange, updateSharedSubtitleStyle } from "../services/ipc/subtitle-style";

export function useSharedSubtitleStyle() {
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyleState>(defaultSubtitleStyle);

  useEffect(() => {
    return onSubtitleStyleChange((style) => {
      setSubtitleStyle((current) => reduceSubtitleStyleState(current, style));
    });
  }, []);

  function updateSubtitleStyle(next: Partial<SubtitleStyleState>) {
    setSubtitleStyle((current) => reduceSubtitleStyleState(current, next));
    void updateSharedSubtitleStyle(next);
  }

  return { subtitleStyle, updateSubtitleStyle };
}
