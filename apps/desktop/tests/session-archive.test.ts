import { describe, expect, it } from "vitest";

import {
  buildSessionArchiveDraft,
  selectPlaybackSegmentId,
  sessionArchiveTitleFromDate
} from "../src/shared/session-archive";
import type { CaptionLine } from "../src/shared/caption-store";

const lines: CaptionLine[] = [
  {
    id: "seg_1",
    rev: 1,
    state: "locked",
    sourceText: "Hello world.",
    targetText: "你好，世界。",
    stability: 1,
    startMs: 0,
    endMs: 1200,
    patchCount: 0
  },
  {
    id: "seg_2",
    rev: 2,
    state: "revised",
    sourceText: "The model is fast.",
    targetText: "这个模型很快。",
    stability: 0.92,
    startMs: 1200,
    endMs: 2600,
    patchCount: 1
  }
];

describe("会话归档模型", () => {
  it("根据创建时间生成中文记录标题", () => {
    expect(sessionArchiveTitleFromDate(new Date("2026-06-05T15:20:00+08:00"))).toBe(
      "2026年06月05日_记录"
    );
  });

  it("根据播放时间选择当前片段", () => {
    expect(selectPlaybackSegmentId(lines, 300)).toBe("seg_1");
    expect(selectPlaybackSegmentId(lines, 1500)).toBe("seg_2");
    expect(selectPlaybackSegmentId(lines, 3000)).toBeNull();
  });

  it("构建包含音频和双语时间帧的归档草稿", () => {
    const audioBlob = new Blob(["demo"], { type: "audio/webm" });
    const draft = buildSessionArchiveDraft({
      id: "sess_demo",
      title: "2026年06月05日_记录",
      createdAt: "2026-06-05T07:20:00.000Z",
      durationMs: 2600,
      audioBlob,
      audioMimeType: "audio/webm",
      audioObjectUrl: "blob:audio-demo",
      lines
    });

    expect(draft.audio?.mimeType).toBe("audio/webm");
    expect(draft.audio?.objectUrl).toBe("blob:audio-demo");
    expect(draft.audio?.blob).toBe(audioBlob);
    expect(draft.segments).toEqual([
      {
        segmentId: "seg_1",
        startMs: 0,
        endMs: 1200,
        sourceText: "Hello world.",
        targetText: "你好，世界。",
        state: "locked",
        patchCount: 0
      },
      {
        segmentId: "seg_2",
        startMs: 1200,
        endMs: 2600,
        sourceText: "The model is fast.",
        targetText: "这个模型很快。",
        state: "revised",
        patchCount: 1
      }
    ]);
  });

  it("允许没有录音的文本归档草稿", () => {
    const draft = buildSessionArchiveDraft({
      id: "sess_text_only",
      title: "2026年06月05日_记录",
      createdAt: "2026-06-05T07:20:00.000Z",
      durationMs: 2600,
      lines
    });

    expect(draft.audio).toBeUndefined();
    expect(draft.segments).toHaveLength(2);
  });
});
