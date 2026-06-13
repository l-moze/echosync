import {
  type SessionRecord,
  type SessionRecordSegment,
  type SessionRecordSummary,
  type ActionItem,
  type Topic,
  type Risk,
  type Decision,
  type TerminologySuggestion,
  type EvidenceAnchor
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
  "",
  "输出格式要求：",
  "1. summary: 字符串，80-180 字中文摘要",
  "2. keywords: 字符串数组",
  "3. action_items: 结构化对象数组，每个包含 id、text、owner、dueDate、confidence、evidence",
  "4. topics: 结构化对象数组，每个包含 id、text、confidence、evidence",
  "5. risks: 结构化对象数组，每个包含 id、text、severity、confidence、evidence",
  "6. decisions: 结构化对象数组，每个包含 id、text、rationale、confidence、evidence",
  "7. terminology_suggestions: 结构化对象数组，每个包含 id、sourceText、targetText、context、confidence、evidence",
  "",
  "Evidence 要求（必须遵守）：",
  "- 每个 action_item、topic、risk、decision、terminology_suggestion 必须至少包含 1 个 evidence",
  "- 每个 evidence 包含：segmentId（片段ID）、startMs（起始毫秒）、endMs（结束毫秒）、quote（引用原文，必须是原文或译文的真实子串）、relevance（相关度 0-1）",
  "- segmentId 必须来自实际片段，不可编造",
  "- quote 必须是对应片段原文或译文的真实子串，不可编造或改写",
  "- 没有明确证据支持的结论不要输出，返回空数组",
  "",
  "约束：",
  "- 没有明确行动项、风险、决策或术语建议时返回空数组，不要编造",
  "- confidence 取值 0-1，表示结论的可信度",
  "- severity 取值 'low'、'medium'、'high'"
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
      try {
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
        return parseSessionSummaryContent(content, record.segments, now());
      } catch (error) {
        console.error("会议摘要生成失败：", error);
        return {
          status: "failed",
          text: "",
          keywords: [],
          actionItems: [],
          topics: [],
          risks: [],
          decisions: [],
          terminologySuggestions: [],
          errorMessage: error instanceof Error ? error.message : String(error),
          updatedAt: now()
        };
      }
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

  const diagnosticsLines = record.diagnostics
    ? [
        "",
        "诊断信息：",
        `- 时序异常：${record.diagnostics.hasTimingAnomaly ? "是" : "否"}`,
        `- 翻译缺失：${record.diagnostics.hasTranslationGap ? "是" : "否"}`
      ]
    : [];

  return [
    "请生成会议复盘摘要。",
    "",
    `标题：${record.title}`,
    `语言：${record.sourceLang} -> ${record.targetLang}`,
    `开始时间：${record.startedAt}`,
    `结束时间：${record.endedAt}`,
    ...durationLines,
    `片段数：${record.segments.length}`,
    ...diagnosticsLines,
    "",
    "输出 JSON 格式示例：",
    "{",
    "  \"summary\": \"一段 80-180 字中文摘要\",",
    "  \"keywords\": [\"关键词1\", \"关键词2\"],",
    "  \"action_items\": [",
    "    {",
    "      \"id\": \"action-1\",",
    "      \"text\": \"行动项描述\",",
    "      \"owner\": \"负责人（可选）\",",
    "      \"dueDate\": \"截止日期（可选）\",",
    "      \"confidence\": 0.9,",
    "      \"evidence\": [",
    "        {",
    "          \"segmentId\": \"实际片段 ID\",",
    "          \"startMs\": 1000,",
    "          \"endMs\": 5000,",
    "          \"quote\": \"原文或译文的真实引用片段\",",
    "          \"relevance\": 0.95",
    "        }",
    "      ]",
    "    }",
    "  ],",
    "  \"topics\": [{ \"id\": \"topic-1\", \"text\": \"主题\", \"confidence\": 0.8, \"evidence\": [...] }],",
    "  \"risks\": [{ \"id\": \"risk-1\", \"text\": \"风险\", \"severity\": \"high\", \"confidence\": 0.85, \"evidence\": [...] }],",
    "  \"decisions\": [{ \"id\": \"decision-1\", \"text\": \"决策\", \"rationale\": \"理由\", \"confidence\": 0.9, \"evidence\": [...] }],",
    "  \"terminology_suggestions\": [{ \"id\": \"term-1\", \"sourceText\": \"源术语\", \"targetText\": \"目标术语\", \"context\": \"上下文\", \"confidence\": 0.88, \"evidence\": [...] }]",
    "}",
    "",
    "完整双语片段：",
    segments || "无可用片段。"
  ].join("\n");
}

