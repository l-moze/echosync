import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readRendererSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, "../src/renderer", relativePath), "utf8");
}

const rendererSource = [
  "main.tsx",
  "utils/session-record-draft.ts",
  "utils/session-archive-playback.ts",
  "utils/session-record-playback.ts",
  "components/records/SessionRecordTable.tsx",
  "components/records/SessionRecordListView.tsx",
  "components/records/SessionRecordsWindow.tsx",
  "components/records/SessionRecordDetailPanel.tsx",
  "components/records/RecordDetailHeader.tsx",
  "components/records/RecordPlayer.tsx",
  "components/records/TranscriptSegment.tsx",
  "components/records/TranscriptToolbar.tsx",
  "components/common/WaveformProgress.tsx",
  "components/session/FinishedDashboard.tsx",
  "components/caption/OverlayWindow.tsx",
  "services/ipc/capture.ts",
  "services/ipc/session-records.ts",
  "services/ipc/clipboard.ts"
].map(readRendererSource).join("\n").replace(/\r\n/g, "\n");

const glassDesignStyleSource = readFileSync(
  resolve(__dirname, "../src/renderer/styles/glass-design.css"),
  "utf8"
).replace(/\r\n/g, "\n");

function sourceAround(marker: string, before = 700, after = 700) {
  const index = rendererSource.indexOf(marker);
  expect(index).toBeGreaterThanOrEqual(0);
  return rendererSource.slice(Math.max(0, index - before), index + marker.length + after);
}

