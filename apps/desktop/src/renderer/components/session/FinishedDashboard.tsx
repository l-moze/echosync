import { useMemo, useRef, useState } from "react";

import type { CaptionLine } from "../../../shared/caption-store";
import {
  reviewToRawMs,
  selectReviewPlaybackMs,
  selectSkippedSilenceMarker
} from "../../../shared/review-timeline";
import type { SessionArchiveDraft } from "../../../shared/session-archive";
import { selectPlaybackSegmentId } from "../../../shared/session-archive";
import { cleanTranscriptLines, serializeTranscriptMarkdown, serializeTranscriptSrt } from "../../../shared/session-export";
import { formatDurationForRecord, type SessionRecordListItem } from "../../../shared/session-records";
import type { SessionUiEvent, SessionUiState } from "../../../shared/session-ui-state";
import type { SessionArchiveSaveStatus } from "../../types/session";
import { copyTextToClipboard } from "../../services/ipc/clipboard";
import { seekAudioElement } from "../../utils/dom";
import { formatTime } from "../../utils/format";
import { selectSessionArchivePlaybackUpdate } from "../../utils/session-archive-playback";
import {
  reviewDurationMsForTimeline,
  reviewTimelineFromSessionTimeline
} from "../../utils/session-review-timeline";
import { editableTextToTranscriptLines, transcriptLinesToEditableText } from "../../utils/transcript";
import { RecentSessionsPanel } from "../records/RecentSessionsPanel";
import { TranscriptReviewGrid } from "../records/TranscriptReviewGrid";

