import type { StartupUiState } from "../../../shared/session-ui-state";
import { AudioLoadingBars } from "../common/AudioLoadingBars";

export function SessionStartupOverlay({
  onCancel,
  onReturnHome,
  onRetry,
  startup
}: {
  onCancel: () => void;
  onReturnHome: () => void;
  onRetry: () => void;
  startup: StartupUiState;
}) {
  const isFailed = startup.phase === "failed";
  return (
    <div className="startupScrim" role="presentation">
      <section aria-live="polite" className={`startupCard phase-${startup.phase}`} role={isFailed ? "alertdialog" : "status"}>
        <AudioLoadingBars active={!isFailed} />
        <h2>{startup.message || "正在启动同传..."}</h2>
        {startup.detail ? <p>{startup.detail}</p> : null}
        {isFailed ? (
          <div className="dialogActions">
            <button className="safeAction" onClick={onReturnHome}>
              返回首页
            </button>
            <button className="primaryAction" onClick={onRetry}>
              重试
            </button>
          </div>
        ) : startup.canCancel ? (
          <button className="startupCancel" onClick={onCancel}>
            取消启动
          </button>
        ) : null}
      </section>
    </div>
  );
}