export function parseSessionSummaryContent(
  content: string,
  segments: SessionRecordSegment[],
  updatedAt: string
): SessionRecordSummary {
  const parsed = JSON.parse(stripJsonFence(content));

  const actionItems = parseStructuredItems<ActionItem>(
    readField(parsed, "action_items", "actionItems"),
    segments,
    "action"
  );

  const topics = parseStructuredItems<Topic>(
    readField(parsed, "topics"),
    segments,
    "topic"
  );

  const risks = parseStructuredItems<Risk>(
    readField(parsed, "risks"),
    segments,
    "risk"
  );

  const decisions = parseStructuredItems<Decision>(
    readField(parsed, "decisions"),
    segments,
    "decision"
  );

  const terminologySuggestions = parseStructuredItems<TerminologySuggestion>(
    readField(parsed, "terminology_suggestions", "terminologySuggestions"),
    segments,
    "term"
  );

  // Validate evidence and collect warnings instead of filtering
  const validation = validateAllEvidence(
    { actionItems, topics, risks, decisions, terminologySuggestions },
    segments
  );

  return {
    status: "ready",
    text: stringValue(readField(parsed, "summary", "text")),
    keywords: stringArray(readField(parsed, "keywords")),
    actionItems,
    topics,
    risks,
    decisions,
    terminologySuggestions,
    validation,
    updatedAt
  };
}

function formatSegmentForPrompt(segment: SessionRecordSegment) {
  return [
    `[片段ID: ${segment.id}]`,
    `[时间戳: ${formatPromptTimestamp(segment.startMs)}-${formatPromptTimestamp(segment.endMs)}]`,
    `原文：${segment.sourceEditedText ?? segment.sourceText}`,
    `译文：${segment.targetEditedText ?? segment.targetText}`
  ].join("\n");
}

function parseStructuredItems<T extends ActionItem | Topic | Risk | Decision | TerminologySuggestion>(
  value: unknown,
  segments: SessionRecordSegment[],
  idPrefix: string
): T[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item, index) => {
      const id = stringValue(readField(item, "id")) || `${idPrefix}-${index + 1}`;
      const confidence = numberValue(readField(item, "confidence"));
      const evidence = parseEvidenceAnchors(readField(item, "evidence"), segments);

      // Type-specific fields
      if (idPrefix === "action") {
        return {
          id,
          text: stringValue(readField(item, "text")),
          owner: stringValue(readField(item, "owner")),
          dueDate: stringValue(readField(item, "dueDate")),
          confidence,
          evidence
        } as T;
      } else if (idPrefix === "risk") {
        const severity = stringValue(readField(item, "severity"));
        return {
          id,
          text: stringValue(readField(item, "text")),
          severity: severity === "low" || severity === "medium" || severity === "high" ? severity : undefined,
          confidence,
          evidence
        } as T;
      } else if (idPrefix === "decision") {
        return {
          id,
          text: stringValue(readField(item, "text")),
          rationale: stringValue(readField(item, "rationale")),
          confidence,
          evidence
        } as T;
      } else if (idPrefix === "term") {
        return {
          id,
          sourceText: stringValue(readField(item, "sourceText")),
          targetText: stringValue(readField(item, "targetText")),
          context: stringValue(readField(item, "context")),
          confidence,
          evidence
        } as T;
      }

      // Default for topic
      return {
        id,
        text: stringValue(readField(item, "text")),
        confidence,
        evidence
      } as T;
    })
    .filter((item) => {
      if (idPrefix === "term") {
        const term = item as unknown as TerminologySuggestion;
        return term.sourceText.trim().length > 0 && term.targetText.trim().length > 0;
      }
      const withText = item as unknown as { text: string };
      return withText.text && withText.text.trim().length > 0;
    });
}

