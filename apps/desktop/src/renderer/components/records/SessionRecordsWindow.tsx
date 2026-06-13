import { useEffect, useMemo, useRef, useState } from "react";
import log from "electron-log/renderer";

import {
  filterSessionRecordsByTitle,
  serializeSessionRecordMarkdown,
  type SessionRecord,
  type SessionRecordExportFormat,
  type SessionRecordListItem,
  type SessionRecordSegment
} from "../../../shared/session-records";
import {
  reviewToRawMs,
  selectReviewPlaybackMs
} from "../../../shared/review-timeline";
import { ensureSeekableSessionRecording } from "../../session-recorder";
import { copyTextToClipboard } from "../../services/ipc/clipboard";
import {
  deleteSessionRecord,
  exportSessionRecord,
  generateSessionRecordSummary,
  getSessionRecord,
  getSessionRecordAudioData,
  getSessionRecordAudioUrl,
  onSessionRecordChanged,
  renameSessionRecord
} from "../../services/ipc/session-records";
import { seekAudioElement } from "../../utils/dom";
import { sessionRecordExportFormatLabel } from "../../utils/labels";
import {
  selectInitialSessionRecordPlaybackState,
  selectSessionRecordPlaybackUpdate
} from "../../utils/session-record-playback";
import {
  normalizeSessionRecordForReview,
  selectedRecordSegmentSourceText,
  selectedRecordSegmentTargetText
} from "../../utils/session-records";
import {
  reviewDurationMsForTimeline,
  reviewTimelineFromSessionTimeline
} from "../../utils/session-review-timeline";
import { SessionRecordDetailPanel } from "./SessionRecordDetailPanel";
import { SessionRecordListView } from "./SessionRecordListView";
import { TopBar } from "./TopBar";

type RecordTranscriptTab = "bilingual" | "source" | "translation";

const RECORD_TRANSCRIPT_TABS: RecordTranscriptTab[] = ["bilingual", "source", "translation"];
const RECORD_AUDIO_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

