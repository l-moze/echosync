import { useRef, type ReactNode } from "react";

import { GradientButton } from "../common/GradientButton";

function formatDurationCompact(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}小时${minutes.toString().padStart(2, "0")}分${seconds.toString().padStart(2, "0")}秒`;
  }
  if (minutes > 0) {
    return `${minutes}分${seconds.toString().padStart(2, "0")}秒`;
  }
  return `${seconds}秒`;
}

export function RecordDetailHeader({
  title,
  onTitleChange,
  onExport,
  metadata,
  onReadSettings,
  children
}: {
  title: string;
  onTitleChange: (newTitle: string) => void;
  onExport: (format?: "txt" | "srt" | "markdown") => void;
  metadata: {
    duration: string;
    segmentCount: number;
    timeline?: {
      reviewDurationMs: number;
      rawDurationMs: number;
      contentDurationMs: number;
      compressionEnabled: boolean;
      onToggleCompression: () => void;
    };
  };
  onReadSettings?: () => void;
  children?: ReactNode;
}) {
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  function focusTitle() {
    const titleElement = titleRef.current;
    if (!titleElement) {
      return;
    }
    titleElement.focus();
    const range = document.createRange();
    range.selectNodeContents(titleElement);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  return (
    <section className="recordPanel recordHeaderCard" aria-label="记录信息与播放器">
      <div className="headerGrid">
        <div>
          <div className="docLabel">记录名称</div>
          <div className="titleRow">
            <h1
              className="recordTitle"
              contentEditable
              ref={titleRef}
              suppressContentEditableWarning
              onBlur={(e) => onTitleChange(e.currentTarget.textContent || "")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            >
              {title}
            </h1>
            <button className="renameBtn" aria-label="重命名" onClick={focusTitle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M4 20h4.4L19.2 9.2a2.1 2.1 0 0 0 0-3L17.8 4.8a2.1 2.1 0 0 0-3 0L4 15.6V20z" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M13.5 6.2l4.3 4.3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <div className="metaRow">
            <span className="saved">内容自动保存</span>
            <span className="dot" />
            <span>数据安全保护</span>
            <span className="dot" />
            <span>译文由 AI 生成</span>
            <span className="dot" />
            {metadata.timeline ? (
              <>
                <span>复盘 {formatDurationCompact(metadata.timeline.reviewDurationMs)}</span>
                <span className="dot" />
                <span>原始 {formatDurationCompact(metadata.timeline.rawDurationMs)}</span>
                <span className="dot" />
                <span>有效 {formatDurationCompact(metadata.timeline.contentDurationMs)}</span>
                <span className="dot" />
              </>
            ) : (
              <>
                <span>{metadata.duration}</span>
                <span className="dot" />
              </>
            )}
            <span>{metadata.segmentCount} 段字幕</span>
            {metadata.timeline && (
              <>
                <span className="dot" />
                <span
                  className="metaChip"
                  onClick={metadata.timeline.onToggleCompression}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      metadata.timeline?.onToggleCompression();
                    }
                  }}
                >
                  {metadata.timeline.compressionEnabled ? "压缩长静音" : "保留原始停顿"}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="headerActions">
          {onReadSettings && <button className="ghostBtn" onClick={onReadSettings}>阅读设置</button>}
          <button className="ghostBtn" onClick={() => onExport("txt")}>TXT</button>
          <button className="ghostBtn" onClick={() => onExport("srt")}>SRT</button>
          <GradientButton onClick={() => onExport("markdown")}>导出</GradientButton>
        </div>
      </div>
      {children}
    </section>
  );
}
