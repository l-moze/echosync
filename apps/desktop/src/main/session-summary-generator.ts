import {
  type SessionRecord,
  type SessionRecordSegment,
  type SessionRecordSummary
} from "../shared/session-records";

export type SessionSummaryFetch = (
  url: string,
  init: {
    body: string;
    headers: Record<string, string>;
    method: "POST";
  }
) => Promise<{
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
  text?: () => Promise<string>;
}>;

export type SessionSummaryGenerator = {
  generate: (record: SessionRecord) => Promise<SessionRecordSummary>;
};

export type OpenAiCompatibleSessionSummaryConfig = {
  apiKey: string;
  baseUrl: string;
  fetchFn?: SessionSummaryFetch;
  model: string;
  now?: () => string;
};

export const SESSION_SUMMARY_SYSTEM_PROMPT = [
  "你是 EchoSync 的会议复盘摘要助手。",
  "请根据完整双语同传片段生成中文复盘摘要。",
  "只输出 JSON，不要输出 Markdown。",
  "JSON 字段必须包含 summary、keywords、action_items、topics、risks、terminology_suggestions。",
  "keywords、action_items、topics、risks、terminology_suggestions 都必须是字符串数组。",
  "没有明确行动项、风险或术语建议时返回空数组，不要编造。"
].join("\n");

export function createOpenAiCompatibleSessionSummaryGenerator({
  apiKey,
  baseUrl,
  fetchFn = defaultSessionSummaryFetch,
  model,
  now = () => new Date().toISOString()
}: OpenAiCompatibleSessionSummaryConfig): SessionSummaryGenerator {
  return {
    async generate(record) {
      if (!apiKey.trim()) {
        throw new Error("未配置会议摘要模型密钥，请设置 DEEPSEEK_API_KEY 或 ECHOSYNC_SESSION_SUMMARY_API_KEY。");
      }
      const response = await fetchFn(`${trimTrailingSlash(baseUrl)}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SESSION_SUMMARY_SYSTEM_PROMPT },
            { role: "user", content: buildSessionSummaryPrompt(record) }
          ],
          response_format: { type: "json_object" },
          temperature: 0.2
        })
      });

      if (!response.ok) {
        const body = response.text ? await response.text() : "";
        throw new Error(`会议摘要模型请求失败：HTTP ${response.status}${body ? ` ${body}` : ""}`);
      }

      const payload = await response.json();
      const content = extractChatCompletionContent(payload);
      return parseSessionSummaryContent(content, now());
    }
  };
}

export function createSessionSummaryGeneratorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: SessionSummaryFetch = defaultSessionSummaryFetch
) {
  return createOpenAiCompatibleSessionSummaryGenerator({
    apiKey: env.ECHOSYNC_SESSION_SUMMARY_API_KEY || env.DEEPSEEK_API_KEY || "",
    baseUrl: env.ECHOSYNC_SESSION_SUMMARY_BASE_URL || env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
    fetchFn,
    model: env.ECHOSYNC_SESSION_SUMMARY_MODEL || env.DEEPSEEK_MODEL || "deepseek-chat"
  });
}

export function buildSessionSummaryPrompt(record: SessionRecord) {
  const segments = record.segments.map(formatSegmentForPrompt).join("\n\n");
  const durationLines = record.timeline
    ? [
        `复盘时长毫秒：${record.timeline.reviewDurationMs}`,
        `总录制时长毫秒：${record.timeline.rawDurationMs}`,
        `有效内容时长毫秒：${record.timeline.contentDurationMs}`
      ]
    : [`时长毫秒：${record.durationMs}`];
  return [
    "请生成会议复盘摘要。",
    "",
    `标题：${record.title}`,
    `语言：${record.sourceLang} -> ${record.targetLang}`,
    `开始时间：${record.startedAt}`,
    `结束时间：${record.endedAt}`,
    ...durationLines,
    `片段数：${record.segments.length}`,
    "",
    "输出 JSON 格式：",
    "{",
    "  \"summary\": \"一段 80-180 字中文摘要\",",
    "  \"keywords\": [\"关键词\"],",
    "  \"action_items\": [\"行动项\"],",
    "  \"topics\": [\"主题\"],",
    "  \"risks\": [\"风险或待确认事项\"],",
    "  \"terminology_suggestions\": [\"术语建议\"]",
    "}",
    "",
    "完整双语片段：",
    segments || "无可用片段。"
  ].join("\n");
}

export function parseSessionSummaryContent(content: string, updatedAt: string): SessionRecordSummary {
  const parsed = JSON.parse(stripJsonFence(content));
  return {
    status: "ready",
    text: stringValue(readField(parsed, "summary", "text")),
    keywords: stringArray(readField(parsed, "keywords")),
    actionItems: stringArray(readField(parsed, "action_items", "actionItems")),
    topics: stringArray(readField(parsed, "topics")),
    risks: stringArray(readField(parsed, "risks")),
    terminologySuggestions: stringArray(readField(parsed, "terminology_suggestions", "terminologySuggestions")),
    updatedAt
  };
}

function formatSegmentForPrompt(segment: SessionRecordSegment) {
  return [
    `[${formatPromptTimestamp(segment.startMs)}-${formatPromptTimestamp(segment.endMs)}]`,
    `原文：${segment.sourceEditedText ?? segment.sourceText}`,
    `译文：${segment.targetEditedText ?? segment.targetText}`
  ].join("\n");
}

function formatPromptTimestamp(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function extractChatCompletionContent(payload: unknown) {
  const choices = readField(payload, "choices");
  if (!Array.isArray(choices)) {
    throw new Error("会议摘要模型响应缺少 choices。");
  }
  const first = choices[0];
  const message = readField(first, "message");
  const content = readField(message, "content");
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("会议摘要模型响应缺少 message.content。");
  }
  return content;
}

function stripJsonFence(content: string) {
  return content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function readField(value: unknown, ...keys: string[]) {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return keys.map((key) => record[key]).find((item) => item !== undefined);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

async function defaultSessionSummaryFetch(url: string, init: Parameters<SessionSummaryFetch>[1]) {
  return fetch(url, init);
}