describe("会议记录窗口契约", () => {
  it("无查看/删除处理器时不渲染空操作按钮", () => {
    const tableSource = sourceAround("function SessionRecordTable", 0, 1800);

    expect(tableSource).toContain("const hasRecordActions = Boolean(onView || onDelete);");
    expect(tableSource).toContain("{hasRecordActions ? (");
    expect(tableSource).not.toContain("onView?.(record.id)");
    expect(tableSource).not.toContain("onDelete?.(record.id)");
  });

  it("记录列表搜索框使用受控状态并过滤展示记录", () => {
    const windowSource = sourceAround("function SessionRecordsWindow", 0, 2400);
    const searchInputSource = sourceAround("aria-label=\"搜索会议名称\"", 500, 500);

    expect(windowSource).toContain("const [searchQuery, setSearchQuery] = useState(\"\");");
    expect(windowSource).toContain("filterSessionRecordsByTitle(records, searchQuery)");
    expect(searchInputSource).toContain("value={searchQuery}");
    expect(searchInputSource).toContain("onChange={(event) => onSearchChange(event.target.value)}");
    expect(rendererSource).toContain("onSearchChange={setSearchQuery}");
    expect(rendererSource).toContain("records={filteredRecords}");
  });

  it("会议记录窗口使用本地持久化记录并在删除后刷新", () => {
    const windowSource = sourceAround("function SessionRecordsWindow", 0, 13000);

    expect(windowSource).toContain("records: SessionRecordListItem[];");
    expect(windowSource).toContain("onRecordsChanged: () => Promise<void>;");
    expect(windowSource).toContain("await deleteSessionRecord(recordId)");
    expect(windowSource).toContain("await onRecordsChanged();");
    expect(rendererSource).not.toContain("const recentSessionRecords");
  });

  it("停止会话后把复盘草稿保存到本地会议记录", () => {
    const stopSource = sourceAround("async function stopCapture", 0, 3400);

    expect(rendererSource).toContain("async function getPendingNativeCaptureRecording");
    expect(rendererSource).toContain("getPendingCaptureRecording(sessionId)");
    expect(rendererSource).toContain("async function buildSessionRecordDraftInput");
    expect(stopSource).toContain("const archive = buildSessionArchiveDraft");
    expect(stopSource).toContain("setSessionArchiveDraft(archive);");
    expect(stopSource).toContain("void saveSessionArchiveDraft(archive");
    expect(rendererSource).toContain("await saveSessionRecordDraft(input);");
  });

  it("停止会话保存记录不依赖采集状态快照成功返回", () => {
    const stopSource = sourceAround("async function stopCapture", 0, 5200);

    expect(stopSource).toContain("const stoppedSessionId = currentClient?.sessionId ?? activeSessionIdRef.current;");
    expect(stopSource).toContain("if (nextSnapshot) {\n      setSnapshot(nextSnapshot);\n    }");
    expect(stopSource).toContain("const endedAt");
    expect(stopSource).toContain("const elapsedDurationMs");
    expect(stopSource).toContain("Math.max(...lines.map((line) => line.endMs), elapsedDurationMs, 0)");
  });

  it("Windows 系统声停止后从主进程取回 WAV 录音用于即时复盘", () => {
    const stopSource = sourceAround("async function stopCapture", 0, 5600);
    const nativeRecordingSource = sourceAround("async function getPendingNativeCaptureRecording", 0, 1200);

    expect(nativeRecordingSource).toContain("getPendingCaptureRecording(sessionId)");
    expect(nativeRecordingSource).toContain("new Blob([recording.data], { type: mimeType })");
    expect(nativeRecordingSource).toContain("activityRanges: recording.activityRanges");
    expect(stopSource).toContain("const nativeRecording = recording ? null : await getPendingNativeCaptureRecording(stoppedSessionId);");
    expect(stopSource).toContain("ensureSeekableSessionRecording(recording ?? nativeRecording, durationMs)");
    expect(stopSource).toContain("id: stoppedSessionId ?? nextSnapshot?.sessionId");
  });

  it("本次复盘点击片段在音频元数据就绪后补偿跳转", () => {
    const finishedSource = sourceAround("function FinishedDashboard", 0, 9000);
    const archiveProgressSource = sourceAround("aria-label=\"本次复盘音频进度\"", 700, 700);

    expect(finishedSource).toContain("pendingArchiveSeekMsRef");
    expect(finishedSource).toContain("pendingArchivePlayRef");
    expect(finishedSource).toContain("applyPendingArchiveSeek(event.currentTarget)");
    expect(finishedSource).toContain("seekAudioElement(audio, pendingSeekMs)");
    expect(finishedSource).toContain("reviewToRawMs(archiveReviewTimeline, nextReviewMs)");
    expect(rendererSource).toContain("selectSessionArchivePlaybackUpdate");
    expect(rendererSource).toContain("selectAutoSkipTargetRawMs(timeline, currentMs)");
    expect(finishedSource).toContain("selectReviewPlaybackMs(archiveReviewTimeline, playbackMs)");
    expect(finishedSource).toContain("audio.readyState === 0");
    expect(finishedSource).toContain("audio.load();");
    expect(finishedSource).toContain("setPlaybackMs(line.startMs);");
    expect(finishedSource).toContain("className=\"archiveAudioControls\"");
    expect(finishedSource).toContain("className=\"archiveAudioTime\"");
    expect(finishedSource).not.toContain("className=\"recordAudioControls\"");
    expect(archiveProgressSource).toContain("max={archiveReviewDurationMs}");
    expect(archiveProgressSource).toContain("value={Math.min(archiveReviewPlaybackMs, archiveReviewDurationMs)}");
    expect(finishedSource).not.toContain("<audio\n              controls");
  });

  it("详情页导出按钮会通过主进程导出并复制当前记录", () => {
    const exportSource = sourceAround("async function exportSelectedRecord", 0, 1200);
    const actionsSource = sourceAround("onExport={onExport}", 1200, 1800);

    expect(exportSource).toContain("exportSessionRecord(selectedRecord.id, format)");
    expect(exportSource).toContain("serializeSessionRecordMarkdown(selectedRecord)");
    expect(exportSource).toContain("await copyTextToClipboard");
    expect(exportSource).toContain("format === \"markdown\" ? \"Markdown 已复制\"");
    expect(actionsSource).toContain("onExport={onExport}");
    expect(rendererSource).toContain("onExport={(format) => void exportSelectedRecord(format)}");
    expect(rendererSource).toContain("exportStatus ? (");
  });

  it("详情页读取完整记录，支持重命名、音频 URL、片段跳转和播放高亮", () => {
    const windowSource = sourceAround("function SessionRecordsWindow", 0, 22000);

    expect(windowSource).toContain("const [selectedRecord, setSelectedRecord] = useState<SessionRecord | null>(null);");
    expect(windowSource).toContain("getSessionRecord(recordId)");
    expect(windowSource).toContain("getSessionRecordAudioData(recordId)");
    expect(windowSource).toContain("getSessionRecordAudioUrl(recordId)");
    expect(windowSource).toContain("ensureSeekableSessionRecording");
    expect(windowSource).toContain("URL.revokeObjectURL");
    expect(windowSource).toContain("renameSessionRecord(selectedRecord.id, nextTitle)");
    expect(windowSource).toContain("seekRecordAudio(segment.startMs);");
    expect(windowSource).toContain("pendingRecordSeekMsRef");
    expect(rendererSource).toContain("onCanPlay={(event) => onAudioCanPlay(event.currentTarget)}");
    expect(rendererSource).toContain("onLoadedMetadata={(event) => onAudioLoadedMetadata(event.currentTarget)}");
    expect(windowSource).toContain("applyPendingRecordSeek(audio)");
    expect(windowSource).toContain("seekAudioElement(audio, pendingSeekMs)");
    expect(windowSource).toContain("audio.readyState === 0");
    expect(windowSource).toContain("audio.load();");
    expect(rendererSource).toContain("selectSessionRecordPlaybackSegmentId(segments, playbackMs)");
    expect(windowSource).toContain("node?.scrollIntoView({ block: \"center\", behavior: \"smooth\" });");
    expect(rendererSource).toContain("className=\"recordTitle\"");
    expect(rendererSource).toContain("contentEditable");
    expect(windowSource).toContain("renameSelectedRecord(newTitle)");
    expect(rendererSource).toContain("isActive={segment.id === activeSegmentId || segment.id === activeMatchSegmentId}");
  });

  it("详情页搜索、标签页、音量和倍速是真实状态，不保留占位日志", () => {
    const windowSource = sourceAround("function SessionRecordsWindow", 0, 26000);
    const detailSource = sourceAround("function SessionRecordDetailPanel", 0, 9000);
    const playerSource = sourceAround("function RecordPlayer", 0, 2200);
    const segmentSource = sourceAround("function TranscriptSegment", 0, 2600);

    expect(windowSource).toContain("const [recordTranscriptTab, setRecordTranscriptTab]");
    expect(windowSource).toContain("const [recordSearchQuery, setRecordSearchQuery]");
    expect(windowSource).toContain("const [recordAudioVolume, setRecordAudioVolume]");
    expect(windowSource).toContain("const [recordAudioSpeed, setRecordAudioSpeed]");
    expect(windowSource).toContain("recordSearchMatchIds");
    expect(windowSource).toContain("selectedRecordSegmentSourceText(segment)");
    expect(windowSource).toContain("selectedRecordSegmentTargetText(segment)");
    expect(windowSource).toContain("focusRecordSearchMatch(activeRecordMatchIndex + 1)");
    expect(windowSource).toContain("recordAudioRef.current.volume = boundedVolume / 100");
    expect(windowSource).toContain("recordAudioRef.current.playbackRate = nextSpeed");
    expect(detailSource).toContain("activeTab={activeTab}");
    expect(detailSource).toContain("searchValue={searchQuery}");
    expect(detailSource).toContain("onPrevMatch={onPrevSearchMatch}");
    expect(detailSource).toContain("onNextMatch={onNextSearchMatch}");
    expect(detailSource).toContain("audioStatus === \"missing\"");
    expect(detailSource).toContain("displayMode={activeTab}");
    expect(detailSource).toContain("highlightQuery={searchQuery}");
    expect(playerSource).toContain("aria-label=\"音量\"");
    expect(playerSource).toContain("onChange={(event) => onVolumeChange?.(Number(event.target.value))}");
    expect(segmentSource).toContain("escapeRegExp(query)");
    expect(rendererSource).not.toContain("console.log(");
    expect(rendererSource).not.toContain("TODO:");
  });

  it("详情页搜索无匹配时禁用上下导航，避免无声空操作", () => {
    const toolbarSource = sourceAround("function TranscriptToolbar", 0, 2200);

    expect(toolbarSource).toContain("const hasSearchMatches = Boolean(searchValue.trim() && searchResultCount && searchResultCount > 0);");
    expect(toolbarSource).toContain("disabled={!hasSearchMatches}");
    expect(glassDesignStyleSource).toContain(".iconBtn:disabled");
  });

  it("详情页音频回放使用记录时长自绘进度，避免 WebM 原生时长误导", () => {
    const windowSource = sourceAround("function SessionRecordsWindow", 0, 19000);
    const progressSource = sourceAround("aria-label=\"音频回放进度\"", 700, 700);

    expect(windowSource).toContain("const [recordAudioPlaying, setRecordAudioPlaying] = useState(false);");
    expect(windowSource).toContain("const [recordAudioStatus, setRecordAudioStatus]");
    expect(windowSource).toContain("reviewTimelineFromSessionTimeline(selectedRecord?.timeline)");
    expect(windowSource).toContain("selectReviewPlaybackMs(selectedReviewTimeline, playbackMs)");
    expect(windowSource).toContain("reviewToRawMs(selectedReviewTimeline, nextReviewMs)");
    expect(rendererSource).toContain("selectSessionRecordPlaybackUpdate");
    expect(rendererSource).toContain("selectAutoSkipTargetRawMs(timeline, currentMs)");
    expect(windowSource).toContain("function seekRecordAudio(nextMs: number)");
    expect(windowSource).toContain("function toggleRecordAudioPlayback()");
    expect(rendererSource).toContain("audioStatus={recordAudioStatus}");
    expect(rendererSource).toContain("audioStatus === \"loading\"");
    expect(windowSource).toContain("setRecordAudioStatus(\"ready\")");
    expect(windowSource).toContain("pendingRecordSeekMsRef.current = playbackMs");
    expect(rendererSource).toContain("currentPlaybackMs={reviewPlaybackMs}");
    expect(rendererSource).toContain("currentMs={currentPlaybackMs}");
    expect(rendererSource).toContain("durationMs={reviewDurationMs}");
    expect(windowSource).toContain("audio.volume = recordAudioVolume / 100");
    expect(windowSource).toContain("audio.playbackRate = recordAudioSpeed");
    expect(rendererSource).toContain("className=\"recordPlayer\"");
    expect(progressSource).toContain("max={durationMs}");
    expect(progressSource).toContain("value={boundedCurrentMs}");
    expect(progressSource).toContain("onChange={(event) => onSeek(Number(event.target.value))}");
    expect(windowSource).not.toContain("<audio\n                controls");
  });

  it("压缩静音自动跳过保留 compact gap，且记录详情页跳过后同步刷新高亮片段", () => {
    const finishedSource = sourceAround("function updateArchivePlayback", 0, 1200);
    const recordSource = sourceAround("function updateRecordPlayback", 0, 1800);

    expect(finishedSource).toContain("const playbackUpdate = selectSessionArchivePlaybackUpdate");
    expect(rendererSource).toContain("selectAutoSkipTargetRawMs(timeline, currentMs)");
    expect(rendererSource).toContain("selectReviewPlaybackMs(archiveReviewTimeline, playbackMs)");
    expect(finishedSource).toContain("if (playbackUpdate.skipTargetRawMs !== null)");
    expect(finishedSource).not.toContain("pendingArchiveSeekMsRef.current = compressedSilence.rawEndMs");
    expect(recordSource).toContain("const playbackUpdate = selectSessionRecordPlaybackUpdate");
    expect(rendererSource).toContain("selectAutoSkipTargetRawMs(timeline, currentMs)");
    expect(rendererSource).toContain("selectReviewPlaybackMs(selectedReviewTimeline, playbackMs)");
    expect(recordSource).toContain("setActiveRecordSegmentId(playbackUpdate.activeSegmentId);");
    expect(recordSource).not.toContain("pendingRecordSeekMsRef.current = compressedSilence.rawEndMs");
  });

  it("停止保存时为复盘记录生成三条时间线并持久化", () => {
    const stopSource = sourceAround("async function stopCapture", 0, 4300);
    const draftSource = sourceAround("async function buildSessionRecordDraftInput", 0, 1800);

    expect(stopSource).toContain("const timeline = buildSessionRecordTimeline");
    expect(stopSource).toContain("activityRanges: seekableRecording?.activityRanges");
    expect(stopSource).toContain("timeline,");
    expect(draftSource).toContain("timeline: archive.timeline");
  });

  it("详情页片段使用非 button 卡片，避免原生按钮布局把双语文本压扁", () => {
    const segmentSource = sourceAround("function TranscriptSegment", 0, 2200);

    expect(segmentSource).toContain("<article");
    expect(segmentSource).toContain("className={`recordSegment");
    expect(segmentSource).toContain("<button className=\"recordSegmentPlay\"");
    expect(segmentSource).toContain("onClick={onPlay}");
    expect(segmentSource).not.toContain("<button\n                    className={segment.id === activeRecordSegmentId ? \"recordSegmentPair active\" : \"recordSegmentPair\"}");
  });
});

