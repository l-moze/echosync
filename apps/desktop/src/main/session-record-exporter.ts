import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

import {
  SESSION_RECORD_EXPORT_FORMATS,
  formatDateTimeForRecord,
  formatDurationForRecord,
  serializeSessionRecordCsv,
  serializeSessionRecordJson,
  serializeSessionRecordMarkdown,
  serializeSessionRecordSrt,
  serializeSessionRecordText,
  type SessionRecord,
  type SessionRecordExportFormat,
  type SessionRecordExportFormatInfo,
  type SessionRecordSegment
} from "../shared/session-records";

export type SessionRecordExportPayload = {
  data: Buffer;
  extension: string;
  fileName: string;
  format: SessionRecordExportFormat;
  label: string;
  mimeType: string;
};

export async function buildSessionRecordExportPayload(
  record: SessionRecord,
  format: SessionRecordExportFormat
): Promise<SessionRecordExportPayload> {
  const formatInfo = getExportFormatInfo(format);
  return {
    data: format === "docx" ? await buildDocxBuffer(record) : Buffer.from(serializeRecord(record, format), "utf8"),
    extension: formatInfo.extension,
    fileName: defaultExportFileName(record, format),
    format,
    label: formatInfo.label,
    mimeType: formatInfo.mimeType
  };
}

export function defaultExportFileName(
  record: Pick<SessionRecord, "title">,
  format: SessionRecordExportFormat
) {
  const formatInfo = getExportFormatInfo(format);
  const safeTitle = sanitizeFileName(record.title);
  return `${safeTitle}.${formatInfo.extension}`;
}

export function exportDialogFilters(format: SessionRecordExportFormat): Electron.FileFilter[] {
  const formatInfo = getExportFormatInfo(format);
  return [
    {
      extensions: [formatInfo.extension],
      name: formatInfo.label
    },
    {
      extensions: ["*"],
      name: "All Files"
    }
  ];
}

function getExportFormatInfo(format: SessionRecordExportFormat): SessionRecordExportFormatInfo {
  const formatInfo = SESSION_RECORD_EXPORT_FORMATS.find((item) => item.id === format);
  if (!formatInfo) {
    throw new Error(`不支持的导出格式：${format}`);
  }
  return formatInfo;
}

function serializeRecord(record: SessionRecord, format: SessionRecordExportFormat) {
  if (format === "srt") {
    return serializeSessionRecordSrt(record);
  }
  if (format === "txt") {
    return serializeSessionRecordText(record);
  }
  if (format === "json") {
    return serializeSessionRecordJson(record);
  }
  if (format === "csv") {
    return serializeSessionRecordCsv(record);
  }
  return serializeSessionRecordMarkdown(record);
}

async function buildDocxBuffer(record: SessionRecord) {
  const doc = new Document({
    creator: "EchoSync",
    description: "EchoSync bilingual session record export",
    title: record.title,
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            text: record.title
          }),
          ...metadataParagraphs(record),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            text: "摘要"
          }),
          new Paragraph(record.summary.text || "待生成"),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            text: "双语记录"
          }),
          ...record.segments.flatMap((segment, index) => segmentParagraphs(segment, index))
        ]
      }
    ]
  });
  return Packer.toBuffer(doc);
}

function metadataParagraphs(record: SessionRecord) {
  const durationLines = record.timeline
    ? [
        `复盘时长：${formatDurationForRecord(record.timeline.reviewDurationMs)}`,
        ...(record.timeline.rawDurationMs !== record.timeline.reviewDurationMs
          ? [`总录制时长：${formatDurationForRecord(record.timeline.rawDurationMs)}`]
          : [])
      ]
    : [`时长：${formatDurationForRecord(record.durationMs)}`];

  return [
    `开始时间：${formatDateTimeForRecord(record.startedAt)}`,
    `结束时间：${formatDateTimeForRecord(record.endedAt)}`,
    ...durationLines,
    `语言：${record.sourceLang} -> ${record.targetLang}`,
    `片段数：${record.metadata.segmentCount}`
  ].map((text) => new Paragraph(text));
}

function segmentParagraphs(segment: SessionRecordSegment, index: number) {
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      text: `${index + 1}. ${formatSegmentRange(segment)}`
    }),
    new Paragraph({
      children: [new TextRun({ bold: true, text: "原文：" }), new TextRun(selectedSourceText(segment))]
    }),
    new Paragraph({
      children: [new TextRun({ bold: true, text: "译文：" }), new TextRun(selectedTargetText(segment))]
    })
  ];
}

function selectedSourceText(segment: SessionRecordSegment) {
  return segment.sourceEditedText ?? segment.sourceText;
}

function selectedTargetText(segment: SessionRecordSegment) {
  return segment.targetEditedText ?? segment.targetText;
}

function formatSegmentRange(segment: SessionRecordSegment) {
  return `${formatSegmentTime(segment.startMs)}-${formatSegmentTime(segment.endMs)}`;
}

function formatSegmentTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function sanitizeFileName(value: string) {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return sanitized || "EchoSync";
}
