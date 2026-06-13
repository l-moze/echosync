import { useEffect, useRef, useState, type FormEvent } from "react";

import type { SessionUiEvent, SessionUiState } from "../../../shared/session-ui-state";
import { termStatusLabel } from "../../utils/labels";

export function TermQuickAdd({
  dispatchSessionUi,
  sessionUi
}: {
  dispatchSessionUi: (event: SessionUiEvent) => void;
  sessionUi: SessionUiState;
}) {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const syncTimersRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      syncTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  function submitTerm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSource = source.trim();
    const nextTarget = target.trim();
    if (!nextSource || !nextTarget) {
      return;
    }

    const nextId = `term_${sessionUi.terms.length + 1}`;
    dispatchSessionUi({ type: "term.add.requested", source: nextSource, target: nextTarget });
    const timer = window.setTimeout(() => {
      dispatchSessionUi({ type: "term.add.synced", id: nextId });
    }, 700);
    syncTimersRef.current.push(timer);
    setSource("");
    setTarget("");
  }

  return (
    <section className="termQuickAdd">
      <h3>临时术语</h3>
      <form className="termForm" onSubmit={submitTerm}>
        <input aria-label="原文术语" onChange={(event) => setSource(event.target.value)} placeholder="latency" value={source} />
        <input aria-label="译文术语" onChange={(event) => setTarget(event.target.value)} placeholder="延迟" value={target} />
        <button type="submit">加入</button>
      </form>
      <div className="termList">
        {sessionUi.terms.length > 0 ? (
          sessionUi.terms.slice(-4).map((term) => (
            <div className="termItem" key={term.id}>
              <span>{term.source} -&gt; {term.target}</span>
              <strong className={`termStatus ${term.status}`}>{termStatusLabel(term.status)}</strong>
            </div>
          ))
        ) : (
          <p className="statusBox">新术语会先同步，完成后从后续片段开始生效。</p>
        )}
      </div>
    </section>
  );
}