export function FinishedDashboard({
  dispatchSessionUi,
  lines,
  onStart,
  sessionArchive,
  sessionArchiveSaveStatus,
  sessionRecords,
  sessionUi
}: {
  dispatchSessionUi: (event: SessionUiEvent) => void;
  lines: CaptionLine[];
  onStart: () => void;
  sessionArchive: SessionArchiveDraft | null;
  sessionArchiveSaveStatus: SessionArchiveSaveStatus;
  sessionRecords: SessionRecordListItem[];
  sessionUi: SessionUiState;
}) {
  const [editableTranscript, setEditableTranscript] = useState(() => transcriptLinesToEditableText(lines));
  const [exportStatus, setExportStatus] = useState("等待导出");
  const [playbackMs, setPlaybackMs] = useState(0);
  const [archiveAudioPlaying, setArchiveAudioPlaying] = useState(false);
  const [archiveAudioError, setArchiveAudioError] = useState("");
  const [archiveAudioStatus, setArchiveAudioStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const archiveReviewTimeline = useMemo(
    () => reviewTimelineFromSessionTimeline(sessionArchive?.timeline),
    [sessionArchive?.timeline]
  );
  const archiveReviewDurationMs = reviewDurationMsForTimeline(archiveReviewTimeline, sessionArchive?.durationMs ?? 0);
  const archiveReviewPlaybackMs = archiveReviewTimeline ? selectReviewPlaybackMs(archiveReviewTimeline, playbackMs) : playbackMs;
  const archiveSkippedSilenceMarker = archiveReviewTimeline
    ? selectSkippedSilenceMarker(archiveReviewTimeline, archiveReviewPlaybackMs)
    : null;
  const cleanedLines = useMemo(() => editableTextToTranscriptLines(editableTranscript, lines), [editableTranscript, lines]);
  const activePlaybackSegmentId = useMemo(
    () => selectPlaybackSegmentId(cleanedLines, playbackMs),
    [cleanedLines, playbackMs]
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingArchiveSeekMsRef = useRef<number | null>(null);
  const pendingArchivePlayRef = useRef(false);

  function cleanUpTranscript() {
    const nextLines = cleanTranscriptLines(cleanedLines);
    setEditableTranscript(transcriptLinesToEditableText(nextLines));
    dispatchSessionUi({ type: "pre_export.edited" });
    setExportStatus("已完成快速清理");
  }

  function seekToSegment(line: CaptionLine) {
    pendingArchiveSeekMsRef.current = line.startMs;
    pendingArchivePlayRef.current = true;
    setPlaybackMs(line.startMs);
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.readyState === 0) {
      audio.load();
      return;
    }
    applyPendingArchiveSeek(audio);
  }

  function scrubArchiveAudio(nextReviewMs: number) {
    pendingArchivePlayRef.current = false;
    seekArchiveAudio(archiveReviewTimeline ? reviewToRawMs(archiveReviewTimeline, nextReviewMs) : nextReviewMs);
  }

  function seekArchiveAudio(nextRawMs: number) {
    const durationMs = sessionArchive?.durationMs ?? 0;
    const boundedMs = Math.min(Math.max(nextRawMs, 0), Math.max(durationMs, 0));
    pendingArchiveSeekMsRef.current = boundedMs;
    setPlaybackMs(boundedMs);
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.readyState === 0) {
      setArchiveAudioStatus("loading");
      audio.load();
      return;
    }
    applyPendingArchiveSeek(audio);
  }

  function applyPendingArchiveSeek(audio: HTMLAudioElement) {
    const pendingSeekMs = pendingArchiveSeekMsRef.current;
    if (pendingSeekMs === null) {
      return;
    }
    if (!seekAudioElement(audio, pendingSeekMs)) {
      return;
    }
    pendingArchiveSeekMsRef.current = null;
    setArchiveAudioStatus("ready");
    setPlaybackMs(pendingSeekMs);
    if (!pendingArchivePlayRef.current) {
      return;
    }
    pendingArchivePlayRef.current = false;
    setArchiveAudioError("");
    void audio.play()
      .then(() => {
        setArchiveAudioPlaying(true);
      })
      .catch(() => {
        setArchiveAudioPlaying(false);
        setArchiveAudioError("音频无法播放");
      });
  }

  function toggleArchiveAudioPlayback() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (archiveAudioPlaying) {
      audio.pause();
      setArchiveAudioPlaying(false);
      return;
    }
    setArchiveAudioError("");
    pendingArchivePlayRef.current = true;
    pendingArchiveSeekMsRef.current = playbackMs;
    if (audio.readyState < 2) {
      setArchiveAudioStatus("loading");
      audio.load();
      return;
    }
    applyPendingArchiveSeek(audio);
  }

  function updateArchivePlayback(currentMs: number) {
    const playbackUpdate = selectSessionArchivePlaybackUpdate({
      currentMs,
      durationMs: sessionArchive?.durationMs ?? currentMs,
      isPlaying: archiveAudioPlaying,
      timeline: archiveReviewTimeline
    });
    if (playbackUpdate.skipTargetRawMs !== null) {
      pendingArchivePlayRef.current = false;
      pendingArchiveSeekMsRef.current = playbackUpdate.skipTargetRawMs;
      setPlaybackMs(playbackUpdate.playbackMs);
      const audio = audioRef.current;
      if (audio && seekAudioElement(audio, playbackUpdate.skipTargetRawMs)) {
        pendingArchiveSeekMsRef.current = null;
      }
      return;
    }
    setPlaybackMs(playbackUpdate.playbackMs);
  }

  async function copyMarkdown() {
    await copyTextToClipboard(serializeTranscriptMarkdown(cleanedLines));
    setExportStatus("Markdown 已复制");
  }

  async function copySrt() {
    await copyTextToClipboard(serializeTranscriptSrt(cleanedLines));
    setExportStatus("SRT 已复制");
  }

  function startNewSession() {
    dispatchSessionUi({ type: "session.reset" });
    onStart();
  }

  return (
    <div className="dashboardGrid">
      <section className="summaryPanel">
        <p className="eyebrow">本次复盘</p>
        <h1>{sessionArchive?.title ?? "同传已结束，可以清理后导出"}</h1>
        {sessionArchive?.audio ? (
          <section className="archivePlaybackPanel" aria-label="会话录音回放">
            <audio
              hidden
              preload="auto"
              ref={audioRef}
              src={sessionArchive.audio.objectUrl}
              onCanPlay={(event) => {
                setArchiveAudioStatus("ready");
                applyPendingArchiveSeek(event.currentTarget);
              }}
              onEnded={() => {
                setArchiveAudioPlaying(false);
                updateArchivePlayback(sessionArchive.durationMs);
              }}
              onError={() => {
                setArchiveAudioPlaying(false);
                setArchiveAudioStatus("failed");
                setArchiveAudioError("音频加载失败");
              }}
              onLoadedMetadata={(event) => {
                setArchiveAudioStatus("ready");
                applyPendingArchiveSeek(event.currentTarget);
              }}
              onPause={() => setArchiveAudioPlaying(false)}
              onPlay={() => setArchiveAudioPlaying(true)}
              onTimeUpdate={(event) => updateArchivePlayback(Math.round(event.currentTarget.currentTime * 1000))}
            />
            <div className="archiveAudioControls">
              <button onClick={toggleArchiveAudioPlayback} type="button">
                {archiveAudioPlaying ? "暂停" : "播放"}
              </button>
              <input
                aria-label="本次复盘音频进度"
                max={archiveReviewDurationMs}
                min={0}
                onChange={(event) => scrubArchiveAudio(Number(event.target.value))}
                step={250}
                type="range"
                value={Math.min(archiveReviewPlaybackMs, archiveReviewDurationMs)}
              />
              <span className="archiveAudioTime">{formatTime(archiveReviewPlaybackMs)} / {formatTime(archiveReviewDurationMs)}</span>
            </div>
            {archiveAudioStatus === "loading" ? <span className="archiveAudioStatus" role="status">音频加载中...</span> : null}
            {archiveAudioError ? <span className="archiveAudioError" role="status">{archiveAudioError}</span> : null}
            {archiveSkippedSilenceMarker ? (
              <span className="archiveAudioStatus" role="status">
                已压缩 {formatDurationForRecord(archiveSkippedSilenceMarker.skippedMs)} 静音
              </span>
            ) : null}
          </section>
        ) : (
          <p className="archiveMissing">本次会话没有可回放录音，仍可导出双语文本。</p>
        )}
        <TranscriptReviewGrid
          activeSegmentId={activePlaybackSegmentId}
          lines={cleanedLines}
          onLineClick={seekToSegment}
        />
        <details className="preExportDetails">
          <summary>编辑导出文本</summary>
          <textarea
            aria-label="导出前编辑"
            className="preExportEditor"
            onChange={(event) => {
              setEditableTranscript(event.target.value);
              dispatchSessionUi({ type: "pre_export.edited" });
              setExportStatus("有未导出的编辑");
            }}
            value={editableTranscript}
          />
        </details>
        <div className="startActions">
          <button onClick={() => void copyMarkdown()}>复制 Markdown</button>
          <button onClick={() => void copySrt()}>复制 SRT</button>
          <button onClick={cleanUpTranscript}>快速清理</button>
          <button onClick={startNewSession}>开始新会话</button>
        </div>
        <p className="exportStatus">
          {exportStatus}{sessionUi.preExportEdit.dirty ? " · 已编辑" : ""} · {sessionArchiveSaveStatus.message}
        </p>
      </section>
      <RecentSessionsPanel records={sessionRecords} />
    </div>
  );
}
