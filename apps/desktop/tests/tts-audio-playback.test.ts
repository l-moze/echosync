import { describe, expect, it, vi } from "vitest";

import { createTtsAudioPlaybackQueue } from "../src/renderer/tts-audio-playback";
import type { TtsAudioEvent } from "../src/shared/realtime-events";

describe("TTS 音频播放队列", () => {
  it("等待 final chunk 后拼接同一分段音频并播放", async () => {
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
      revokeObjectUrl: vi.fn()
    });

    await queue.enqueue(ttsEvent({ audio_base64: "aGVs", final: false }));
    await queue.enqueue(ttsEvent({ audio_base64: "bG8=", final: true }));

    expect(objectUrlSizes).toEqual([5]);
    expect(playedUrls).toEqual(["blob:5"]);
  });

  it("清空队列时丢弃尚未 final 的分段", async () => {
    const createObjectUrl = vi.fn((blob: Blob) => {
      void blob;
      return "blob:never";
    });
    const queue = createTtsAudioPlaybackQueue({
      createObjectUrl,
      createPlayer: () => ({
        play: vi.fn().mockResolvedValue(undefined)
      }),
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
      revokeObjectUrl
    });

    await queue.enqueue(ttsEvent({ audio_base64: "YXVkaW8=", final: true }));
    queue.clear();

    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(player.currentTime).toBe(0);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:playing");
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