function parseEvidenceAnchors(value: unknown, segments: SessionRecordSegment[]): EvidenceAnchor[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      segmentId: stringValue(readField(item, "segmentId")),
      startMs: numberValue(readField(item, "startMs")),
      endMs: numberValue(readField(item, "endMs")),
      quote: stringValue(readField(item, "quote")),
      relevance: numberValue(readField(item, "relevance"))
    }))
    .filter((anchor) => anchor.segmentId && anchor.quote);
}

function validateAllEvidence(
  items: {
    actionItems: ActionItem[];
    topics: Topic[];
    risks: Risk[];
    decisions: Decision[];
    terminologySuggestions: TerminologySuggestion[];
  },
  segments: SessionRecordSegment[]
): SummaryValidation {
  const missingEvidenceItems: string[] = [];
  const invalidSegmentIds: string[] = [];
  const invalidQuotes: string[] = [];

  const allItems = [
    ...items.actionItems,
    ...items.topics,
    ...items.risks,
    ...items.decisions,
    ...items.terminologySuggestions
  ];

  for (const item of allItems) {
    const displayText = "text" in item ? item.text : `${item.sourceText} -> ${item.targetText}`;

    if (!item.evidence || item.evidence.length === 0) {
      missingEvidenceItems.push(displayText);
      continue;
    }

    for (const anchor of item.evidence) {
      const segment = segments.find((s) => s.id === anchor.segmentId);
      if (!segment) {
        invalidSegmentIds.push(`${displayText} -> ${anchor.segmentId}`);
        continue;
      }

      const sourceText = segment.sourceEditedText ?? segment.sourceText;
      const targetText = segment.targetEditedText ?? segment.targetText;
      const fullText = `${sourceText} ${targetText}`;

      if (!fullText.includes(anchor.quote)) {
        // Try fuzzy match with 90% similarity threshold
        if (!fuzzyMatch(fullText, anchor.quote, 0.9)) {
          invalidQuotes.push(`${displayText} -> "${anchor.quote}"`);
        }
      }
    }
  }

  const invalidItemCount = missingEvidenceItems.length + invalidSegmentIds.length + invalidQuotes.length;

  if (invalidItemCount > 0) {
    console.warn(
      `摘要校验发现 ${invalidItemCount} 个证据问题:\n` +
      `- 缺少证据: ${missingEvidenceItems.length}\n` +
      `- 无效片段ID: ${invalidSegmentIds.length}\n` +
      `- 引用不匹配: ${invalidQuotes.length}`
    );
  }

  return {
    valid: invalidItemCount === 0,
    invalidItemCount,
    missingEvidenceItems,
    invalidSegmentIds,
    invalidQuotes
  };
}

function validateEvidenceAnchors(
  item: ActionItem | Topic | Risk | Decision | TerminologySuggestion,
  segments: SessionRecordSegment[]
): boolean {
  const displayText = "text" in item ? item.text : `${item.sourceText} -> ${item.targetText}`;

  if (!item.evidence || item.evidence.length === 0) {
    console.warn(`摘要条目 "${displayText}" 缺少证据锚点`);
    return false;
  }

  for (const anchor of item.evidence) {
    const segment = segments.find((s) => s.id === anchor.segmentId);
    if (!segment) {
      console.warn(`摘要条目 "${displayText}" 引用不存在的片段 ID: ${anchor.segmentId}`);
      return false;
    }

    const sourceText = segment.sourceEditedText ?? segment.sourceText;
    const targetText = segment.targetEditedText ?? segment.targetText;
    const fullText = `${sourceText} ${targetText}`;

    if (!fullText.includes(anchor.quote)) {
      // Try fuzzy match with 90% similarity threshold
      if (!fuzzyMatch(fullText, anchor.quote, 0.9)) {
        console.warn(`摘要条目 "${displayText}" 的引用文本不匹配片段内容: "${anchor.quote}"`);
        return false;
      }
    }
  }

  return true;
}

function fuzzyMatch(text: string, pattern: string, threshold: number): boolean {
  const textNormalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const patternNormalized = pattern.toLowerCase().replace(/\s+/g, " ").trim();

  if (textNormalized.includes(patternNormalized)) {
    return true;
  }

  // Compute Levenshtein distance for similarity
  const distance = levenshteinDistance(textNormalized, patternNormalized);
  const maxLength = Math.max(textNormalized.length, patternNormalized.length);
  const similarity = 1 - distance / maxLength;

  return similarity >= threshold;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
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

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
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