export function SessionRecordsWindow({
  isOpen,
  onClose,
  onRecordsChanged,
  records
}: {
  isOpen: boolean;
  onClose: () => void;
  onRecordsChanged: () => Promise<void>;
  records: SessionRecordListItem[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<SessionRecord | null>(null);
  const [selectedRecordLoading, setSelectedRecordLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [renameStatus, setRenameStatus] = useState("");
  const reviewScale = 1;
  const [recordAudioUrl, setRecordAudioUrl] = useState<string | null>(null);
  const [recordAudioPlaying, setRecordAudioPlaying] = useState(false);
  const [recordAudioStatus, setRecordAudioStatus] = useState<"idle" | "loading" | "ready" | "missing" | "failed">("idle");
  const [playbackMs, setPlaybackMs] = useState(0);
  const [activeRecordSegmentId, setActiveRecordSegmentId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [recordTranscriptTab, setRecordTranscriptTab] = useState<RecordTranscriptTab>("bilingual");
  const [recordSearchQuery, setRecordSearchQuery] = useState("");
  const [activeRecordMatchIndex, setActiveRecordMatchIndex] = useState(0);
  const [recordAudioVolume, setRecordAudioVolume] = useState(72);
  const [recordAudioSpeed, setRecordAudioSpeed] = useState(1);
  const recordAudioRef = useRef<HTMLAudioElement | null>(null);
  const recordAudioObjectUrlRef = useRef<string | null>(null);
  const pendingRecordSeekMsRef = useRef<number | null>(null);
  const pendingRecordPlayRef = useRef(false);
  const recordSegmentRefs = useRef<Record<string, HTMLElement | null>>({});
  const filteredRecords = useMemo(() => filterSessionRecordsByTitle(records, searchQuery), [records, searchQuery]);
  const selectedListRecord = selectedId ? records.find((record) => record.id === selectedId) ?? null : null;
  const isDetailView = Boolean(selectedId);
  const selectedReviewTimeline = useMemo(
    () => reviewTimelineFromSessionTimeline(selectedRecord?.timeline),
    [selectedRecord?.timeline]
  );
  const recordSearchMatchIds = useMemo(() => {
    if (!selectedRecord) {
      return [];
    }
    const query = recordSearchQuery.trim().toLowerCase();
    if (!query) {
      return [];
    }
    return selectedRecord.segments
      .filter((segment) => {
        const sourceText = selectedRecordSegmentSourceText(segment);
        const targetText = selectedRecordSegmentTargetText(segment);
        const searchableText = recordTranscriptTab === "source"
          ? sourceText
          : recordTranscriptTab === "translation"
            ? targetText
            : `${sourceText}\n${targetText}`;
        return searchableText.toLowerCase().includes(query);
      })
      .map((segment) => segment.id);
  }, [recordSearchQuery, recordTranscriptTab, selectedRecord]);
  const activeRecordMatchId = recordSearchMatchIds[activeRecordMatchIndex] ?? null;
  const reviewDurationMs = reviewDurationMsForTimeline(selectedReviewTimeline, selectedRecord?.durationMs ?? 0);
  const reviewPlaybackMs = selectedReviewTimeline ? selectReviewPlaybackMs(selectedReviewTimeline, playbackMs) : playbackMs;

  useEffect(() => {
    if (!isOpen || !selectedId) {
      setSelectedRecord(null);
      setRecordAudioPlaybackUrl(null);
      setRecordAudioPlaying(false);
      setRecordAudioStatus("idle");
      setPlaybackMs(0);
      setActiveRecordSegmentId(null);
      setTitleDraft("");
      setRecordTranscriptTab("bilingual");
      setRecordSearchQuery("");
      setActiveRecordMatchIndex(0);
      pendingRecordSeekMsRef.current = null;
      pendingRecordPlayRef.current = false;
      return;
    }

    let cancelled = false;
    const recordId = selectedId;
    async function loadRecord() {
      setSelectedRecordLoading(true);
      setExportStatus("");
      setRenameStatus("");
      setSelectedRecord(null);
      setRecordAudioPlaybackUrl(null);
      setRecordAudioPlaying(false);
      setRecordAudioStatus("loading");
      setRecordTranscriptTab("bilingual");
      setRecordSearchQuery("");
      setActiveRecordMatchIndex(0);
      try {
        const record = await getSessionRecord(recordId);
        if (cancelled) {
          return;
        }
        if (!record) {
          setSelectedRecord(null);
          setRecordAudioPlaybackUrl(null);
          setRecordAudioPlaying(false);
          setRecordAudioStatus("missing");
          setExportStatus("记录不存在");
          return;
        }
        const normalizedRecord = normalizeSessionRecordForReview(record);
        setSelectedRecord(normalizedRecord);
        setTitleDraft(normalizedRecord.title);
        const initialPlayback = selectInitialSessionRecordPlaybackState(normalizedRecord.segments);
        setActiveRecordSegmentId(initialPlayback.activeSegmentId);
        setPlaybackMs(initialPlayback.playbackMs);
        const audioData = await getSessionRecordAudioData(recordId);
        if (!cancelled) {
          if (audioData) {
            const audioBlob = new Blob([audioData.data], { type: audioData.mimeType || "audio/webm" });
            const seekableRecording = await ensureSeekableSessionRecording(
              { blob: audioBlob, mimeType: audioData.mimeType || audioBlob.type },
              normalizedRecord.durationMs
            );
            const objectUrl = URL.createObjectURL(seekableRecording?.blob ?? audioBlob);
            if (cancelled) {
              URL.revokeObjectURL(objectUrl);
              return;
            }
            setRecordAudioPlaybackUrl(objectUrl, true);
            setRecordAudioStatus("loading");
          } else {
            const audioUrl = await getSessionRecordAudioUrl(recordId);
            if (!cancelled) {
              setRecordAudioPlaybackUrl(audioUrl ?? null);
              setRecordAudioStatus(audioUrl ? "loading" : "missing");
            }
          }
        }
      } catch (error) {
        log.warn("[session-records] 读取会议记录详情失败:", error);
        if (!cancelled) {
          setSelectedRecord(null);
          setRecordAudioPlaybackUrl(null);
          setRecordAudioPlaying(false);
          setRecordAudioStatus("failed");
          setExportStatus("加载失败");
        }
      } finally {
        if (!cancelled) {
          setSelectedRecordLoading(false);
        }
      }
    }

    void loadRecord();
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedId]);

  useEffect(() => () => {
    if (recordAudioObjectUrlRef.current) {
      URL.revokeObjectURL(recordAudioObjectUrlRef.current);
      recordAudioObjectUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    const remove = onSessionRecordChanged(async (recordId) => {
      await onRecordsChanged();
      if (!isOpen || selectedId !== recordId) {
        return;
      }
      try {
        const record = await getSessionRecord(recordId);
        if (record) {
          setSelectedRecord(normalizeSessionRecordForReview(record));
        }
      } catch (error) {
        log.warn("[session-records] 刷新会议摘要失败:", error);
      }
    });
    return () => remove?.();
  }, [isOpen, onRecordsChanged, selectedId]);

  useEffect(() => {
    if (!activeRecordSegmentId) {
      return;
    }
    const node = recordSegmentRefs.current[activeRecordSegmentId];
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeRecordSegmentId]);

  useEffect(() => {
    if (activeRecordMatchIndex < recordSearchMatchIds.length) {
      return;
    }
    setActiveRecordMatchIndex(0);
  }, [activeRecordMatchIndex, recordSearchMatchIds.length]);

  useEffect(() => {
    const audio = recordAudioRef.current;
    if (!audio) {
      return;
    }
    audio.volume = recordAudioVolume / 100;
    audio.playbackRate = recordAudioSpeed;
  }, [recordAudioSpeed, recordAudioUrl, recordAudioVolume]);

  if (!isOpen) {
    return null;
  }

  async function deleteRecord(recordId: string) {
    try {
      await deleteSessionRecord(recordId);
      await onRecordsChanged();
      setExportStatus("");
    } catch (error) {
      log.warn("[session-records] 删除会议记录失败:", error);
      setExportStatus("删除失败");
    }
    setDeleteId(null);
    if (selectedId === recordId) {
      setSelectedId(null);
      setSelectedRecord(null);
      setRecordAudioPlaybackUrl(null);
      setRecordAudioPlaying(false);
      setRecordAudioStatus("idle");
    }
  }

  async function exportSelectedRecord(format: SessionRecordExportFormat = "markdown") {
    if (!selectedRecord) {
      return;
    }
    try {
      const result = await exportSessionRecord(selectedRecord.id, format);
      const fallbackText = format === "markdown" ? serializeSessionRecordMarkdown(selectedRecord) : "";
      await copyTextToClipboard(result?.text ?? fallbackText);
      setExportStatus(format === "markdown" ? "Markdown 已复制" : `${sessionRecordExportFormatLabel(format)} 已复制`);
    } catch (error) {
      log.warn("[session-records] 导出会议记录失败:", error);
      setExportStatus("导出失败");
    }
  }

  async function regenerateSelectedSummary() {
    if (!selectedRecord) {
      return;
    }
    try {
      setExportStatus("摘要生成中...");
      await generateSessionRecordSummary(selectedRecord.id);
      await onRecordsChanged();
      const record = await getSessionRecord(selectedRecord.id);
      if (record) {
        setSelectedRecord(normalizeSessionRecordForReview(record));
      }
      setExportStatus("摘要已更新");
    } catch (error) {
      log.warn("[session-records] 重新生成会议摘要失败:", error);
      setExportStatus("摘要生成失败");
    }
  }

  async function renameSelectedRecord(nextTitleValue = titleDraft) {
    if (!selectedRecord) {
      return;
    }
    const nextTitle = nextTitleValue.trim();
    if (!nextTitle || nextTitle === selectedRecord.title) {
      setTitleDraft(selectedRecord.title);
      setRenameStatus("");
      return;
    }
    try {
      setRenameStatus("保存中...");
      const renamed = await renameSessionRecord(selectedRecord.id, nextTitle);
      if (renamed) {
        const normalizedRecord = normalizeSessionRecordForReview(renamed);
        setSelectedRecord(normalizedRecord);
        setTitleDraft(normalizedRecord.title);
      }
      await onRecordsChanged();
      setRenameStatus("已重命名");
    } catch (error) {
      log.warn("[session-records] 重命名会议记录失败:", error);
      setTitleDraft(selectedRecord.title);
      setRenameStatus("重命名失败");
    }
  }

  function seekToRecordSegment(segment: SessionRecordSegment) {
    setActiveRecordSegmentId(segment.id);
    pendingRecordPlayRef.current = true;
    seekRecordAudio(segment.startMs);
  }

  function setRecordAudioPlaybackUrl(nextUrl: string | null, ownsObjectUrl = false) {
    const currentObjectUrl = recordAudioObjectUrlRef.current;
    if (currentObjectUrl && currentObjectUrl !== nextUrl) {
      URL.revokeObjectURL(currentObjectUrl);
    }
    recordAudioObjectUrlRef.current = ownsObjectUrl ? nextUrl : null;
    setRecordAudioUrl(nextUrl);
  }

  function applyPendingRecordSeek(audio: HTMLAudioElement) {
    audio.volume = recordAudioVolume / 100;
    audio.playbackRate = recordAudioSpeed;
    const pendingSeekMs = pendingRecordSeekMsRef.current;
    if (pendingSeekMs === null) {
      return;
    }
    if (!seekAudioElement(audio, pendingSeekMs)) {
      return;
    }
    pendingRecordSeekMsRef.current = null;
    setRecordAudioStatus("ready");
    setPlaybackMs(pendingSeekMs);
    if (!pendingRecordPlayRef.current) {
      return;
    }
    pendingRecordPlayRef.current = false;
    void audio.play()
      .then(() => {
        setRecordAudioPlaying(true);
      })
      .catch(() => {
        setRecordAudioPlaying(false);
      });
  }

  function scrubRecordAudio(nextMs: number) {
    pendingRecordPlayRef.current = false;
    seekRecordAudio(reviewToRawRecordMs(nextMs));
  }

  function seekRecordAudio(nextMs: number) {
    const durationMs = selectedRecord?.durationMs ?? 0;
    const boundedMs = Math.min(Math.max(nextMs, 0), Math.max(durationMs, 0));
    pendingRecordSeekMsRef.current = boundedMs;
    setPlaybackMs(boundedMs);
    const audio = recordAudioRef.current;
    if (!audio) {
      return;
    }
    if (audio.readyState === 0) {
      setRecordAudioStatus("loading");
      audio.load();
      return;
    }
    applyPendingRecordSeek(audio);
  }

  function reviewToRawRecordMs(nextReviewMs: number) {
    if (!selectedReviewTimeline) {
      return nextReviewMs;
    }
    return reviewToRawMs(selectedReviewTimeline, nextReviewMs);
  }

  function toggleRecordAudioPlayback() {
    const audio = recordAudioRef.current;
    if (!audio) {
      return;
    }
    if (recordAudioPlaying) {
      audio.pause();
      setRecordAudioPlaying(false);
      return;
    }
    pendingRecordPlayRef.current = true;
    pendingRecordSeekMsRef.current = playbackMs;
    if (audio.readyState < 2) {
      setRecordAudioStatus("loading");
      audio.load();
      return;
    }
    applyPendingRecordSeek(audio);
  }

  function selectRecordTranscriptTab(tabId: string) {
    if (!RECORD_TRANSCRIPT_TABS.includes(tabId as RecordTranscriptTab)) {
      return;
    }
    setRecordTranscriptTab(tabId as RecordTranscriptTab);
    setActiveRecordMatchIndex(0);
  }

  function updateRecordSearchQuery(nextQuery: string) {
    setRecordSearchQuery(nextQuery);
    setActiveRecordMatchIndex(0);
  }

  function focusRecordSearchMatch(nextIndex: number) {
    const matchCount = recordSearchMatchIds.length;
    if (matchCount === 0) {
      return;
    }
    const normalizedIndex = ((nextIndex % matchCount) + matchCount) % matchCount;
    const matchId = recordSearchMatchIds[normalizedIndex];
    setActiveRecordMatchIndex(normalizedIndex);
    setActiveRecordSegmentId(matchId);
    recordSegmentRefs.current[matchId]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function changeRecordAudioVolume(nextVolume: number) {
    const boundedVolume = Math.min(100, Math.max(0, Math.round(nextVolume)));
    setRecordAudioVolume(boundedVolume);
    if (recordAudioRef.current) {
      recordAudioRef.current.volume = boundedVolume / 100;
    }
  }

  function cycleRecordAudioSpeed() {
    const currentIndex = RECORD_AUDIO_SPEEDS.findIndex((speed) => speed === recordAudioSpeed);
    const nextSpeed = RECORD_AUDIO_SPEEDS[(currentIndex + 1) % RECORD_AUDIO_SPEEDS.length] ?? 1;
    setRecordAudioSpeed(nextSpeed);
    if (recordAudioRef.current) {
      recordAudioRef.current.playbackRate = nextSpeed;
    }
  }

  function updateRecordPlayback(currentMs: number) {
    if (!selectedRecord) {
      setPlaybackMs(currentMs);
      return;
    }
    const playbackUpdate = selectSessionRecordPlaybackUpdate({
      currentMs,
      durationMs: selectedRecord.durationMs,
      isPlaying: recordAudioPlaying,
      segments: selectedRecord.segments,
      timeline: selectedReviewTimeline
    });
    if (playbackUpdate.skipTargetRawMs !== null) {
      const audio = recordAudioRef.current;
      pendingRecordPlayRef.current = false;
      pendingRecordSeekMsRef.current = playbackUpdate.skipTargetRawMs;
      setPlaybackMs(playbackUpdate.playbackMs);
      if (audio) {
        if (!seekAudioElement(audio, playbackUpdate.skipTargetRawMs)) {
          return;
        }
        pendingRecordSeekMsRef.current = null;
      }
      setActiveRecordSegmentId(playbackUpdate.activeSegmentId);
      return;
    }
    setPlaybackMs(playbackUpdate.playbackMs);
    setActiveRecordSegmentId(playbackUpdate.activeSegmentId);
  }

  return (
    <aside className={isDetailView ? "recordWindow detail" : "recordWindow"} aria-label="会议记录">
      {!isDetailView ? (
        <SessionRecordListView
          deleteId={deleteId}
          filteredRecords={filteredRecords}
          onClose={onClose}
          onDeleteCancel={() => setDeleteId(null)}
          onDeleteConfirm={(recordId) => void deleteRecord(recordId)}
          onDeleteRequest={(recordId) => setDeleteId(recordId)}
          onSearchChange={setSearchQuery}
          onView={(recordId) => {
            setSelectedId(recordId);
            setExportStatus("");
          }}
          records={records}
          searchQuery={searchQuery}
        />
      ) : (
        <TopBar
          onBack={() => setSelectedId(null)}
          productName="EchoSync"
          pageTitle="双语复盘"
          statusTexts={renameStatus ? [renameStatus] : []}
        />
      )}
      {isDetailView && selectedRecordLoading ? (
        <section className="recordDetailPanel" aria-label="记录详情">
          <p className="archiveMissing">正在加载记录...</p>
        </section>
      ) : null}
      {isDetailView && !selectedRecordLoading && !selectedRecord ? (
        <section className="recordDetailPanel" aria-label="记录详情">
          <p className="archiveMissing">{exportStatus || "没有找到这条会议记录。"}</p>
        </section>
      ) : null}
      {selectedRecord ? (
        <SessionRecordDetailPanel
          activeSegmentId={activeRecordSegmentId}
          activeMatchSegmentId={activeRecordMatchId}
          activeTab={recordTranscriptTab}
          audioStatus={recordAudioStatus}
          currentPlaybackMs={reviewPlaybackMs}
          durationMs={reviewDurationMs}
          exportStatus={exportStatus}
          isAudioPlaying={recordAudioPlaying}
          onAudioCanPlay={(audio) => {
            setRecordAudioStatus("ready");
            audio.volume = recordAudioVolume / 100;
            audio.playbackRate = recordAudioSpeed;
            applyPendingRecordSeek(audio);
          }}
          onAudioEnded={() => {
            setRecordAudioPlaying(false);
            updateRecordPlayback(selectedRecord.durationMs);
          }}
          onAudioError={() => {
            setRecordAudioPlaying(false);
            setRecordAudioStatus("failed");
          }}
          onAudioLoadedMetadata={(audio) => {
            setRecordAudioStatus("ready");
            audio.volume = recordAudioVolume / 100;
            audio.playbackRate = recordAudioSpeed;
            applyPendingRecordSeek(audio);
          }}
          onAudioPause={() => setRecordAudioPlaying(false)}
          onAudioPlay={() => setRecordAudioPlaying(true)}
          onAudioTimeUpdate={updateRecordPlayback}
          onCopySummary={() => {
            void copyTextToClipboard(selectedRecord.summary.text || "");
          }}
          onExport={(format) => void exportSelectedRecord(format)}
          onNextSearchMatch={() => focusRecordSearchMatch(activeRecordMatchIndex + 1)}
          onPrevSearchMatch={() => focusRecordSearchMatch(activeRecordMatchIndex - 1)}
          onSeek={scrubRecordAudio}
          onSegmentPlay={seekToRecordSegment}
          onSpeedChange={cycleRecordAudioSpeed}
          onSearchChange={updateRecordSearchQuery}
          onTabChange={selectRecordTranscriptTab}
          onTitleChange={(newTitle) => {
            setTitleDraft(newTitle);
            void renameSelectedRecord(newTitle);
          }}
          onToggleAudioPlayback={toggleRecordAudioPlayback}
          onVolumeChange={changeRecordAudioVolume}
          record={selectedRecord}
          recordAudioRef={recordAudioRef}
          recordAudioUrl={recordAudioUrl}
          recordSegmentRefs={recordSegmentRefs}
          searchMatchCount={recordSearchMatchIds.length}
          searchQuery={recordSearchQuery}
          speed={recordAudioSpeed}
          reviewScale={reviewScale}
          title={titleDraft || selectedListRecord?.title || ""}
          volume={recordAudioVolume}
        />
      ) : null}
    </aside>
  );
}
