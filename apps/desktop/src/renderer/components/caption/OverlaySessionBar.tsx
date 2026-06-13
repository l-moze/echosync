import type { DesktopCaptureSnapshot } from "../../../shared/desktop-api";
import type { TranslationProviderSelection } from "../../../shared/translation-provider-catalog";
import { captionContentModes } from "../../constants/caption";
import type { CaptionContentMode } from "../../types/caption";
import type { LanguageDirectionOption } from "../../types/language";
import type { OverlayChromeMenu } from "../../types/overlay";
import { formatClock } from "../../utils/format";
import { ToolbarIcon } from "../common/ToolbarIcon";

export function OverlaySessionBar({
  activeMenu,
  captionContentMode,
  durationMs,
  isListening,
  languageDirection,
  onCaptureToggle,
  onContentModeChange,
  onMenuToggle,
  onMicrophoneSelect,
  onSystemSelect,
  planLabel,
  snapshot
}: {
  activeMenu: OverlayChromeMenu;
  captionContentMode: CaptionContentMode;
  durationMs: number;
  isListening: boolean;
  languageDirection: LanguageDirectionOption;
  onCaptureToggle: () => void;
  onContentModeChange: (mode: CaptionContentMode) => void;
  onMenuToggle: (menu: Exclude<OverlayChromeMenu, null>) => void;
  onMicrophoneSelect: () => void;
  onSystemSelect: () => void;
  planLabel: string;
  snapshot: DesktopCaptureSnapshot;
}) {
  return (
    <div className="overlaySessionBar">
      <div className="inputSwitchGroup" aria-label="输入切换" role="group">
        <button
          className={snapshot.sourceId === "microphone" ? "roundSessionButton active" : "roundSessionButton"}
          title="麦克风"
          onClick={onMicrophoneSelect}
          type="button"
        >
          <ToolbarIcon name="mic" />
        </button>
        <button
          className={snapshot.sourceId === "windows-system" ? "roundSessionButton active" : "roundSessionButton"}
          title="Windows 系统声音"
          onClick={onSystemSelect}
          type="button"
        >
          <ToolbarIcon name="system" />
        </button>
      </div>
      <button
        className={isListening ? "roundSessionButton active" : "roundSessionButton"}
        title={isListening ? "停止同传" : "开始同传"}
        onClick={onCaptureToggle}
        type="button"
      >
        <ToolbarIcon name="power" />
      </button>
      <span className="sessionTimer">{formatClock(durationMs)}</span>
      <div className="overlaySessionMenuWrap planMenuWrap">
        <button
          aria-expanded={activeMenu === "plan"}
          className={activeMenu === "plan" ? "sessionPill actionPill planPill selected" : "sessionPill actionPill planPill"}
          onClick={() => onMenuToggle("plan")}
          title="模型或方案设置"
          type="button"
        >
          <ToolbarIcon name="model" />
          <span>{planLabel}</span>
          <span className="menuChevron">⌄</span>
        </button>
      </div>
      <div className="overlaySessionMenuWrap languageMenuWrap">
        <button
          aria-expanded={activeMenu === "language"}
          className={activeMenu === "language" ? "sessionPill actionPill languagePill selected" : "sessionPill actionPill languagePill"}
          onClick={() => onMenuToggle("language")}
          title={languageDirection.label}
          type="button"
        >
          <span>{languageDirection.shortLabel}</span>
          <span className="menuChevron">⌄</span>
        </button>
      </div>
      <div className="captionContentSwitch" role="group" aria-label="字幕内容">
        {captionContentModes.map((mode) => (
          <button
            className={captionContentMode === mode.id ? "selected" : ""}
            key={mode.id}
            onClick={() => onContentModeChange(mode.id)}
            type="button"
          >
            {mode.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export type OverlayPlanOption = {
  id: TranslationProviderSelection;
  description: string;
  disabled: boolean;
  label: string;
  selected: boolean;
};
