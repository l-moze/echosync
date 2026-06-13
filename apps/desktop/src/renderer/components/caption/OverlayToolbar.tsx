import {
  subtitleDisplayModeLabel,
  type SubtitleDisplayMode
} from "../../../shared/subtitle-style-state";
import type { OverlayChromeMenu } from "../../types/overlay";
import { overlayDisplayModeAccessibleLabel } from "../../utils/labels";
import { ToolbarIcon } from "../common/ToolbarIcon";

export function OverlayToolbar({
  activeMenu,
  displayMode,
  isPinned,
  isInteractionLocked,
  isSettingsOpen,
  onDisplayModeChange,
  onInteractionLockToggle,
  onClose,
  onMenuToggle,
  onPinToggle,
  onMinimize,
  onSettingsToggle
}: {
  activeMenu: OverlayChromeMenu;
  displayMode: SubtitleDisplayMode;
  isPinned: boolean;
  isInteractionLocked: boolean;
  isSettingsOpen: boolean;
  onDisplayModeChange: (mode: SubtitleDisplayMode) => void;
  onInteractionLockToggle: () => void;
  onClose: () => void;
  onMenuToggle: (menu: Exclude<OverlayChromeMenu, null>) => void;
  onPinToggle: () => void;
  onMinimize: () => void;
  onSettingsToggle: () => void;
}) {
  const displayModes: SubtitleDisplayMode[] = ["sentencePair", "zonedPair"];
  return (
    <nav className="overlayToolbar" aria-label="字幕弹窗工具栏">
      <div className="overlayMenuCluster">
        <button
          aria-expanded={activeMenu === "display"}
          className={activeMenu === "display" ? "overlayMenuTrigger selected" : "overlayMenuTrigger"}
          onClick={() => onMenuToggle("display")}
          title="双语显示方式"
          type="button"
        >
          <ToolbarIcon name="target" />
          <span>{displayMode === "sentencePair" ? "逐句" : "分区"}</span>
          <span className="menuChevron">⌄</span>
        </button>
        {activeMenu === "display" ? (
          <div className="overlayDropdown top" role="menu" aria-label="双语显示方式">
            <span className="overlayDropdownHint">仅在双语模式下生效</span>
            {displayModes.map((mode) => (
              <button
                className={displayMode === mode ? "selected" : ""}
                aria-label={overlayDisplayModeAccessibleLabel(mode)}
                key={mode}
                onClick={() => onDisplayModeChange(mode)}
                role="menuitemradio"
                title={subtitleDisplayModeLabel(mode)}
                type="button"
              >
                <span className={`modePreview ${mode}`} aria-hidden="true">
                  <i />
                  <i />
                </span>
                <span>
                  <strong>{mode === "sentencePair" ? "逐句对照" : "分区对照"}</strong>
                  <small>{mode === "sentencePair" ? "按句分段，语意清晰" : "转写翻译，分区显示"}</small>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="overlayIconGroup">
        <div className={isInteractionLocked ? "lockToggleWrap locked" : "lockToggleWrap"}>
          <button
            aria-label={isInteractionLocked ? "解锁字幕" : "锁定字幕"}
            className={isInteractionLocked ? "lockToggleButton selected" : "lockToggleButton"}
            title={isInteractionLocked ? "解锁字幕" : "锁定字幕"}
            onClick={onInteractionLockToggle}
            type="button"
          >
            <ToolbarIcon name={isInteractionLocked ? "unlock" : "lock"} />
          </button>
          <span className="lockToggleHint">{isInteractionLocked ? "解锁字幕" : "锁定字幕"}</span>
        </div>
        <button className={isPinned ? "selected" : ""} title={isPinned ? "取消置顶" : "置于顶层"} onClick={onPinToggle} type="button">
          <ToolbarIcon name="pin" />
        </button>
        <button className={isSettingsOpen ? "selected" : ""} title="设置" onClick={onSettingsToggle} type="button">
          <ToolbarIcon name="settings" />
        </button>
        <button title="最小化" onClick={onMinimize} type="button">
          <ToolbarIcon name="minimize" />
        </button>
        <button title="关闭" onClick={onClose} type="button">
          <ToolbarIcon name="close" />
        </button>
      </div>
    </nav>
  );
}
