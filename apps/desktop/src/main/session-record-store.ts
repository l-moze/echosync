import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildSessionRecordMetadata,
  normalizeSessionRecordSegmentsTiming,
  serializeSessionRecordMarkdown,
  serializeSessionRecordSrt,
  serializeSessionRecordText,
  toSessionRecordListItem,
  type SessionRecord,
  type SessionRecordDraftInput,
  type SessionRecordExportFormat,
  type SessionRecordExportResult,
  type SessionRecordListItem,
  type SessionRecordSegmentUpdate,
  type SessionRecordSummary
} from "../shared/session-records";

export type SessionRecordStore = {
  list: () => Promise<SessionRecordListItem[]>;
  get: (id: string) => Promise<SessionRecord | null>;
  saveDraft: (input: SessionRecordDraftInput) => Promise<SessionRecord>;
  updateSummary: (id: string, summary: Partial<SessionRecordSummary>) => Promise<SessionRecord>;
  updateSegment: (id: string, update: SessionRecordSegmentUpdate) => Promise<SessionRecord>;
  rename: (id: string, title: string) => Promise<SessionRecord>;
  delete: (id: string) => Promise<void>;
  exportRecord: (id: string, format: SessionRecordExportFormat) => Promise<SessionRecordExportResult>;
  getAudioData: (id: string) => Promise<{ data: ArrayBuffer; mimeType: string } | null>;
  getAudioUrl: (id: string) => Promise<string | null>;
};

