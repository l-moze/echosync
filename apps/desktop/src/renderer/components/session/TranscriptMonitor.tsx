import { useEffect, useRef, type UIEvent } from "react";

import { captionStateDisplayLabel } from "../../../shared/subtitle-style-state";
import type { CaptionLine } from "../../../shared/caption-store";
import type { SessionUiEvent, SessionUiState } from "../../../shared/session-ui-state";
import { scrollTranscriptToBottom } from "../../utils/dom";
import { formatTime } from "../../utils/format";

export function TranscriptMonitor({
  activeLine,
  dispatchSessionUi,
  lines,
  sessionUi
}: {
  activeLine?: CaptionLine;
  dispatchSessionUi: (event: SessionUiEvent) => void;
  lines: CaptionLine[];
  sessionUi: SessionUiState;
}) {
  const monitorRef = useRef<HTMLDivElement | null>(null);
  const contentRevisionKey = lines.map((line) => `${line.id}:${line.rev}`).join("|");
  const visibleLines = lines.slice(-120);
  const previousContentRevisionKeyRef = useRef(contentRevisionKey);
  const dispatchRef = useRef(dispatchSessionUi);

  useEffect(() => {
    dispatchRef.current = dispatchSessionUi;
  }, [dispatchSessionUi]);

  useEffect(() => {
    if (previousContentRevisionKeyRef.current === contentRevisionKey) {
      return;
    }
    previousContentRevisionKeyRef.current = contentRevisionKey;
    dispatchRef.current({ type: "transcript.new_content" });

    if (sessionUi.autoScroll.mode === "following") {
      window.requestAnimationFrame(() => scrollTranscriptToBottom(monitorRef.current));
    }
  }, [contentRevisionKey, sessionUi.autoScroll.mode]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom > 72 && sessionUi.autoScroll.mode === "following") {
      dispatchSessionUi({ type: "transcript.user.scrolled_up" });
    }
    if (distanceToBottom < 24 && sessionUi.autoScroll.mode === "locked") {
      dispatchSessionUi({ type: "transcript.user.follow_current" });
    }
  }

  function handleSelection() {
    const selectedText = window.getSelection()?.toString().trim();
    if (selectedText && sessionUi.autoScroll.mode === "following") {
      dispatchSessionUi({ type: "transcript.user.selected_text" });
    }
  }

  function followCurrent() {
    dispatchSessionUi({ type: "transcript.user.follow_current" });
    window.requestAnimationFrame(() => scrollTranscriptToBottom(monitorRef.current));
  }

  return (
    <div
      className={sessionUi.autoScroll.mode === "locked" ? "transcriptMonitor locked" : "transcriptMonitor"}
      onMouseUp={handleSelection}
      onScroll={handleScroll}
      ref={monitorRef}
    >
      {sessionUi.autoScroll.mode === "locked" ? <div className="autoScrollState">已锁定回溯，新片段不会打断阅读。</div> : null}
      {visibleLines.map((line) => (
        <article className={`transcriptItem ${line.state}`} key={line.id}>
          <span>{formatTime(line.startMs)}-{formatTime(line.endMs)} · {captionStateDisplayLabel(line.state)}</span>
          <p className="sourceText">{line.sourceText}</p>
          <p className="targetText">{line.targetText}</p>
        </article>
      ))}
      {activeLine ? <p className="statusBox">当前片段：{activeLine.targetText}</p> : null}
      {sessionUi.autoScroll.newContentAvailable ? <button className="newContentButton" onClick={followCurrent}>有新内容，回到当前</button> : null}
    </div>
  );
}
