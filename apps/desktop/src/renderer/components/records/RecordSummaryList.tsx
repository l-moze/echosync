import type { EvidenceAnchor } from "../../../shared/session-records";
import { EvidenceBadge } from "./EvidenceBadge";

type SummaryListItem = {
  id: string;
  text?: string;
  sourceText?: string;
  targetText?: string;
  evidence?: EvidenceAnchor[];
};

export function RecordSummaryList({
  items,
  type,
  onEvidenceClick
}: {
  items: Array<{
    id: string;
    text?: string;
    sourceText?: string;
    targetText?: string;
    evidence?: EvidenceAnchor[];
  }>;
  type: "action" | "topic" | "risk" | "decision" | "term";
  onEvidenceClick?: (evidence: EvidenceAnchor) => void;
}) {
  const displayItems = items
    .map((item) => ({
      id: item.id,
      text: summaryListDisplayText(item, type),
      evidence: item.evidence
    }))
    .filter((item) => item.text);

  if (displayItems.length === 0) {
    return null;
  }

  return (
    <ul className="recordSummaryList">
      {displayItems.map((item) => (
        <li key={item.id}>
          <span className="summaryItemText">{item.text}</span>
          {onEvidenceClick && item.evidence && item.evidence.length > 0 && (
            <span className="evidenceList">
              {item.evidence.map((ev, i) => (
                <EvidenceBadge key={i} evidence={ev} onClick={() => onEvidenceClick(ev)} />
              ))}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function summaryListDisplayText(
  item: SummaryListItem,
  type: "action" | "topic" | "risk" | "decision" | "term"
): string {
  if (type !== "term") {
    return item.text?.trim() ?? "";
  }
  const sourceText = item.sourceText?.trim() ?? "";
  const targetText = item.targetText?.trim() ?? "";
  if (!sourceText || !targetText) {
    return "";
  }
  return `${sourceText} → ${targetText}`;
}
