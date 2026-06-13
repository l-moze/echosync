import {
  closeDesktopWindow,
  minimizeDesktopWindow,
  toggleDesktopWindowMaximize
} from "../../services/ipc/window-controls";

export function AppTitleBar({
  canNavigateBack,
  onBack,
  pageTitle,
  statusLabel
}: {
  canNavigateBack: boolean;
  onBack: () => void;
  pageTitle: string;
  statusLabel: string;
}) {
  return (
    <header className="titleBar">
      <div className="titleBarLeft">
        {canNavigateBack ? (
          <button aria-label="返回首页" className="backButton" title="返回首页" onClick={onBack}>
            ‹
          </button>
        ) : null}
        <div className="brand">
          <span aria-hidden="true" className="appBrandMark" />
          <strong>{pageTitle}</strong>
        </div>
      </div>
      <div className="centerPill">{statusLabel}</div>
      <div className="windowActions">
        <button title="最小化" onClick={() => void minimizeDesktopWindow()}>
          -
        </button>
        <button title="最大化/还原" onClick={() => void toggleDesktopWindowMaximize()}>
          ⛶
        </button>
        <button title="关闭" onClick={() => void closeDesktopWindow()}>
          ×
        </button>
      </div>
    </header>
  );
}
