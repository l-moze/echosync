export function SummaryPanel({
  summary,
  keywords = [],
  tags = [],
  onCopy
}: {
  summary: string;
  keywords?: Array<{ name: string; percentage: number }>;
  tags?: string[];
  onCopy?: () => void;
}) {
  return (
    <aside className="recordSummaryPanel">
      <div className="recordSummaryHead">
        <div className="recordSummaryTitle">摘要</div>
        {onCopy && (
          <button className="recordSummaryCopyButton" onClick={onCopy}>
            复制
          </button>
        )}
      </div>
      <p className="recordSummaryText">{summary}</p>
      {tags.length > 0 && (
        <div className="recordSummaryChips">
          {tags.map((tag, i) => (
            <span key={i} className="recordSummaryChip">{tag}</span>
          ))}
        </div>
      )}
      {keywords.length > 0 && (
        <>
          <h2 className="recordSummarySectionTitle">关键词</h2>
          <div className="recordKeywordList">
            {keywords.map((kw, i) => (
              <div key={i} className="recordKeywordRow">
                <span className="recordKeywordName">{kw.name}</span>
                <span className="recordKeywordBar">
                  <span style={{ width: `${kw.percentage}%` }} />
                </span>
                <span className="recordKeywordPercent">{kw.percentage}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
