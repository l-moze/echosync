import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const rendererSource = readFileSync(resolve(__dirname, "../src/renderer/main.tsx"), "utf8");

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
    expect(searchInputSource).toContain("onChange={(event) => setSearchQuery(event.target.value)}");
    expect(rendererSource).toContain("records={filteredRecords}");
  });

  it("会议记录窗口使用本地持久化记录并在删除后刷新", () => {
    const windowSource = sourceAround("function SessionRecordsWindow", 0, 8000);

    expect(windowSource).toContain("records: SessionRecordListItem[];");
    expect(windowSource).toContain("onRecordsChanged: () => Promise<void>;");
    expect(windowSource).toContain("await window.echosyncDesktop?.sessionRecords.delete(recordId)");
    expect(windowSource).toContain("await onRecordsChanged();");
    expect(rendererSource).not.toContain("const recentSessionRecords");
  });

  it("停止会话后把复盘草稿保存到本地会议记录", () => {
    const stopSource = sourceAround("async function stopCapture", 0, 3400);

    expect(rendererSource).toContain("async function buildSessionRecordDraftInput");
    expect(stopSource).toContain("const archive = buildSessionArchiveDraft");
    expect(stopSource).toContain("setSessionArchiveDraft(archive);");
    expect(stopSource).toContain("void saveSessionArchiveDraft(archive");
    expect(rendererSource).toContain("await window.echosyncDesktop?.sessionRecords.saveDraft(input);");
  });

  it("停止会话保存记录不依赖采集状态快照成功返回", () => {
    const stopSource = sourceAround("async function stopCapture", 0, 5200);

    expect(stopSource).toContain("if (nextSnapshot) {\n      setSnapshot(nextSnapshot);\n    }\n    const endedAt");
    expect(stopSource).toContain("const elapsedDurationMs");
    expect(stopSource).toContain("Math.max(...lines.map((line) => line.endMs), elapsedDurationMs, 0)");
  });

  it("本次复盘点击片段在音频元数据就绪后补偿跳转", () => {
    const finishedSource = sourceAround("function FinishedDashboard", 0, 9000);
    const archiveProgressSource = sourceAround("aria-label=\"本次复盘音频进度\"", 700, 700);

    expect(finishedSource).toContain("pendingArchiveSeekMsRef");
    expect(finishedSource).toContain("pendingArchivePlayRef");
    expect(finishedSource).toContain("applyPendingArchiveSeek(event.currentTarget)");
    expect(finishedSource).toContain("seekAudioElement(audio, pendingSeekMs)");
    expect(finishedSource).toContain("reviewToRawMs(archiveReviewTimeline, nextReviewMs)");
    expect(finishedSource).toContain("selectCompressedSilenceSpanByRawMs(archiveReviewTimeline, currentMs)");
    expect(finishedSource).toContain("audio.readyState === 0");
    expect(finishedSource).toContain("audio.load();");
    expect(finishedSource).toContain("setPlaybackMs(line.startMs);");
    expect(archiveProgressSource).toContain("max={archiveReviewDurationMs}");
    expect(archiveProgressSource).toContain("value={Math.min(archiveReviewPlaybackMs, archiveReviewDurationMs)}");
    expect(finishedSource).not.toContain("<audio\n              controls");
  });

  it("详情页导出按钮会通过主进程导出并复制当前记录", () => {
    const exportSource = sourceAround("async function exportSelectedRecord", 0, 1200);
    const actionsSource = sourceAround("<button onClick={() => void exportSelectedRecord(\"txt\")}>TXT</button>", 500, 900);

    expect(exportSource).toContain("window.echosyncDesktop?.sessionRecords.export(selectedRecord.id, format)");
    expect(exportSource).toContain("serializeSessionRecordMarkdown(selectedRecord)");
    expect(exportSource).toContain("await window.echosyncDesktop?.copyText");
    expect(exportSource).toContain("format === \"markdown\" ? \"Markdown 已复制\"");
    expect(actionsSource).toContain("<button className=\"primaryAction\" onClick={() => void exportSelectedRecord()}>导出</button>");
    expect(actionsSource).toContain("<button onClick={() => void exportSelectedRecord(\"txt\")}>TXT</button>");
    expect(actionsSource).toContain("<button onClick={() => void exportSelectedRecord(\"srt\")}>SRT</button>");
    expect(actionsSource).toContain("{exportStatus ? <span className=\"recordExportStatus\"");
  });

  it("详情页读取完整记录，支持重命名、音频 URL、片段跳转和播放高亮", () => {
    const windowSource = sourceAround("function SessionRecordsWindow", 0, 22000);

    expect(windowSource).toContain("const [selectedRecord, setSelectedRecord] = useState<SessionRecord | null>(null);");
    expect(windowSource).toContain("window.echosyncDesktop?.sessionRecords.get(recordId)");
    expect(windowSource).toContain("window.echosyncDesktop?.sessionRecords.getAudioData(recordId)");
    expect(windowSource).toContain("window.echosyncDesktop?.sessionRecords.getAudioUrl(recordId)");
    expect(windowSource).toContain("ensureSeekableSessionRecording");
    expect(windowSource).toContain("URL.revokeObjectURL");
    expect(windowSource).toContain("window.echosyncDesktop?.sessionRecords.rename(selectedRecord.id, nextTitle)");
    expect(windowSource).toContain("seekRecordAudio(segment.startMs);");
    expect(windowSource).toContain("pendingRecordSeekMsRef");
    expect(windowSource).toContain("applyPendingRecordSeek(event.currentTarget)");
    expect(windowSource).toContain("seekAudioElement(audio, pendingSeekMs)");
    expect(windowSource).toContain("audio.readyState === 0");
    expect(windowSource).toContain("audio.load();");
    expect(windowSource).toContain("selectSessionRecordPlaybackSegmentId(selectedRecord.segments, boundedMs)");
    expect(windowSource).toContain("node?.scrollIntoView({ block: \"center\", behavior: \"smooth\" });");
    expect(windowSource).toContain("className=\"recordTitleInput\"");
    expect(windowSource).toContain("className={segment.id === activeRecordSegmentId ? \"recordSegmentPair active\" : \"recordSegmentPair\"}");
  });

  it("详情页音频回放使用记录时长自绘进度，避免 WebM 原生时长误导", () => {
    const windowSource = sourceAround("function SessionRecordsWindow", 0, 19000);
    const progressSource = sourceAround("aria-label=\"音频回放进度\"", 700, 700);

    expect(windowSource).toContain("const [recordAudioPlaying, setRecordAudioPlaying] = useState(false);");
    expect(windowSource).toContain("const [recordAudioStatus, setRecordAudioStatus]");
    expect(windowSource).toContain("reviewTimelineFromSessionTimeline(selectedRecord?.timeline)");
    expect(windowSource).toContain("rawToReviewMs(selectedReviewTimeline, playbackMs)");
    expect(windowSource).toContain("reviewToRawMs(selectedReviewTimeline, nextReviewMs)");
    expect(windowSource).toContain("selectCompressedSilenceSpanByRawMs(selectedReviewTimeline, currentMs)");
    expect(windowSource).toContain("function seekRecordAudio(nextMs: number)");
    expect(windowSource).toContain("function toggleRecordAudioPlayback()");
    expect(windowSource).toContain("recordAudioStatus === \"loading\"");
    expect(windowSource).toContain("setRecordAudioStatus(\"ready\")");
    expect(windowSource).toContain("pendingRecordSeekMsRef.current = playbackMs");
    expect(windowSource).toContain("className=\"recordAudioControls\"");
    expect(progressSource).toContain("max={reviewDurationMs}");
    expect(progressSource).toContain("value={Math.min(reviewPlaybackMs, reviewDurationMs)}");
    expect(progressSource).toContain("onChange={(event) => scrubRecordAudio(Number(event.target.value))}");
    expect(windowSource).not.toContain("<audio\n                controls");
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
    const windowSource = sourceAround("function SessionRecordsWindow", 0, 21000);

    expect(windowSource).toContain("function handleRecordSegmentKeyDown");
    expect(windowSource).toContain("<article");
    expect(windowSource).toContain("role=\"button\"");
    expect(windowSource).toContain("tabIndex={0}");
    expect(windowSource).toContain("onKeyDown={(event) => handleRecordSegmentKeyDown(segment, event)}");
    expect(windowSource).not.toContain("<button\n                    className={segment.id === activeRecordSegmentId ? \"recordSegmentPair active\" : \"recordSegmentPair\"}");
  });
});

describe("采集资源生命周期契约", () => {
  it("收到新的监听会话时清空当前窗口的旧字幕状态", () => {
    const listenerSource = sourceAround("const removeCaptureListener = window.echosyncDesktop?.onCaptureState", 0, 2600);

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
    expect(rendererSource).toContain("ttsPlaybackRef.current ??= createTtsAudioPlaybackQueue();");
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
