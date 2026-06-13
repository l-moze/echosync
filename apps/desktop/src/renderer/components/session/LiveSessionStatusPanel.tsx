import type { DesktopAudioSourceId } from "../../../shared/audio-source-catalog";
import type { CaptionLine } from "../../../shared/caption-store";
import { selectSessionHealthMetrics, type SessionUiState } from "../../../shared/session-ui-state";
import { HealthMetric } from "../common/HealthMetric";
import { formatMetricMs } from "../../utils/format";
import { audioActivityLabel, sourceLabel } from "../../utils/labels";

export function LiveSessionStatusPanel({
  lines,
  sessionUi,
  sourceId
}: {
  lines: CaptionLine[];
  sessionUi: SessionUiState;
  sourceId: DesktopAudioSourceId;
}) {
  const metrics = selectSessionHealthMetrics({ lines, sessionUi, sourceLabel: sourceLabel(sourceId) });
  return (
    <div className="healthGrid liveStatusGrid">
      <HealthMetric label="音频输入" value={audioActivityLabel(metrics.audioLevel)} />
      <HealthMetric label="延迟" value={formatMetricMs(metrics.firstCaptionLatencyMs)} />
      <HealthMetric label="稳定提交" value={formatMetricMs(metrics.stableCommitLatencyMs)} />
      <HealthMetric label="自动修订" value={`${metrics.patchCount} 次`} />
    </div>
  );
}
