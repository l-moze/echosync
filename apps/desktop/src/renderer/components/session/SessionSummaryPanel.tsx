import type { CaptionLine } from "../../../shared/caption-store";
import type { SessionUiState } from "../../../shared/session-ui-state";
import { HealthMetric } from "../common/HealthMetric";

export function SessionSummaryPanel({
  lines,
  sessionUi
}: {
  lines: CaptionLine[];
  sessionUi: SessionUiState;
}) {
  return (
    <div className="summaryMetrics">
      <HealthMetric label="片段数" value={`${sessionUi.summary?.segmentCount ?? lines.length}`} />
      <HealthMetric label="修订次数" value={`${sessionUi.summary?.patchCount ?? 0}`} />
      <HealthMetric label="总字数" value={`${sessionUi.summary?.wordCount ?? 0}`} />
      <HealthMetric label="平均延迟" value={`${sessionUi.summary?.averageLatencyMs ?? 0} ms`} />
    </div>
  );
}
