export type SessionRecordSummary = {
  status: "pending" | "ready" | "failed";
  text: string;
  keywords: string[];
  actionItems: string[];
  topics: string[];
  risks: string[];
  terminologySuggestions: string[];
  errorMessage?: string;
  updatedAt?: string;
};

export type SessionRecordMetadata = {
  segmentCount: number;
  sourceCharCount: number;
  targetCharCount: number;
  patchCount: number;
  averageCaptionLagMs?: number;
};

export type SessionRecordDiagnostics = {
  hasTimingAnomaly: boolean;
  hasTranslationGap: boolean;
  logPath?: string;
};

export type SessionRecordAudio = {
  path: string;
  mimeType: string;
  sizeBytes: number;
};

export type SessionRecordSegment = {
  id: string;
  startMs: number;
  endMs: number;
  sourceText: string;
  targetText: string;
  sourceEditedText?: string;
  targetEditedText?: string;
  revisionState: "draft" | "final" | "edited";
  patchCount: number;
};

export type SessionRecordTimelineMode = "meeting" | "video" | "course";

export type SessionRecordTimelineSpan = {
  kind: "content" | "silence";
  rawStartMs: number;
  rawEndMs: number;
  reviewStartMs: number;
  reviewEndMs: number;
};

export type SessionRecordTimeline = {
  rawDurationMs: number;
  contentDurationMs: number;
  reviewDurationMs: number;
  mode: SessionRecordTimelineMode;
  compressionEnabled: boolean;
  spans: SessionRecordTimelineSpan[];
};

export type SessionRecord = {
  id: string;
  title: string;
  createdAt: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  sourceLang: string;
  targetLang: string;
  audio?: SessionRecordAudio;
  summary: SessionRecordSummary;
  metadata: SessionRecordMetadata;
  diagnostics?: SessionRecordDiagnostics;
  timeline?: SessionRecordTimeline;
  segments: SessionRecordSegment[];
  updatedAt: string;
};

export type SessionRecordDraftAudio = {
  data: ArrayBuffer;
  mimeType: string;
};

export type SessionRecordDraftInput = {
  id: string;
  title: string;
  createdAt: string;
  startedAt?: string;
  endedAt: string;
  durationMs: number;
  sourceLang?: string;
  targetLang?: string;
  averageCaptionLagMs?: number;
  audio?: SessionRecordDraftAudio;
  timeline?: SessionRecordTimeline;
  summary?: Partial<SessionRecordSummary>;
  diagnostics?: Partial<SessionRecordDiagnostics>;
  segments: SessionRecordSegment[];
};

export type SessionRecordSegmentUpdateInput = {
  sourceText?: string;
  targetText?: string;
};

export type SessionRecordExportFormat = "docx" | "markdown" | "srt" | "txt" | "json" | "csv";

export type SessionRecordExportFormatInfo = {
  id: SessionRecordExportFormat;
  label: string;
  extension: string;
  mimeType: string;
};

export const SESSION_RECORD_EXPORT_FORMATS: SessionRecordExportFormatInfo[] = [
  {
    id: "docx",
    label: "DOCX",
    extension: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  },
  {
    id: "markdown",
    label: "Markdown",
    extension: "md",
    mimeType: "text/markdown;charset=utf-8"
  },
  {
    id: "txt",
    label: "TXT",
    extension: "txt",
    mimeType: "text/plain;charset=utf-8"
  },
  {
    id: "srt",
    label: "SRT",
    extension: "srt",
    mimeType: "application/x-subrip;charset=utf-8"
  },
  {
    id: "json",
    label: "JSON",
    extension: "json",
    mimeType: "application/json;charset=utf-8"
  },
  {
    id: "csv",
    label: "CSV",
    extension: "csv",
    mimeType: "text/csv;charset=utf-8"
  }
];

export type SessionRecordExportResult = {
  path?: string;
  text?: string;
};

export type SessionRecordSaveExportResult = {
  canceled: boolean;
  format: SessionRecordExportFormat;
  path?: string;
};

export type SessionRecordListItem = {
  id: string;
  title: string;
  endedAt: string;
  duration: string;
  sourceText: string;
  targetText: string;
  summaryStatus?: SessionRecordSummary["status"];
  summaryText?: string;
  segmentCount?: number;
};

export function filterSessionRecordsByTitle(records: SessionRecordListItem[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return records;
  }
  return records.filter((record) => record.title.toLocaleLowerCase().includes(normalizedQuery));
}

export function toSessionRecordListItem(record: SessionRecord): SessionRecordListItem {
  const firstTextSegment = record.segments.find((segment) => segment.sourceText || segment.targetText);
  return {
    id: record.id,
    title: record.title,
    endedAt: formatDateTimeForRecord(record.endedAt),
    duration: formatDurationForRecord(record.timeline?.reviewDurationMs ?? record.durationMs),
    sourceText: firstTextSegment?.sourceEditedText ?? firstTextSegment?.sourceText ?? "",
    targetText: firstTextSegment?.targetEditedText ?? firstTextSegment?.targetText ?? "",
    summaryStatus: record.summary.status,
    summaryText: record.summary.text,
    segmentCount: record.metadata.segmentCount
  };
}

export function buildSessionRecordMetadata(segments: SessionRecordSegment[]): SessionRecordMetadata {
  return {
    segmentCount: segments.length,
    sourceCharCount: segments.reduce((sum, segment) => sum + selectedSourceText(segment).length, 0),
    targetCharCount: segments.reduce((sum, segment) => sum + selectedTargetText(segment).length, 0),
    patchCount: segments.reduce((sum, segment) => sum + segment.patchCount, 0)
  };
}

