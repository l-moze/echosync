import type { TranslationProviderSelection } from "../../../shared/translation-provider-catalog";
import { languageDirectionOptions } from "../../constants/language";
import type { LanguageDirectionId, LanguageDirectionOption } from "../../types/language";
import type { OverlayChromeMenu } from "../../types/overlay";
import type { OverlayPlanOption } from "./OverlaySessionBar";

export function OverlayBottomMenuDock({
  activeMenu,
  languageDirection,
  onLanguageDirectionSelect,
  onPlanSelect,
  planOptions
}: {
  activeMenu: OverlayChromeMenu;
  languageDirection: LanguageDirectionOption;
  onLanguageDirectionSelect: (directionId: LanguageDirectionId) => void;
  onPlanSelect: (provider: TranslationProviderSelection) => void;
  planOptions: OverlayPlanOption[];
}) {
  if (activeMenu === "plan") {
    return (
      <div className="captionMenuDock menu-plan">
        <div className="overlayDropdown dockedOverlayMenu planMenu" role="menu" aria-label="模型或方案设置">
          <span className="overlayDropdownHint">切换后用于下一次启动或重启同传</span>
          {planOptions.map((option) => (
            <button
              className={option.selected ? "selected" : ""}
              disabled={option.disabled}
              key={option.id}
              onClick={() => onPlanSelect(option.id)}
              role="menuitemradio"
              title={option.description}
              type="button"
            >
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (activeMenu === "language") {
    return (
      <div className="captionMenuDock menu-language">
        <div className="overlayDropdown dockedOverlayMenu languageMenu" role="menu" aria-label="语言设置">
          {languageDirectionOptions.map((option) => (
            <button
              className={option.id === languageDirection.id ? "selected" : ""}
              key={option.id}
              onClick={() => onLanguageDirectionSelect(option.id)}
              role="menuitemradio"
              title={option.label}
              type="button"
            >
              <span>
                <strong>{option.shortLabel}</strong>
                <small>{option.label}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return null;
}
