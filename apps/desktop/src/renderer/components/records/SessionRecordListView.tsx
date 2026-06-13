import type { SessionRecordListItem } from "../../../shared/session-records";
import { SessionRecordTable } from "./SessionRecordTable";

export function SessionRecordListView({
  deleteId,
  filteredRecords,
  onClose,
  onDeleteCancel,
  onDeleteConfirm,
  onDeleteRequest,
  onSearchChange,
  onView,
  records,
  searchQuery
}: {
  deleteId: string | null;
  filteredRecords: SessionRecordListItem[];
  onClose: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: (recordId: string) => void;
  onDeleteRequest: (recordId: string) => void;
  onSearchChange: (query: string) => void;
  onView: (recordId: string) => void;
  records: SessionRecordListItem[];
  searchQuery: string;
}) {
  return (
    <>
      <header className="recordHeader">
        <div>
          <p>记录</p>
          <h2>会议记录</h2>
        </div>
        <label>
          <span>搜索会议名称</span>
          <input
            aria-label="搜索会议名称"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索会议名称"
            value={searchQuery}
          />
        </label>
        <button aria-label="关闭会议记录" onClick={onClose}>×</button>
      </header>
      <div className="recordListContainer">
        <SessionRecordTable
          onDelete={onDeleteRequest}
          onView={onView}
          records={filteredRecords}
        />
        {deleteId ? (
          <section className="recordDeleteConfirm" role="alert">
            <span>删除后将移除本地记录。</span>
            <button onClick={onDeleteCancel}>取消</button>
            <button onClick={() => onDeleteConfirm(deleteId)}>确认删除</button>
          </section>
        ) : null}
        {records.length === 0 ? <p className="archiveMissing">暂无已保存记录。</p> : null}
        {records.length > 0 && filteredRecords.length === 0 ? <p className="archiveMissing">没有匹配的会议记录。</p> : null}
      </div>
    </>
  );
}
