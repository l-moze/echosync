import { describe, expect, it } from "vitest";

import {
  buildSessionSummaryPrompt,
  createOpenAiCompatibleSessionSummaryGenerator,
  parseSessionSummaryContent
} from "../src/main/session-summary-generator";
import type { SessionRecord } from "../src/shared/session-records";

describe("会议记录 AI 摘要生成器", () => {
  it("把完整双语片段写入摘要 prompt", () => {
    const prompt = buildSessionSummaryPrompt(recordFixture());

    expect(prompt).toContain("标题：实时同传评审");
    expect(prompt).toContain("[00:00-00:01]");
    expect(prompt).toContain("原文：We need lower latency.");
    expect(prompt).toContain("译文：我们需要更低延迟。");
    expect(prompt).toContain("[00:01-00:03]");
    expect(prompt).toContain("原文：The fallback path should show source text first.");
    expect(prompt).toContain("译文：备用链路应先显示原文。");
  });

  it("摘要 prompt 同时写入复盘时长和总录制时长", () => {
    const prompt = buildSessionSummaryPrompt({
      ...recordFixture(),
      timeline: {
        rawDurationMs: 180_000,
        contentDurationMs: 3_100,
        reviewDurationMs: 3_600,
        mode: "video",
        compressionEnabled: true,
        spans: [
          {
            kind: "content",
            rawStartMs: 0,
            rawEndMs: 3100,
            reviewStartMs: 0,
            reviewEndMs: 3100
          },
          {
            kind: "silence",
            rawStartMs: 3100,
            rawEndMs: 180_000,
            reviewStartMs: 3100,
            reviewEndMs: 3600
          }
        ]
      }
    });

    expect(prompt).toContain("复盘时长毫秒：3600");
    expect(prompt).toContain("总录制时长毫秒：180000");
    expect(prompt.split("\n")).not.toContain("时长毫秒：180000");
  });

  it("调用 OpenAI-compatible 接口并解析结构化摘要", async () => {
    const requests: Array<{ url: string; body: unknown; authorization?: string }> = [];
    const fetchFn = async (url: string, init: { body?: string; headers?: Record<string, string> }) => {
      requests.push({
        url,
        body: init.body ? JSON.parse(init.body) : null,
        authorization: init.headers?.Authorization
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "会议聚焦实时同传的低延迟和备用显示策略。",
                  keywords: ["低延迟", "备用链路"],
                  action_items: ["验证摘要生成链路"],
                  topics: ["实时同传"],
                  risks: ["模型响应慢"],
                  terminology_suggestions: ["fallback path：备用链路"]
                })
              }
            }
          ]
        })
      };
    };
    const generator = createOpenAiCompatibleSessionSummaryGenerator({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com/v1",
      fetchFn,
      model: "deepseek-chat",
      now: () => "2026-06-07T00:00:00.000Z"
    });

    const summary = await generator.generate(recordFixture());

    expect(requests[0]?.url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(requests[0]?.authorization).toBe("Bearer test-key");
    expect(requests[0]?.body).toMatchObject({
      model: "deepseek-chat",
      response_format: { type: "json_object" }
    });
    expect(summary).toEqual({
      status: "ready",
      text: "会议聚焦实时同传的低延迟和备用显示策略。",
      keywords: ["低延迟", "备用链路"],
      actionItems: ["验证摘要生成链路"],
      topics: ["实时同传"],
      risks: ["模型响应慢"],
      terminologySuggestions: ["fallback path：备用链路"],
      updatedAt: "2026-06-07T00:00:00.000Z"
    });
  });

  it("能解析被代码块包裹的 JSON 内容", () => {
    expect(
      parseSessionSummaryContent(
        "```json\n{\"summary\":\"复盘摘要\",\"keywords\":[\"字幕\"],\"action_items\":[],\"topics\":[],\"risks\":[],\"terminology_suggestions\":[]}\n```",
        "2026-06-07T00:00:00.000Z"
      )
    ).toMatchObject({
      status: "ready",
      text: "复盘摘要",
      keywords: ["字幕"]
    });
  });
});

function recordFixture(): SessionRecord {
  return {
    id: "record-summary",
    title: "实时同传评审",
    createdAt: "2026-06-07T08:00:00.000Z",
    startedAt: "2026-06-07T08:00:00.000Z",
    endedAt: "2026-06-07T08:03:00.000Z",
    durationMs: 180_000,
    sourceLang: "en",
    targetLang: "zh-CN",
    summary: {
      status: "pending",
      text: "",
      keywords: [],
      actionItems: [],
      topics: [],
      risks: [],
      terminologySuggestions: []
    },
    metadata: {
      averageCaptionLagMs: 830,
      patchCount: 1,
      segmentCount: 2,
      sourceCharCount: 72,
      targetCharCount: 22
    },
    segments: [
      {
        id: "seg_1",
        startMs: 0,
        endMs: 1200,
        sourceText: "We need lower latency.",
        targetText: "我们需要更低延迟。",
        revisionState: "final",
        patchCount: 0
      },
      {
        id: "seg_2",
        startMs: 1200,
        endMs: 3100,
        sourceText: "The fallback path should show source text first.",
        targetText: "备用链路应先显示原文。",
        revisionState: "final",
        patchCount: 1
      }
    ],
    updatedAt: "2026-06-07T08:03:01.000Z"
  };
}
