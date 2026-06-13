import { useState } from "react";

import type { SessionRecordListItem } from "../../../shared/session-records";

const RECORD_LIST_COLUMNS = ["标题", "结束时间", "时长", "操作"];

export function SessionRecordTable({
  compact = false,
  onDelete,
  onView,
  records,
  selectedId
}: {
  compact?: boolean;
  onDelete?: (recordId: string) => void;
  onView?: (recordId: string) => void;
  records: SessionRecordListItem[];
  selectedId?: string;
}) {
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const totalPages = Math.ceil(records.length / pageSize);
  const visibleRecords = records.slice(page * pageSize, (page + 1) * pageSize);
  const hasRecordActions = Boolean(onView || onDelete);

  return (
    <>
      <div className={compact ? "recordTable compact" : "recordTable"} role="table" aria-label="会议记录列表">
        <div className="recordTableHead" role="row">
          {RECORD_LIST_COLUMNS.map((column) => (
            <span key={column} role="columnheader">{column}</span>
          ))}
        </div>
        <div className="recordTableBody">
          {visibleRecords.map((record) => (
            <div
              className={record.id === selectedId ? "recordTableRow selected" : "recordTableRow"}
              key={record.id}
              onClick={onView ? () => onView(record.id) : undefined}
              role="row"
            >
              <strong role="cell">{record.title}</strong>
              <span role="cell">{record.endedAt}</span>
              <span role="cell">{record.duration}</span>
              {hasRecordActions ? (
                <span className="recordActions" role="cell">
                  {onView ? <button onClick={(event) => { event.stopPropagation(); onView(record.id); }} title="查看详情">查看</button> : null}
                  {onDelete ? <button onClick={(event) => { event.stopPropagation(); onDelete(record.id); }} title="删除记录">删除</button> : null}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      {totalPages > 1 ? (
        <div className="recordPagination">
          <button disabled={page === 0} onClick={() => setPage(0)} type="button">首页</button>
          <button disabled={page === 0} onClick={() => setPage(page - 1)} type="button">上一页</button>
          <span>{page + 1} / {totalPages}</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} type="button">下一页</button>
          <button disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} type="button">末页</button>
        </div>
      ) : null}
    </>
  );
}
