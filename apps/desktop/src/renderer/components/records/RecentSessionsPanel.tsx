import type { SessionRecordListItem } from "../../../shared/session-records";
import { SessionRecordTable } from "./SessionRecordTable";

export function RecentSessionsPanel({ records }: { records: SessionRecordListItem[] }) {
  const visibleRecords = records.slice(0, 2);
  return (
    <aside className="dashboardPanel recentRecordsPanel">
      <h2>会议记录</h2>
      <SessionRecordTable compact records={visibleRecords} />
      {visibleRecords.length === 0 ? <p className="archiveMissing">暂无已保存记录。</p> : null}
    </aside>
  );
}
