import type { EvidenceAnchor } from "../../../shared/session-records";

export function EvidenceBadge({
  evidence,
  onClick
}: {
  evidence: EvidenceAnchor;
  onClick: () => void;
}) {
  const formatTime = (ms: number) => {
    const sec = Math.floor(ms / 1000);
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    return `${min}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <button
      className="evidenceBadge"
      onClick={onClick}
      type="button"
      title={`跳转到 ${formatTime(evidence.startMs)}`}
    >
      {formatTime(evidence.startMs)}
    </button>
  );
}
