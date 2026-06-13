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
    expect(prompt).toContain("[时间戳: 00:00-00:01]");
    expect(prompt).toContain("原文：We need lower latency.");
    expect(prompt).toContain("译文：我们需要更低延迟。");
    expect(prompt).toContain("[时间戳: 00:01-00:03]");
    expect(prompt).toContain("原文：The fallback path should show source text first.");
    expect(prompt).toContain("译文：备用链路应先显示原文。");
    expect(prompt).toContain("[片段ID: seg_1]");
    expect(prompt).toContain("[片段ID: seg_2]");
  });

  it("摘要 prompt 同时写入复盘时长和总录制时长", () => {
    const prompt = buildSessionSummaryPrompt({
      ...recordFixture(),
      timeline: {
        rawDurationMs: 180_000,
        contentDurationMs: 3_100,
        reviewDurationMs: 3_600,
        sourceType: "video",
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
                  action_items: [
                    {
                      id: "action-1",
                      text: "验证摘要生成链路",
                      confidence: 0.9,
                      evidence: [
                        {
                          segmentId: "seg_1",
                          startMs: 0,
                          endMs: 1200,
                          quote: "We need lower latency.",
                          relevance: 0.95
                        }
                      ]
                    }
                  ],
                  topics: [
                    {
                      id: "topic-1",
                      text: "实时同传",
                      confidence: 0.85,
                      evidence: [
                        {
                          segmentId: "seg_2",
                          startMs: 1200,
                          endMs: 3100,
                          quote: "fallback path",
                          relevance: 0.9
                        }
                      ]
                    }
                  ],
                  risks: [
                    {
                      id: "risk-1",
                      text: "模型响应慢",
                      severity: "medium",
                      confidence: 0.8,
                      evidence: [
                        {
                          segmentId: "seg_1",
                          startMs: 0,
                          endMs: 1200,
                          quote: "lower latency",
                          relevance: 0.88
                        }
                      ]
                    }
                  ],
                  decisions: [],
                  terminology_suggestions: [
                    {
                      id: "term-1",
                      sourceText: "fallback path",
                      targetText: "备用链路",
                      confidence: 0.92,
                      evidence: [
                        {
                          segmentId: "seg_2",
                          startMs: 1200,
                          endMs: 3100,
                          quote: "fallback path",
                          relevance: 1.0
                        }
                      ]
                    }
                  ]
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
    expect(summary).toMatchObject({
      status: "ready",
      text: "会议聚焦实时同传的低延迟和备用显示策略。",
      keywords: ["低延迟", "备用链路"],
      actionItems: [
        {
          id: "action-1",
          text: "验证摘要生成链路",
          confidence: 0.9
        }
      ],
      topics: [
        {
          id: "topic-1",
          text: "实时同传",
          confidence: 0.85
        }
      ],
      risks: [
        {
          id: "risk-1",
          text: "模型响应慢",
          severity: "medium",
          confidence: 0.8
        }
      ],
      decisions: [],
      terminologySuggestions: [
        {
          id: "term-1",
          sourceText: "fallback path",
          targetText: "备用链路",
          confidence: 0.92
        }
      ],
      updatedAt: "2026-06-07T00:00:00.000Z"
    });
  });

  it("能解析被代码块包裹的 JSON 内容", () => {
    const segments = [
      {
        id: "seg_1",
        startMs: 0,
        endMs: 1000,
        sourceText: "Test content",
        targetText: "测试内容",
        revisionState: "final" as const,
        patchCount: 0
      }
    ];
    expect(
      parseSessionSummaryContent(
        "```json\n{\"summary\":\"复盘摘要\",\"keywords\":[\"字幕\"],\"action_items\":[],\"topics\":[],\"risks\":[],\"decisions\":[],\"terminology_suggestions\":[]}\n```",
        segments,
        "2026-06-07T00:00:00.000Z"
      )
    ).toMatchObject({
      status: "ready",
      text: "复盘摘要",
      keywords: ["字幕"]
    });
  });

  it("校验 evidence anchor 并过滤无效条目", () => {
    const segments = [
      {
        id: "seg_1",
        startMs: 0,
        endMs: 1000,
        sourceText: "We need lower latency",
        targetText: "我们需要更低延迟",
        revisionState: "final" as const,
        patchCount: 0
      }
    ];

    // Valid evidence
    const validContent = JSON.stringify({
      summary: "测试摘要",
      keywords: [],
      action_items: [
        {
          id: "action-1",
          text: "优化延迟",
          evidence: [
            {
              segmentId: "seg_1",
              startMs: 0,
              endMs: 1000,
              quote: "lower latency",
              relevance: 0.9
            }
          ]
        }
      ],
      topics: [],
      risks: [],
      decisions: [],
      terminology_suggestions: []
    });

    const result = parseSessionSummaryContent(validContent, segments, "2026-06-07T00:00:00.000Z");
    expect(result.actionItems).toHaveLength(1);
    expect(result.actionItems[0]?.evidence[0]?.quote).toBe("lower latency");
  });

  it("过滤缺少 evidence 的条目", () => {
    const segments = [
      {
        id: "seg_1",
        startMs: 0,
        endMs: 1000,
        sourceText: "Test",
        targetText: "测试",
        revisionState: "final" as const,
        patchCount: 0
      }
    ];

    const invalidContent = JSON.stringify({
      summary: "测试摘要",
      keywords: [],
      action_items: [
        {
          id: "action-1",
          text: "无证据条目",
          evidence: []
        }
      ],
      topics: [],
      risks: [],
      decisions: [],
      terminology_suggestions: []
    });

    const result = parseSessionSummaryContent(invalidContent, segments, "2026-06-07T00:00:00.000Z");
    expect(result.actionItems).toHaveLength(0);
  });

  it("过滤引用不存在 segmentId 的条目", () => {
    const segments = [
      {
        id: "seg_1",
        startMs: 0,
        endMs: 1000,
        sourceText: "Test",
        targetText: "测试",
        revisionState: "final" as const,
        patchCount: 0
      }
    ];

    const invalidContent = JSON.stringify({
      summary: "测试摘要",
      keywords: [],
      action_items: [
        {
          id: "action-1",
          text: "引用不存在片段",
          evidence: [
            {
              segmentId: "seg_999",
              startMs: 0,
              endMs: 1000,
              quote: "fake quote",
              relevance: 0.9
            }
          ]
        }
      ],
      topics: [],
      risks: [],
      decisions: [],
      terminology_suggestions: []
    });

    const result = parseSessionSummaryContent(invalidContent, segments, "2026-06-07T00:00:00.000Z");
    expect(result.actionItems).toHaveLength(0);
  });

  it("过滤 quote 不匹配片段内容的条目", () => {
    const segments = [
      {
        id: "seg_1",
        startMs: 0,
        endMs: 1000,
        sourceText: "We need lower latency",
        targetText: "我们需要更低延迟",
        revisionState: "final" as const,
        patchCount: 0
      }
    ];

    const invalidContent = JSON.stringify({
      summary: "测试摘要",
      keywords: [],
      action_items: [
        {
          id: "action-1",
          text: "编造引用",
          evidence: [
            {
              segmentId: "seg_1",
              startMs: 0,
              endMs: 1000,
              quote: "completely made up quote that does not exist",
              relevance: 0.9
            }
          ]
        }
      ],
      topics: [],
      risks: [],
      decisions: [],
      terminology_suggestions: []
    });

    const result = parseSessionSummaryContent(invalidContent, segments, "2026-06-07T00:00:00.000Z");
    expect(result.actionItems).toHaveLength(0);
  });

  it("支持模糊匹配 evidence quote", () => {
    const segments = [
      {
        id: "seg_1",
        startMs: 0,
        endMs: 1000,
        sourceText: "We need lower latency for real-time translation",
        targetText: "我们需要更低延迟的实时翻译",
        revisionState: "final" as const,
        patchCount: 0
      }
    ];

    // Slightly different but similar quote (90% threshold)
    const fuzzyContent = JSON.stringify({
      summary: "测试摘要",
      keywords: [],
      action_items: [
        {
          id: "action-1",
          text: "优化延迟",
          evidence: [
            {
              segmentId: "seg_1",
              startMs: 0,
              endMs: 1000,
              quote: "lower latency",
              relevance: 0.9
            }
          ]
        }
      ],
      topics: [],
      risks: [],
      decisions: [],
      terminology_suggestions: []
    });

    const result = parseSessionSummaryContent(fuzzyContent, segments, "2026-06-07T00:00:00.000Z");
    expect(result.actionItems).toHaveLength(1);
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
      decisions: [],
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
