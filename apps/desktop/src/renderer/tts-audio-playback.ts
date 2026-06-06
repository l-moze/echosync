import type { TtsAudioEvent } from "../shared/realtime-events";

export type TtsAudioPlayer = {
  currentTime?: number;
  onended?: ((event: Event) => unknown) | null;
  onerror?: ((event: Event) => unknown) | null;
  pause?: () => void;
  play: () => Promise<void>;
};

export type TtsAudioPlaybackQueue = {
  enqueue: (event: TtsAudioEvent) => Promise<void>;
  clear: () => void;
};

export type TtsAudioPlaybackQueueOptions = {
  createObjectUrl?: (blob: Blob) => string;
  createPlayer?: (url: string) => TtsAudioPlayer;
  maxPendingItems?: number;
  revokeObjectUrl?: (url: string) => void;
};

type PendingSegmentAudio = {
  chunks: ArrayBuffer[];
  event: TtsAudioEvent;
};

type PlayItem = {
  blob: Blob;
};

export function createTtsAudioPlaybackQueue({
  createObjectUrl = (blob) => URL.createObjectURL(blob),
  createPlayer = (url) => new Audio(url),
  maxPendingItems = 4,
  revokeObjectUrl = (url) => URL.revokeObjectURL(url)
}: TtsAudioPlaybackQueueOptions = {}): TtsAudioPlaybackQueue {
  const pendingSegments = new Map<string, PendingSegmentAudio>();
  const playQueue: PlayItem[] = [];
  let playing = false;
  let currentPlayer: TtsAudioPlayer | null = null;
  let currentUrl: string | null = null;

  return {
    async enqueue(event) {
      if (!event.audio_base64) {
        return;
      }

      const key = `${event.segment_id}:${event.rev}`;
      const pending = pendingSegments.get(key) ?? {
        chunks: [],
        event
      };
      pending.event = event;
      pending.chunks.push(decodeBase64(event.audio_base64));
      pendingSegments.set(key, pending);

      if (!event.final) {
        return;
      }

      pendingSegments.delete(key);
      playQueue.push({
        blob: new Blob(pending.chunks, { type: event.mime_type || "audio/mpeg" })
      });
      trimPendingQueue();
      await playNext();
    },
    clear() {
      pendingSegments.clear();
      playQueue.splice(0);
      playing = false;
      currentPlayer?.pause?.();
      if (currentPlayer && typeof currentPlayer.currentTime === "number") {
        currentPlayer.currentTime = 0;
      }
      currentPlayer = null;
      if (currentUrl) {
        revokeObjectUrl(currentUrl);
        currentUrl = null;
      }
    }
  };

  function trimPendingQueue() {
    if (playQueue.length <= maxPendingItems) {
      return;
    }
    playQueue.splice(0, playQueue.length - maxPendingItems);
  }

  async function playNext() {
    if (playing) {
      return;
    }

    const next = playQueue.shift();
    if (!next) {
      return;
    }

    playing = true;
    const url = createObjectUrl(next.blob);
    currentUrl = url;
    const player = createPlayer(url);
    currentPlayer = player;
    const release = () => {
      if (currentUrl !== url) {
        return;
      }
      currentUrl = null;
      currentPlayer = null;
      revokeObjectUrl(url);
      playing = false;
      void playNext();
    };
    player.onended = release;
    player.onerror = release;

    try {
      await player.play();
    } catch {
      release();
    }
  }
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