export function createSessionRecordStore(rootDir: string): SessionRecordStore {
  const sessionsDir = path.join(rootDir, "sessions");

  async function ensureRootDir() {
    await fs.mkdir(sessionsDir, { recursive: true });
  }

  async function readRecord(id: string) {
    const recordPath = sessionJsonPath(sessionsDir, id);
    try {
      return normalizeStoredRecord(JSON.parse(await fs.readFile(recordPath, "utf8")) as SessionRecord);
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async function writeRecord(record: SessionRecord) {
    const dir = sessionDir(sessionsDir, record.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(sessionJsonPath(sessionsDir, record.id), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  return {
    async list() {
      await ensureRootDir();
      const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => readRecord(entry.name))
      );
      return records
        .filter((record): record is SessionRecord => Boolean(record))
        .sort((left, right) => Date.parse(right.endedAt) - Date.parse(left.endedAt))
        .map(toSessionRecordListItem);
    },

    async get(id) {
      await ensureRootDir();
      return readRecord(id);
    },

    async saveDraft(input) {
      await ensureRootDir();
      const now = new Date().toISOString();
      const normalizedTiming = normalizeSessionRecordSegmentsTiming(input.segments);
      const metadata = {
        ...buildSessionRecordMetadata(normalizedTiming.segments),
        averageCaptionLagMs: input.averageCaptionLagMs
      };
      const dir = sessionDir(sessionsDir, input.id);
      await fs.mkdir(dir, { recursive: true });

      const existing = await readRecord(input.id);
      const audio = input.audio
        ? await writeAudioFile(dir, input.audio)
        : existing?.audio;
      const summary = buildDraftSummary(input.summary, now);
      const record: SessionRecord = {
        id: input.id,
        title: normalizeTitle(input.title),
        createdAt: input.createdAt,
        startedAt: input.startedAt ?? input.createdAt,
        endedAt: input.endedAt,
        durationMs: input.durationMs,
        sourceLang: input.sourceLang ?? "en",
        targetLang: input.targetLang ?? "zh",
        audio,
        summary,
        metadata,
        diagnostics: {
          hasTimingAnomaly: Boolean(input.diagnostics?.hasTimingAnomaly || normalizedTiming.hasTimingAnomaly),
          hasTranslationGap: Boolean(input.diagnostics?.hasTranslationGap),
          logPath: input.diagnostics?.logPath
        },
        timeline: input.timeline,
        segments: normalizedTiming.segments,
        updatedAt: now
      };

      await writeRecord(record);
      return record;
    },

    async updateSummary(id, summary) {
      const record = await readRecord(id);
      if (!record) {
        throw new Error(`未找到会议记录：${id}`);
      }
      const now = new Date().toISOString();
      const nextRecord = {
        ...record,
        summary: buildDraftSummary(
          {
            ...record.summary,
            ...summary,
            updatedAt: summary.updatedAt ?? now
          },
          now
        ),
        updatedAt: now
      };
      await writeRecord(nextRecord);
      return nextRecord;
    },

    async updateSegment(id, update) {
      const record = await readRecord(id);
      if (!record) {
        throw new Error(`未找到会议记录：${id}`);
      }
      const segmentExists = record.segments.some((segment) => segment.id === update.segmentId);
      if (!segmentExists) {
        throw new Error(`未找到会议记录片段：${update.segmentId}`);
      }
      const now = new Date().toISOString();
      const nextRecord = {
        ...record,
        segments: record.segments.map((segment) => {
          if (segment.id !== update.segmentId) {
            return segment;
          }
          return {
            ...segment,
            ...(update.sourceEditedText !== undefined ? { sourceEditedText: update.sourceEditedText } : {}),
            ...(update.targetEditedText !== undefined ? { targetEditedText: update.targetEditedText } : {}),
            ...(update.revisionState !== undefined ? { revisionState: update.revisionState } : {})
          };
        }),
        updatedAt: now
      };
      await writeRecord(nextRecord);
      return nextRecord;
    },

    async rename(id, title) {
      const record = await readRecord(id);
      if (!record) {
        throw new Error(`未找到会议记录：${id}`);
      }
      const nextRecord = {
        ...record,
        title: normalizeTitle(title),
        updatedAt: new Date().toISOString()
      };
      await writeRecord(nextRecord);
      return nextRecord;
    },

    async delete(id) {
      await fs.rm(sessionDir(sessionsDir, id), { force: true, recursive: true });
    },

    async exportRecord(id, format) {
      const record = await readRecord(id);
      if (!record) {
        throw new Error(`未找到会议记录：${id}`);
      }
      return {
        text: serializeRecord(record, format)
      };
    },

    async getAudioData(id) {
      const record = await readRecord(id);
      if (!record?.audio?.path) {
        return null;
      }
      const buffer = await fs.readFile(record.audio.path);
      return {
        data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        mimeType: record.audio.mimeType || "audio/webm"
      };
    },

    async getAudioUrl(id) {
      const record = await readRecord(id);
      if (!record?.audio?.path) {
        return null;
      }
      return pathToFileURL(record.audio.path).toString();
    }
  };
}

function normalizeStoredRecord(record: SessionRecord): SessionRecord {
  // Migrate old timeline.mode to timeline.sourceType
  let timeline = record.timeline;
  if (timeline && "mode" in timeline) {
    const oldTimeline = timeline as any;
    timeline = {
      ...timeline,
      sourceType: oldTimeline.mode as any,
    };
    delete (timeline as any).mode;
  }

  return {
    ...record,
    timeline,
    summary: buildDraftSummary(record.summary, record.summary?.updatedAt ?? record.updatedAt)
  };
}

function sessionDir(sessionsDir: string, id: string) {
  return path.join(sessionsDir, sanitizePathSegment(id));
}

function sessionJsonPath(sessionsDir: string, id: string) {
  return path.join(sessionDir(sessionsDir, id), "session.json");
}

async function writeAudioFile(dir: string, audio: NonNullable<SessionRecordDraftInput["audio"]>) {
  const ext = audioExtensionFromMimeType(audio.mimeType);
  const audioPath = path.join(dir, `audio${ext}`);
  const buffer = Buffer.from(audio.data);
  await fs.writeFile(audioPath, buffer);
  return {
    path: audioPath,
    mimeType: audio.mimeType || "audio/webm",
    sizeBytes: buffer.byteLength
  };
}

// 构建会议记录摘要的默认结构，并清洗历史数据格式
function buildDraftSummary(summary: Partial<SessionRecordSummary> | undefined, now: string): SessionRecordSummary {
  return {
    status: summary?.status ?? "pending",
    text: summary?.text ?? "",
    keywords: normalizeStringArray(summary?.keywords ?? []),
    actionItems: normalizeStringArray(summary?.actionItems ?? []),
    topics: normalizeStringArray(summary?.topics ?? []),
    risks: normalizeStringArray(summary?.risks ?? []),
    terminologySuggestions: normalizeStringArray(summary?.terminologySuggestions ?? []),
    errorMessage: summary?.errorMessage,
    updatedAt: summary?.updatedAt ?? now
  };
}

// 清洗摘要数组字段：兼容旧版对象格式 {id, text, confidence, evidence} 和新版字符串格式
// 旧版数据（~2026-06-08）存储了增强格式，提取 text 字段以兼容类型定义
function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(item => {
    if (typeof item === 'string') {
      return item;
    }
    if (typeof item === 'object' && item !== null && 'text' in item && typeof item.text === 'string') {
      return item.text;
    }
    return '';
  }).filter(Boolean);
}

function serializeRecord(record: SessionRecord, format: SessionRecordExportFormat) {
  if (format === "srt") {
    return serializeSessionRecordSrt(record);
  }
  if (format === "txt") {
    return serializeSessionRecordText(record);
  }
  return serializeSessionRecordMarkdown(record);
}

function normalizeTitle(title: string) {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    throw new Error("会议记录标题不能为空。");
  }
  return normalizedTitle;
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "session";
}

function audioExtensionFromMimeType(mimeType: string) {
  if (mimeType.includes("ogg")) {
    return ".ogg";
  }
  if (mimeType.includes("wav")) {
    return ".wav";
  }
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) {
    return ".mp3";
  }
  return ".webm";
}

function isNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
