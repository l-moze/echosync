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
  createStreamingSession?: (mimeType: string) => TtsStreamingSession | null;
  maxPendingItems?: number;
  revokeObjectUrl?: (url: string) => void;
};

export type TtsStreamingSession = {
  append: (chunk: ArrayBuffer, final: boolean) => Promise<void>;
  abort: () => void;
  onDone?: (callback: () => void) => void;
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
  createStreamingSession = createMediaSourceStreamingSession,
  maxPendingItems = 4,
  revokeObjectUrl = (url) => URL.revokeObjectURL(url)
}: TtsAudioPlaybackQueueOptions = {}): TtsAudioPlaybackQueue {
  const pendingSegments = new Map<string, PendingSegmentAudio>();
  const streamingSegments = new Map<string, TtsStreamingSession>();
  const playQueue: PlayItem[] = [];
  let playing = false;
  let currentPlayer: TtsAudioPlayer | null = null;
  let currentUrl: string | null = null;

  return {
    async enqueue(event) {
      if (!event.audio_base64 && !event.final) {
        return;
      }

      const chunk = event.audio_base64 ? decodeBase64(event.audio_base64) : new ArrayBuffer(0);
      const key = `${event.segment_id}:${event.rev}`;
      const mimeType = event.mime_type || "audio/mpeg";
      const existingStreaming = streamingSegments.get(key);
      const streaming = existingStreaming ?? (
        chunk.byteLength > 0 ? createStreamingSession(mimeType) : null
      );
      if (streaming) {
        if (!existingStreaming) {
          streamingSegments.set(key, streaming);
          streaming.onDone?.(() => streamingSegments.delete(key));
        }
        await streaming.append(chunk, event.final);
        if (event.final && !streaming.onDone) {
          streamingSegments.delete(key);
        }
        return;
      }

      if (chunk.byteLength === 0 && !pendingSegments.has(key)) {
        return;
      }

      const pending = pendingSegments.get(key) ?? {
        chunks: [],
        event
      };
      pending.event = event;
      if (chunk.byteLength > 0) {
        pending.chunks.push(chunk);
      }
      pendingSegments.set(key, pending);

      if (!event.final) {
        return;
      }

      pendingSegments.delete(key);
      if (pending.chunks.length === 0) {
        return;
      }
      playQueue.push({
        blob: new Blob(pending.chunks, { type: mimeType })
      });
      trimPendingQueue();
      await playNext();
    },
    clear() {
      pendingSegments.clear();
      streamingSegments.forEach((session) => session.abort());
      streamingSegments.clear();
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

function createMediaSourceStreamingSession(mimeType: string): TtsStreamingSession | null {
  const MediaSourceCtor = globalThis.MediaSource;
  if (!MediaSourceCtor || !MediaSourceCtor.isTypeSupported(mimeType)) {
    return null;
  }

  const mediaSource = new MediaSourceCtor();
  const url = URL.createObjectURL(mediaSource);
  const player = new Audio(url);
  const chunks: Array<{ chunk: ArrayBuffer; final: boolean }> = [];
  const doneCallbacks: Array<() => void> = [];
  let sourceBuffer: SourceBuffer | null = null;
  let aborted = false;
  let released = false;
  let finalReceived = false;

  const release = () => {
    if (released) {
      return;
    }
    released = true;
    URL.revokeObjectURL(url);
    doneCallbacks.splice(0).forEach((callback) => callback());
  };

  const maybeEndStream = () => {
    if (
      aborted ||
      !finalReceived ||
      chunks.length > 0 ||
      !sourceBuffer ||
      sourceBuffer.updating ||
      mediaSource.readyState !== "open"
    ) {
      return;
    }
    mediaSource.endOfStream();
  };

  const flush = () => {
    if (aborted || !sourceBuffer || sourceBuffer.updating) {
      return;
    }
    const next = chunks.shift();
    if (!next) {
      maybeEndStream();
      return;
    }
    if (next.final) {
      finalReceived = true;
    }
    if (next.chunk.byteLength === 0) {
      maybeEndStream();
      return;
    }
    sourceBuffer.appendBuffer(next.chunk);
  };

  mediaSource.addEventListener(
    "sourceopen",
    () => {
      if (aborted) {
        return;
      }
      sourceBuffer = mediaSource.addSourceBuffer(mimeType);
      sourceBuffer.addEventListener("updateend", flush);
      flush();
    },
    { once: true }
  );
  player.addEventListener("ended", release, { once: true });
  player.addEventListener("error", release, { once: true });
  player.play().catch(() => undefined);

  return {
    async append(chunk, final) {
      chunks.push({ chunk, final });
      flush();
    },
    abort() {
      aborted = true;
      player.pause();
      release();
    },
    onDone(callback) {
      if (released) {
        callback();
        return;
      }
      doneCallbacks.push(callback);
    }
  };
}
