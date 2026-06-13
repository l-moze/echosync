import { TabBar } from "../common/TabBar";
import { SearchField } from "../common/SearchField";

export function TranscriptToolbar({
  activeTab,
  onTabChange,
  searchValue,
  onSearchChange,
  searchResultCount,
  onPrevMatch,
  onNextMatch,
  tabs = [
    { id: "bilingual", label: "双语对照" },
    { id: "source", label: "原文字幕" }
  ]
}: {
  activeTab: string;
  onTabChange: (id: string) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchResultCount?: number;
  onPrevMatch?: () => void;
  onNextMatch?: () => void;
  tabs?: Array<{ id: string; label: string }>;
}) {
  const hasSearchMatches = Boolean(searchValue.trim() && searchResultCount && searchResultCount > 0);

  return (
    <div className="recordToolbar">
      <TabBar tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} />
      <div className="recordToolbarActions">
        <SearchField
          value={searchValue}
          onChange={onSearchChange}
          placeholder="搜索字幕内容…"
          resultCount={searchResultCount}
        />
        {onPrevMatch && (
          <button className="iconBtn" onClick={onPrevMatch} aria-label="上一个匹配" disabled={!hasSearchMatches}>
            ↑
          </button>
        )}
        {onNextMatch && (
          <button className="iconBtn" onClick={onNextMatch} aria-label="下一个匹配" disabled={!hasSearchMatches}>
            ↓
          </button>
        )}
      </div>
    </div>
  );
}
