import { describe, expect, it, vi } from "vitest";

import { createTtsAudioPlaybackQueue } from "../src/renderer/tts-audio-playback";
import type { TtsAudioEvent } from "../src/shared/realtime-events";

describe("TTS 音频播放队列", () => {
  it("支持流式播放时收到首个非 final chunk 就立即追加", async () => {
    const appended: Array<{ size: number; final: boolean }> = [];
    const queue = createTtsAudioPlaybackQueue({
      createStreamingSession: () => ({
        append: vi.fn(async (chunk: ArrayBuffer, final: boolean) => {
          appended.push({ size: chunk.byteLength, final });
        }),
        abort: vi.fn()
      }),
      revokeObjectUrl: vi.fn()
    });

    await queue.enqueue(ttsEvent({ audio_base64: "aGVs", final: false }));
    await queue.enqueue(ttsEvent({ audio_base64: "bG8=", final: true }));

    expect(appended).toEqual([
      { size: 3, final: false },
      { size: 2, final: true }
    ]);
  });

  it("支持空音频占位锁定顺序，后续音频到达后再开始播放", async () => {
    const sessions: Array<{
      appended: Array<{ final: boolean; size: number }>;
      start: ReturnType<typeof vi.fn<() => Promise<void>>>;
    }> = [];
    const queue = createTtsAudioPlaybackQueue({
      createStreamingSession: () => {
        const session = {
          appended: [] as Array<{ final: boolean; size: number }>,
          start: vi.fn<() => Promise<void>>(async () => undefined)
        };
        sessions.push(session);
        return {
          append: vi.fn(async (chunk: ArrayBuffer, final: boolean) => {
            session.appended.push({ size: chunk.byteLength, final });
          }),
          abort: vi.fn(),
          start: session.start
        };
      },
      revokeObjectUrl: vi.fn()
    });

    await queue.enqueue(ttsEvent({ audio_base64: "", final: false, segment_id: "seg_one" }));

    expect(sessions).toHaveLength(0);

    await queue.enqueue(ttsEvent({ audio_base64: "b25l", final: false, segment_id: "seg_one" }));

    expect(sessions).toHaveLength(1);
    expect(sessions[0].appended).toEqual([
      { size: 0, final: false },
      { size: 3, final: false }
    ]);
    expect(sessions[0].start).toHaveBeenCalledTimes(1);
  });

  it("支持流式播放时用空 final 包结束当前分段", async () => {
    const appended: Array<{ size: number; final: boolean }> = [];
    const queue = createTtsAudioPlaybackQueue({
      createStreamingSession: () => ({
        append: vi.fn(async (chunk: ArrayBuffer, final: boolean) => {
          appended.push({ size: chunk.byteLength, final });
        }),
        abort: vi.fn()
      }),
      revokeObjectUrl: vi.fn()
    });

    await queue.enqueue(ttsEvent({ audio_base64: "aGVs", final: false }));
    await queue.enqueue(ttsEvent({ audio_base64: "bG8=", final: false }));
    await queue.enqueue(ttsEvent({ audio_base64: "", final: true }));

    expect(appended).toEqual([
      { size: 3, final: false },
      { size: 2, final: false },
      { size: 0, final: true }
    ]);
  });

  it("支持流式播放时后一个分段必须等待前一个分段结束，避免抢话", async () => {
    const sessions: Array<{
      appended: Array<{ final: boolean; size: number }>;
      done?: () => void;
      start: ReturnType<typeof vi.fn<() => Promise<void>>>;
    }> = [];
    const queue = createTtsAudioPlaybackQueue({
      createStreamingSession: () => {
        const session: {
          appended: Array<{ final: boolean; size: number }>;
          done?: () => void;
          start: ReturnType<typeof vi.fn<() => Promise<void>>>;
        } = { appended: [], start: vi.fn<() => Promise<void>>(async () => undefined) };
        sessions.push(session);
        return {
          append: vi.fn(async (chunk: ArrayBuffer, final: boolean) => {
            session.appended.push({ size: chunk.byteLength, final });
          }),
          abort: vi.fn(),
          onDone(callback: () => void) {
            session.done = callback;
          },
          start: session.start
        };
      },
      revokeObjectUrl: vi.fn()
    });

    await queue.enqueue(ttsEvent({ audio_base64: "b25l", final: false, segment_id: "seg_one" }));
    await queue.enqueue(ttsEvent({ audio_base64: "dHdv", final: false, segment_id: "seg_two" }));

    expect(sessions).toHaveLength(2);
    expect(sessions[0].appended).toEqual([{ size: 3, final: false }]);
    expect(sessions[0].start).toHaveBeenCalledTimes(1);
    expect(sessions[1].appended).toEqual([{ size: 3, final: false }]);
    expect(sessions[1].start).not.toHaveBeenCalled();

    await queue.enqueue(ttsEvent({ audio_base64: "", final: true, segment_id: "seg_one" }));
    expect(sessions).toHaveLength(2);
    expect(sessions[0].appended).toEqual([
      { size: 3, final: false },
      { size: 0, final: true }
    ]);

    sessions[0].done?.();
    await Promise.resolve();

    expect(sessions).toHaveLength(2);
    expect(sessions[1].appended).toEqual([{ size: 3, final: false }]);
    expect(sessions[1].start).toHaveBeenCalledTimes(1);
  });

  it("TTS 失败时跳过对应占位，继续播放后续分段", async () => {
    const sessions: Array<{
      appended: Array<{ final: boolean; size: number }>;
      start: ReturnType<typeof vi.fn<() => Promise<void>>>;
    }> = [];
    const queue = createTtsAudioPlaybackQueue({
      createStreamingSession: () => {
        const session = {
          appended: [] as Array<{ final: boolean; size: number }>,
          start: vi.fn<() => Promise<void>>(async () => undefined)
        };
        sessions.push(session);
        return {
          append: vi.fn(async (chunk: ArrayBuffer, final: boolean) => {
            session.appended.push({ size: chunk.byteLength, final });
          }),
          abort: vi.fn(),
          start: session.start
        };
      },
      revokeObjectUrl: vi.fn()
    });

    await queue.enqueue(ttsEvent({ audio_base64: "", final: false, segment_id: "seg_failed" }));
    await queue.enqueue(ttsEvent({ audio_base64: "b2s=", final: false, segment_id: "seg_next" }));

    expect(sessions).toHaveLength(1);
    expect(sessions[0].appended).toEqual([{ size: 2, final: false }]);
    expect(sessions[0].start).not.toHaveBeenCalled();

    queue.skip({ segment_id: "seg_failed", rev: 1 });
    await Promise.resolve();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].appended).toEqual([{ size: 2, final: false }]);
    expect(sessions[0].start).toHaveBeenCalledTimes(1);
  });


  it("不支持流式播放时等待空 final 包后拼接同一分段音频并播放", async () => {
    const playedUrls: string[] = [];
    const objectUrlSizes: number[] = [];
    const queue = createTtsAudioPlaybackQueue({
      createObjectUrl(blob) {
        objectUrlSizes.push(blob.size);
        return `blob:${blob.size}`;
      },
      createPlayer(url) {
        playedUrls.push(url);
        return {
          play: vi.fn().mockResolvedValue(undefined)
        };
      },
      createStreamingSession: () => null,
      revokeObjectUrl: vi.fn()
    });

    await queue.enqueue(ttsEvent({ audio_base64: "aGVs", final: false }));
    await queue.enqueue(ttsEvent({ audio_base64: "bG8=", final: false }));
    await queue.enqueue(ttsEvent({ audio_base64: "", final: true }));

    expect(objectUrlSizes).toEqual([5]);
    expect(playedUrls).toEqual(["blob:5"]);
  });

  it("清空队列时丢弃尚未 final 的兜底分段", async () => {
    const createObjectUrl = vi.fn((blob: Blob) => {
      void blob;
      return "blob:pending";
    });
    const queue = createTtsAudioPlaybackQueue({
      createObjectUrl,
      createPlayer: () => ({
        play: vi.fn().mockResolvedValue(undefined)
      }),
      createStreamingSession: () => null,
      revokeObjectUrl: vi.fn()
    });

    await queue.enqueue(ttsEvent({ audio_base64: "aGVs", final: false }));
    queue.clear();
    await queue.enqueue(ttsEvent({ audio_base64: "bG8=", final: true }));

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(createObjectUrl.mock.calls[0][0].size).toBe(2);
  });

  it("清空队列时暂停当前正在播放的音频", async () => {
    const player = {
      currentTime: 4,
      onended: null,
      onerror: null,
      pause: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined)
    };
    const revokeObjectUrl = vi.fn();
    const queue = createTtsAudioPlaybackQueue({
      createObjectUrl: () => "blob:playing",
      createPlayer: () => player,
      createStreamingSession: () => null,
      revokeObjectUrl
    });

    await queue.enqueue(ttsEvent({ audio_base64: "YXVkaW8=", final: true }));
    queue.clear();

    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(player.currentTime).toBe(0);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:playing");
  });

  it("记录浏览器拒绝播放 TTS Blob 的错误，避免无声失败", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn()
    };
    const queue = createTtsAudioPlaybackQueue({
      createObjectUrl: (blob) => `blob:${blob.size}`,
      createPlayer: () => ({
        play: vi.fn().mockRejectedValue(new Error("NotAllowedError"))
      }),
      createStreamingSession: () => null,
      logger,
      revokeObjectUrl: vi.fn()
    });

    await queue.enqueue(ttsEvent({ audio_base64: "YXVkaW8=", final: true }));

    expect(logger.info).toHaveBeenCalledWith("tts_playback_streaming_unsupported", {
      mimeType: "audio/mpeg"
    });
    expect(logger.info).toHaveBeenCalledWith("tts_playback_segment_finished", {
      key: "seg_tts:1",
      mode: "blob",
      pendingItems: 0,
      preparedItems: 0,
      rev: 1,
      segmentId: "seg_tts",
      sessionId: "sess_tts"
    });
    expect(logger.info).not.toHaveBeenCalledWith(
      "tts_playback_segment_started",
      expect.anything()
    );
    expect(logger.warn).toHaveBeenCalledWith("tts_playback_blob_failed", {
      error: "NotAllowedError",
      key: "seg_tts:1",
      mimeType: "audio/mpeg",
      sizeBytes: 5
    });
  });

  it("记录相邻 TTS 分段真实播放间隔，便于定位空档", async () => {
    let clock = 100;
    const logger = {
      info: vi.fn(),
      warn: vi.fn()
    };
    const players: Array<{
      onended?: ((event: Event) => unknown) | null;
      onerror?: ((event: Event) => unknown) | null;
      play: () => Promise<void>;
    }> = [];
    const queue = createTtsAudioPlaybackQueue({
      createObjectUrl: (blob) => `blob:${blob.size}:${players.length}`,
      createPlayer() {
        const player = {
          onended: null,
          onerror: null,
          play: vi.fn().mockResolvedValue(undefined)
        };
        players.push(player);
        return player;
      },
      createStreamingSession: () => null,
      logger,
      now: () => clock,
      revokeObjectUrl: vi.fn()
    });

    await queue.enqueue(ttsEvent({ audio_base64: "b25l", final: true, segment_id: "seg_one" }));
    clock = 220;
    players[0].onended?.(new Event("ended"));
    clock = 275;
    await queue.enqueue(ttsEvent({ audio_base64: "dHdv", final: true, segment_id: "seg_two" }));

    expect(logger.info).toHaveBeenCalledWith(
      "tts_playback_segment_started",
      expect.objectContaining({
        gapMs: 0,
        key: "seg_one:1",
        mode: "blob"
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "tts_playback_segment_started",
      expect.objectContaining({
        gapMs: 55,
        key: "seg_two:1",
        mode: "blob"
      })
    );
  });

  it("忽略 clear 之前播放器的晚到结束回调，避免新队列并发播放", async () => {
    const players: Array<{
      onended?: ((event: Event) => unknown) | null;
      onerror?: ((event: Event) => unknown) | null;
      play: () => Promise<void>;
      url: string;
    }> = [];
    const queue = createTtsAudioPlaybackQueue({
      createObjectUrl: (blob) => `blob:${blob.size}:${players.length}`,
      createStreamingSession: () => null,
      createPlayer(url) {
        const player = {
          onended: null,
          onerror: null,
          play: vi.fn().mockResolvedValue(undefined),
          url
        };
        players.push(player);
        return player;
      },
      revokeObjectUrl: vi.fn()
    });

    await queue.enqueue(ttsEvent({ audio_base64: "b25l", final: true }));
    queue.clear();
    await queue.enqueue(ttsEvent({ audio_base64: "dHdv", final: true, rev: 2 }));
    await queue.enqueue(ttsEvent({ audio_base64: "dGhyZWU=", final: true, rev: 3 }));

    expect(players).toHaveLength(2);

    players[0].onended?.(new Event("ended"));

    expect(players).toHaveLength(2);
    players[1].onended?.(new Event("ended"));
    expect(players).toHaveLength(3);
  });
});

function ttsEvent(overrides: Partial<TtsAudioEvent>): TtsAudioEvent {
  return {
    type: "tts.audio",
    session_id: "sess_tts",
    segment_id: "seg_tts",
    rev: 1,
    start_ms: 0,
    end_ms: 1200,
    target_lang: "zh-CN",
    audio_base64: "",
    mime_type: "audio/mpeg",
    sample_rate: null,
    final: false,
    ...overrides
  };
}
