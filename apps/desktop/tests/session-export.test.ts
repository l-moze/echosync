import { describe, expect, it } from "vitest";

import type { CaptionLine } from "../src/shared/caption-store";
import { cleanTranscriptLines, serializeTranscriptMarkdown, serializeTranscriptSrt } from "../src/shared/session-export";

const lines: CaptionLine[] = [
  {
    id: "seg_1",
    rev: 1,
    state: "locked",
    sourceText: "  Hello   world . ",
    targetText: "  你好   世界 。 ",
    stability: 1,
    startMs: 1234,
    endMs: 4567,
    patchCount: 0
  },
  {
    id: "seg_2",
    rev: 1,
    state: "stable",
    sourceText: "This is an agent.",
    targetText: "这是一个智能体。",
    stability: 0.9,
    startMs: 5000,
    endMs: 7300,
    patchCount: 1
  }
];

describe("会后转写清理与导出", () => {
  it("清理明显的多余空白和标点前空格", () => {
    const cleaned = cleanTranscriptLines(lines);

    expect(cleaned[0]?.sourceText).toBe("Hello world.");
    expect(cleaned[0]?.targetText).toBe("你好 世界。");
    expect(cleaned[1]).toEqual(lines[1]);
  });

  it("序列化为带时间戳的 Markdown", () => {
    const markdown = serializeTranscriptMarkdown(cleanTranscriptLines(lines));

    expect(markdown).toContain("# EchoSync Transcript");
    expect(markdown).toContain("## 00:01.234 - 00:04.567");
    expect(markdown).toContain("**原文** Hello world.");
    expect(markdown).toContain("**译文** 你好 世界。");
  });

  it("序列化为双语 SRT", () => {
    expect(serializeTranscriptSrt(cleanTranscriptLines(lines))).toBe(
      [
        "1",
        "00:00:01,234 --> 00:00:04,567",
        "你好 世界。",
        "Hello world.",
        "",
        "2",
        "00:00:05,000 --> 00:00:07,300",
        "这是一个智能体。",
        "This is an agent.",
        ""
      ].join("\n")
    );
  });
});
