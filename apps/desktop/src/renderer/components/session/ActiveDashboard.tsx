import type { DesktopAudioSourceId } from "../../../shared/audio-source-catalog";
import type { AgentCapabilities } from "../../../shared/agent-capabilities";
import { asrLatencyModeLabel, type AsrLatencyMode, type AsrProviderSelection } from "../../../shared/asr-provider-catalog";
import type { CaptionLine } from "../../../shared/caption-store";
import type { SessionUiEvent, SessionUiState } from "../../../shared/session-ui-state";
import { HealthMetric } from "../common/HealthMetric";
import { LiveSessionStatusPanel } from "./LiveSessionStatusPanel";
import { TermQuickAdd } from "./TermQuickAdd";
import { TranscriptMonitor } from "./TranscriptMonitor";

export function ActiveDashboard({
  activeLine,
  asrLatencyMode,
  lines,
  onShowOverlay,
  onStop,
  overlayLocked,
  dispatchSessionUi,
  sessionUi,
  sourceId,
  toggleOverlayLocked
}: {
  activeLine?: CaptionLine;
  agentCapabilities: AgentCapabilities | null;
  asrLatencyMode: AsrLatencyMode;
  asrProvider: AsrProviderSelection;
  lines: CaptionLine[];
  onShowOverlay: () => void;
  onStop: () => void;
  overlayLocked: boolean;
  dispatchSessionUi: (event: SessionUiEvent) => void;
  sessionUi: SessionUiState;
  sourceId: DesktopAudioSourceId;
  toggleOverlayLocked: () => void;
}) {
  return (
    <div className="dashboardGrid">
      <section className="dashboardPanel">
        <div className="activeToolbar">
          <span className="centerPill">同传中</span>
          <button onClick={onShowOverlay} title="恢复字幕悬浮窗">
            恢复悬浮窗
          </button>
          <button onClick={onStop}>停止并复盘</button>
          <button className={overlayLocked ? "selected" : ""} onClick={toggleOverlayLocked}>
            {overlayLocked ? "穿透中" : "允许交互"}
          </button>
        </div>
        <TranscriptMonitor activeLine={activeLine} dispatchSessionUi={dispatchSessionUi} lines={lines} sessionUi={sessionUi} />
      </section>
      <aside className="dashboardPanel">
        <h2>正在同传</h2>
        <HealthMetric label="质量模式" value={asrLatencyModeLabel(asrLatencyMode)} />
        <HealthMetric label="字幕窗" value={overlayLocked ? "鼠标穿透" : "可交互"} />
        <LiveSessionStatusPanel lines={lines} sessionUi={sessionUi} sourceId={sourceId} />
        <details className="liveUtilityDetails">
          <summary>临时术语</summary>
          <TermQuickAdd dispatchSessionUi={dispatchSessionUi} sessionUi={sessionUi} />
        </details>
      </aside>
    </div>
  );
}