describe("采集资源生命周期契约", () => {
  it("收到新的监听会话时清空当前窗口的旧字幕状态", () => {
    const listenerSource = sourceAround("const removeCaptureListener = onCaptureState", 0, 2600);

    expect(listenerSource).toContain("const newListeningSession");
    expect(listenerSource).toContain("setLines(createInitialCaptionLines());");
    expect(listenerSource).toContain("setRealtimeError(null);");
    expect(listenerSource).toContain("terminalRealtimeErrorRef.current = null;");
  });

  it("桌面端未返回采集状态时清理已创建的实时客户端和 TTS 队列", () => {
    const failureSource = sourceAround("桌面端没有返回音频采集状态。", 500, 300);

    expect(failureSource).toContain("realtimeClientRef.current = null;");
    expect(failureSource).toContain("activeSessionIdRef.current = null;");
    expect(failureSource).toContain("ttsPlayback.clear();");
    expect(failureSource).toContain("await client.stop();");
  });

  it("替换或清空会话归档前释放录音 ObjectURL", () => {
    expect(rendererSource).toContain("function releaseSessionArchive");
    expect(rendererSource).toContain("URL.revokeObjectURL(archive.audio.objectUrl)");
    expect(rendererSource).toContain("const setSessionArchiveDraft = useCallback");
    expect(rendererSource).toContain("releaseSessionArchive(sessionArchiveRef.current);");
    expect(rendererSource).not.toContain("setSessionArchive(null);");
  });

  it("TTS 播放队列只在首次渲染时创建", () => {
    expect(rendererSource).toContain("const ttsPlaybackRef = useRef<TtsAudioPlaybackQueue | null>(null);");
    expect(rendererSource).toContain("ttsPlaybackRef.current ??= createTtsAudioPlaybackQueue({ logger: log });");
    expect(rendererSource).toContain("const ttsPlayback = ttsPlaybackRef.current;");
  });

  it("字幕弹窗只对窗口化字幕行做显示合成，并记录渲染热路径耗时", () => {
    const overlaySource = sourceAround("function OverlayWindow", 0, 5200);
    const eventListenerSource = sourceAround("caption_event_renderer_processed", 900, 900);

    expect(overlaySource).toContain("selectOverlayDisplayWindow(lines, activeLine?.id)");
    expect(overlaySource).toContain("caption_overlay_render_metrics");
    expect(overlaySource).toContain("selectDisplayMs");
    expect(overlaySource).toContain("presentationMs");
    expect(overlaySource).toContain("pendingLineCount");
    expect(eventListenerSource).toContain("caption_event_renderer_processed");
    expect(eventListenerSource).toContain("applyEventMs");
    expect(eventListenerSource).toContain("linesCount");
  });
});