export function normalizeSessionRecordSegmentsTiming(segments: SessionRecordSegment[]) {
  let previousEndMs = 0;
  let hasTimingAnomaly = false;
  const normalizedSegments = segments.map((segment, index) => {
    const rawStartMs = finiteNonNegative(segment.startMs);
    const rawEndMs = finiteNonNegative(segment.endMs);
    let startMs = rawStartMs;
    let endMs = Math.max(rawEndMs, startMs + 1);

    if (index > 0 && startMs < previousEndMs) {
      hasTimingAnomaly = true;
      startMs = previousEndMs;
    }

    if (endMs <= startMs) {
      hasTimingAnomaly = true;
      endMs = startMs + 1;
    }

    previousEndMs = endMs;
    return {
      ...segment,
      startMs,
      endMs
    };
  });

  return {
    hasTimingAnomaly,
    segments: normalizedSegments
  };
}

export function selectSessionRecordPlaybackSegmentId(segments: SessionRecordSegment[], currentMs: number) {
  const active = segments.find((segment) => currentMs >= segment.startMs && currentMs < segment.endMs);
  return active?.id ?? null;
}

export function serializeSessionRecordMarkdown(record: SessionRecord | SessionRecordListItem) {
  if (isFullSessionRecord(record)) {
    return serializeFullSessionRecordMarkdown(record);
  }

  return [
    `# ${record.title}`,
    "",
    `- 结束时间：${record.endedAt}`,
    `- 时长：${record.duration}`,
    "",
    "## 原文",
    "",
    record.sourceText,
    "",
    "## 译文",
    "",
    record.targetText
  ].join("\n");
}

export function serializeSessionRecordText(record: SessionRecord) {
  return record.segments
    .map((segment) => `${selectedSourceText(segment)}\n${selectedTargetText(segment)}`)
    .join("\n\n");
}

export function serializeSessionRecordJson(record: SessionRecord) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function serializeSessionRecordCsv(record: SessionRecord) {
  const rows = [
    ["index", "start_ms", "end_ms", "source_text", "target_text", "revision_state", "patch_count"],
    ...record.segments.map((segment, index) => [
      String(index + 1),
      String(segment.startMs),
      String(segment.endMs),
      selectedSourceText(segment),
      selectedTargetText(segment),
      segment.revisionState,
      String(segment.patchCount)
    ])
  ];

  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\n");
}

export function serializeSessionRecordSrt(record: SessionRecord) {
  return record.segments
    .map((segment, index) => {
      const text = [selectedSourceText(segment), selectedTargetText(segment)].filter(Boolean).join("\n");
      return [
        String(index + 1),
        `${formatSrtTimestamp(segment.startMs)} --> ${formatSrtTimestamp(segment.endMs)}`,
        text
      ].join("\n");
    })
    .join("\n\n");
}

export function formatDurationForRecord(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}小时${minutes.toString().padStart(2, "0")}分钟`;
  }
  if (minutes > 0) {
    return `${minutes}分钟${seconds.toString().padStart(2, "0")}秒`;
  }
  return `${seconds}秒`;
}

export function formatDateTimeForRecord(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hour = date.getHours().toString().padStart(2, "0");
  const minute = date.getMinutes().toString().padStart(2, "0");
  return `${year}年${month}月${day}日 ${hour}:${minute}`;
}

function serializeFullSessionRecordMarkdown(record: SessionRecord) {
  const summaryText = record.summary.text || "待生成";
  const durationLines = record.timeline
    ? [
        `- 复盘时长：${formatDurationForRecord(record.timeline.reviewDurationMs)}`,
        ...(record.timeline.rawDurationMs !== record.timeline.reviewDurationMs
          ? [`- 总录制时长：${formatDurationForRecord(record.timeline.rawDurationMs)}`]
          : [])
      ]
    : [`- 时长：${formatDurationForRecord(record.durationMs)}`];
  const transcript = record.segments.flatMap((segment) => [
    `### ${formatReviewTimestamp(segment.startMs)}-${formatReviewTimestamp(segment.endMs)}`,
    "",
    selectedSourceText(segment),
    "",
    selectedTargetText(segment),
    ""
  ]);

  return [
    `# ${record.title}`,
    "",
    `- 开始时间：${formatDateTimeForRecord(record.startedAt)}`,
    `- 结束时间：${formatDateTimeForRecord(record.endedAt)}`,
    ...durationLines,
    `- 片段数：${record.metadata.segmentCount}`,
    "",
    "## 摘要",
    "",
    summaryText,
    "",
    "## 双语记录",
    "",
    ...transcript
  ].join("\n").trimEnd();
}

function isFullSessionRecord(record: SessionRecord | SessionRecordListItem): record is SessionRecord {
  return "segments" in record;
}

function selectedSourceText(segment: SessionRecordSegment) {
  return segment.sourceEditedText ?? segment.sourceText;
}

function selectedTargetText(segment: SessionRecordSegment) {
  return segment.targetEditedText ?? segment.targetText;
}

function escapeCsvField(value: string) {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function finiteNonNegative(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

function formatReviewTimestamp(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatSrtTimestamp(ms: number) {
  const safeMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  const milliseconds = safeMs % 1000;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")},${milliseconds.toString().padStart(3, "0")}`;
}
