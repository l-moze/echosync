import type { RefObject } from "react";

import type { SessionRecord, SessionRecordExportFormat, SessionRecordSegment, EvidenceAnchor } from "../../../shared/session-records";
import { formatDurationForRecord } from "../../../shared/session-records";
import { formatTime } from "../../utils/format";
import { selectedRecordSegmentSourceText, selectedRecordSegmentTargetText } from "../../utils/session-records";
import { RecordDetailHeader } from "./RecordDetailHeader";
import { RecordPlayer } from "./RecordPlayer";
import { SummaryPanel } from "./SummaryPanel";
import { TranscriptSegment } from "./TranscriptSegment";
import { TranscriptToolbar } from "./TranscriptToolbar";
import { useReviewPlaybackTimeline } from "../../use-review-playback-timeline";
import type { ReviewTimeline } from "../../../shared/review-timeline";

type TranscriptTab = "bilingual" | "source" | "translation";

export function SessionRecordDetailPanel({
  activeMatchSegmentId,
  activeSegmentId,
  activeTab,
  audioStatus,
  currentPlaybackMs,
  durationMs,
  exportStatus,
  isAudioPlaying,
  onAudioCanPlay,
  onAudioEnded,
  onAudioError,
  onAudioLoadedMetadata,
  onAudioPause,
  onAudioPlay,
  onAudioTimeUpdate,
  onCopySummary,
  onEvidenceClick,
  onExport,
  onNextSearchMatch,
  onPrevSearchMatch,
  onReadSettings,
  onSeek,
  onSegmentPlay,
  onSearchChange,
  onTabChange,
  onTitleChange,
  onToggleAudioPlayback,
  onVolumeChange,
  onSpeedChange,
  record,
  recordAudioRef,
  recordAudioUrl,
  recordSegmentRefs,
  reviewScale,
  searchMatchCount,
  searchQuery,
  speed,
  volume,
  title
}: {
  activeMatchSegmentId: string | null;
  activeSegmentId: string | null;
  activeTab: TranscriptTab;
  audioStatus: "idle" | "loading" | "ready" | "missing" | "failed";
  currentPlaybackMs: number;
  durationMs: number;
  exportStatus: string;
  isAudioPlaying: boolean;
  onAudioCanPlay: (audio: HTMLAudioElement) => void;
  onAudioEnded: () => void;
  onAudioError: () => void;
  onAudioLoadedMetadata: (audio: HTMLAudioElement) => void;
  onAudioPause: () => void;
  onAudioPlay: () => void;
  onAudioTimeUpdate: (currentMs: number) => void;
  onCopySummary: () => void;
  onEvidenceClick?: (evidence: EvidenceAnchor) => void;
  onExport: (format?: SessionRecordExportFormat) => void;
  onNextSearchMatch: () => void;
  onPrevSearchMatch: () => void;
  onReadSettings?: () => void;
  onSeek: (ms: number) => void;
  onSegmentPlay: (segment: SessionRecordSegment) => void;
  onSearchChange: (query: string) => void;
  onTabChange: (tab: string) => void;
  onTitleChange: (newTitle: string) => void;
  onToggleAudioPlayback: () => void;
  onVolumeChange?: (volume: number) => void;
  onSpeedChange?: () => void;
  record: SessionRecord;
  recordAudioRef: RefObject<HTMLAudioElement | null>;
  recordAudioUrl: string | null;
  recordSegmentRefs: RefObject<Record<string, HTMLElement | null>>;
  reviewScale: number;
  searchMatchCount: number;
  searchQuery: string;
  speed: number;
  volume: number;
  title: string;
}) {
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  // Timeline integration: convert SessionRecordTimeline to ReviewTimeline
  const reviewTimeline: ReviewTimeline | null = record.timeline
    ? {
        spans: record.timeline.spans.map((span) => {
          if (span.kind === "silence") {
            return {
              type: "long_silence" as const,
              rawStartMs: span.rawStartMs,
              rawEndMs: span.rawEndMs,
              reviewStartMs: span.reviewStartMs,
              reviewEndMs: span.reviewEndMs,
              compactMs: span.reviewEndMs - span.reviewStartMs
            };
          }
          return {
            type: "active_audio" as const,
            rawStartMs: span.rawStartMs,
            rawEndMs: span.rawEndMs,
            reviewStartMs: span.reviewStartMs,
            reviewEndMs: span.reviewEndMs
          };
        }),
        rawDurationMs: record.timeline.rawDurationMs,
        contentDurationMs: record.timeline.contentDurationMs,
        reviewDurationMs: record.timeline.reviewDurationMs
      }
    : null;

  const recordTimelinePlayback = useReviewPlaybackTimeline({
    timeline: reviewTimeline,
    rawMs: currentPlaybackMs,
    rawDurationMs: durationMs,
    onSeek
  });

  // 时长口径统一：所有展示都从这几个变量取值，避免 header 与 timeline-stats 数据源不一致
  const hasTimeline = Boolean(recordTimelinePlayback.displayTimeline);
  const rawDurationMs = record.timeline?.rawDurationMs ?? record.durationMs;
  const reviewDurationMs = recordTimelinePlayback.reviewDurationMs;
  const contentDurationMs = record.timeline?.contentDurationMs ?? rawDurationMs;

  return (
    <section className="recordDetailPanel" aria-label="记录详情">
      <RecordDetailHeader
        title={title}
        onTitleChange={(newTitle) => onTitleChange(newTitle)}
        onExport={onExport}
        metadata={{
          duration: formatDurationForRecord(rawDurationMs),
          segmentCount: record.segments.length,
          timeline: hasTimeline
            ? {
                reviewDurationMs,
                rawDurationMs,
                contentDurationMs,
                compressionEnabled: recordTimelinePlayback.compressionEnabled,
                onToggleCompression: recordTimelinePlayback.toggleCompressionMode
              }
            : undefined
        }}
        onReadSettings={onReadSettings}
      >
        {recordAudioUrl ? (
          <>
            <audio
              preload="auto"
              ref={recordAudioRef}
              src={recordAudioUrl}
              onEnded={onAudioEnded}
              onError={onAudioError}
              onCanPlay={(event) => onAudioCanPlay(event.currentTarget)}
              onLoadedMetadata={(event) => onAudioLoadedMetadata(event.currentTarget)}
              onPause={onAudioPause}
              onPlay={onAudioPlay}
              onTimeUpdate={(event) => onAudioTimeUpdate(Math.round(event.currentTarget.currentTime * 1000))}
              style={{ display: "none" }}
            />
            <RecordPlayer
              isPlaying={isAudioPlaying}
              currentMs={hasTimeline ? recordTimelinePlayback.reviewMs : currentPlaybackMs}
              durationMs={hasTimeline ? reviewDurationMs : durationMs}
              onPlayPause={onToggleAudioPlayback}
              onSeek={hasTimeline ? recordTimelinePlayback.scrubToReview : onSeek}
              volume={volume}
              speed={speed}
              onVolumeChange={onVolumeChange}
              onSpeedChange={onSpeedChange}
              timeline={recordTimelinePlayback.displayTimeline ?? undefined}
            />
          </>
        ) : null}
        {audioStatus === "loading" ? <span className="recordAudioStatus" role="status">音频加载中...</span> : null}
        {audioStatus === "missing" ? <span className="recordAudioStatus" role="status">没有可用录音</span> : null}
        {audioStatus === "failed" ? <span className="recordAudioStatus" role="status">音频加载失败</span> : null}
      </RecordDetailHeader>
      {exportStatus ? (
        <div style={{ padding: "12px 0", color: "var(--muted)", fontSize: "13px" }} role="status">
          {exportStatus}
        </div>
      ) : null}
      <div className="recordWorkspace">
        <section className="recordPanel recordTranscriptPanel">
          <TranscriptToolbar
            activeTab={activeTab}
            onTabChange={onTabChange}
            searchValue={searchQuery}
            onSearchChange={onSearchChange}
            searchResultCount={searchMatchCount}
            onPrevMatch={onPrevSearchMatch}
            onNextMatch={onNextSearchMatch}
            tabs={[
              { id: "bilingual", label: "双语" },
              { id: "source", label: "原文" },
              { id: "translation", label: "译文" }
            ]}
          />
          <div className="recordContentList" style={{ fontSize: `${reviewScale}em` }} aria-label="双语片段">
            {record.segments.length > 0 ? (
              record.segments.map((segment) => {
                const sourceText = selectedRecordSegmentSourceText(segment) || "原文为空";
                const translationText = selectedRecordSegmentTargetText(segment) || "译文待补全";
                const visibleText = activeTab === "source"
                  ? sourceText
                  : activeTab === "translation"
                    ? translationText
                    : `${sourceText}\n${translationText}`;
                const isSearchMatch = Boolean(
                  normalizedSearchQuery && visibleText.toLowerCase().includes(normalizedSearchQuery)
                );

                return (
                  <TranscriptSegment
                    key={segment.id}
                    ref={(node) => {
                      recordSegmentRefs.current[segment.id] = node;
                    }}
                    timestamp={`${formatTime(segment.startMs)} – ${formatTime(segment.endMs)}`}
                    sourceText={sourceText}
                    translationText={translationText}
                    displayMode={activeTab}
                    isActive={segment.id === activeSegmentId || segment.id === activeMatchSegmentId}
                    isMatch={isSearchMatch}
                    onPlay={() => onSegmentPlay(segment)}
                    highlightQuery={searchQuery}
                  />
                );
              })
            ) : (
              <p className="archiveMissing">这条记录没有可复盘文本。</p>
            )}
          </div>
        </section>
        <SummaryPanel
          summary={record.summary.text || "摘要暂未生成。保存后仍可先查看完整双语记录。"}
          tags={record.summary.keywords}
          keywords={record.summary.keywords.map((kw, i) => ({
            name: kw,
            percentage: Math.max(10, 30 - i * 5)
          }))}
          onCopy={onCopySummary}
          onEvidenceClick={onEvidenceClick}
          actionItems={record.summary.actionItems}
          topics={record.summary.topics}
          risks={record.summary.risks}
          decisions={record.summary.decisions}
          terminologySuggestions={record.summary.terminologySuggestions}
        />
      </div>
    </section>
  );
}
