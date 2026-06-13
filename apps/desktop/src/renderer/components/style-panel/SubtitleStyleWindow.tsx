import { useSharedSubtitleStyle } from "../../hooks/useSharedSubtitleStyle";
import { setSubtitleStyleWindowVisible } from "../../services/ipc/subtitle-style";
import { SubtitleStylePanel } from "./SubtitleStylePanel";

export function SubtitleStyleWindow() {
  const { subtitleStyle, updateSubtitleStyle } = useSharedSubtitleStyle();

  return (
    <main className="subtitleStyleWindowShell">
      <SubtitleStylePanel
        onChange={updateSubtitleStyle}
        onClose={() => void setSubtitleStyleWindowVisible(false)}
        subtitleStyle={subtitleStyle}
      />
    </main>
  );
}
