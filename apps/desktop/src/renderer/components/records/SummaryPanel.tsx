import type { ActionItem, Topic, Risk, Decision, TerminologySuggestion, EvidenceAnchor } from "../../../shared/session-records";
import { RecordSummaryList } from "./RecordSummaryList";

export function SummaryPanel({
  summary,
  keywords = [],
  tags = [],
  onCopy,
  actionItems = [],
  topics = [],
  risks = [],
  decisions = [],
  terminologySuggestions = [],
  onEvidenceClick
}: {
  summary: string;
  keywords?: Array<{ name: string; percentage: number }>;
  tags?: string[];
  onCopy?: () => void;
  actionItems?: ActionItem[];
  topics?: Topic[];
  risks?: Risk[];
  decisions?: Decision[];
  terminologySuggestions?: TerminologySuggestion[];
  onEvidenceClick?: (evidence: EvidenceAnchor) => void;
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

      {actionItems.length > 0 && (
        <>
          <h4>行动项</h4>
          <RecordSummaryList items={actionItems} type="action" onEvidenceClick={onEvidenceClick} />
        </>
      )}

      {topics.length > 0 && (
        <>
          <h4>主题</h4>
          <RecordSummaryList items={topics} type="topic" onEvidenceClick={onEvidenceClick} />
        </>
      )}

      {risks.length > 0 && (
        <>
          <h4>风险</h4>
          <RecordSummaryList items={risks} type="risk" onEvidenceClick={onEvidenceClick} />
        </>
      )}

      {decisions.length > 0 && (
        <>
          <h4>决策</h4>
          <RecordSummaryList items={decisions} type="decision" onEvidenceClick={onEvidenceClick} />
        </>
      )}

      {terminologySuggestions.length > 0 && (
        <>
          <h4 title="术语建议">术语建议</h4>
          <RecordSummaryList items={terminologySuggestions} type="term" onEvidenceClick={onEvidenceClick} />
        </>
      )}
    </aside>
  );
}
