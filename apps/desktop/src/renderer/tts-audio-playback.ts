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
  skip: (event: Pick<TtsAudioEvent, "rev" | "segment_id">) => void;
  clear: () => void;
};

export type TtsAudioPlaybackQueueOptions = {
  createObjectUrl?: (blob: Blob) => string;
  createPlayer?: (url: string) => TtsAudioPlayer;
  createStreamingSession?: (mimeType: string) => TtsStreamingSession | null;
  logger?: TtsAudioPlaybackLogger;
  maxPendingItems?: number;
  now?: () => number;
  revokeObjectUrl?: (url: string) => void;
};

export type TtsAudioPlaybackLogger = {
  debug?: (message: string, data?: unknown) => void;
  info?: (message: string, data?: unknown) => void;
  warn?: (message: string, data?: unknown) => void;
};

export type TtsStreamingSession = {
  append: (chunk: ArrayBuffer, final: boolean) => Promise<void>;
  abort: () => void;
  onDone?: (callback: () => void) => void;
  start?: () => Promise<void>;
};

type PendingSegmentAudio = {
  chunks: Array<{ chunk: ArrayBuffer; final: boolean }>;
  event: TtsAudioEvent;
  final: boolean;
  mimeType: string;
};

type ActiveStreamingSegment = {
  key: string;
  release: () => void;
  session: TtsStreamingSession;
};

export function createTtsAudioPlaybackQueue({
  createObjectUrl = (blob) => URL.createObjectURL(blob),
  createPlayer = (url) => new Audio(url),
  createStreamingSession = createMediaSourceStreamingSession,
  logger,
  maxPendingItems = 12,
  now = defaultNow,
  revokeObjectUrl = (url) => URL.revokeObjectURL(url)
}: TtsAudioPlaybackQueueOptions = {}): TtsAudioPlaybackQueue {
  const pendingSegments = new Map<string, PendingSegmentAudio>();
  const preparedStreamingSegments = new Map<string, TtsStreamingSession>();
  const segmentOrder: string[] = [];
  let activeStreaming: ActiveStreamingSegment | null = null;
  let playing = false;
  let currentPlayer: TtsAudioPlayer | null = null;
  let currentBlobKey: string | null = null;
  let currentUrl: string | null = null;
  let lastPlaybackEndedAtMs: number | null = null;
  const unsupportedStreamingMimeTypes = new Set<string>();

  return {
    async enqueue(event) {
      const chunk = event.audio_base64 ? decodeBase64(event.audio_base64) : new ArrayBuffer(0);
      const key = `${event.segment_id}:${event.rev}`;
      const mimeType = event.mime_type || "audio/mpeg";
      if (activeStreaming?.key === key) {
        await activeStreaming.session.append(chunk, event.final);
        if (event.final && !activeStreaming.session.onDone) {
          activeStreaming.release();
        }
        return;
      }

      const pending = pendingSegments.get(key) ?? {
        chunks: [],
        event,
        final: false,
        mimeType
      };
      pending.event = event;
      pending.mimeType = mimeType;
      pending.final = pending.final || event.final;
      pending.chunks.push({ chunk, final: event.final });
      if (!pendingSegments.has(key)) {
        segmentOrder.push(key);
      }
      pendingSegments.set(key, pending);
      if (key !== activeStreaming?.key) {
        await prepareStreamingSegment(key, pending);
      }
      trimPendingQueue();
      await playNextSegment();
    },
    skip(event) {
      const key = `${event.segment_id}:${event.rev}`;
      if (activeStreaming?.key === key) {
        const active = activeStreaming;
        active.session.abort();
        active.release();
        return;
      }
      if (currentBlobKey === key) {
        currentPlayer?.pause?.();
        releaseCurrentBlob();
        return;
      }
      preparedStreamingSegments.get(key)?.abort();
      preparedStreamingSegments.delete(key);
      pendingSegments.delete(key);
      removeSegmentKey(key);
      if (!playing) {
        void playNextSegment();
      }
    },
    clear() {
      pendingSegments.clear();
      segmentOrder.splice(0);
      activeStreaming?.session.abort();
      activeStreaming = null;
      preparedStreamingSegments.forEach((session) => session.abort());
      preparedStreamingSegments.clear();
      playing = false;
      currentPlayer?.pause?.();
      if (currentPlayer && typeof currentPlayer.currentTime === "number") {
        currentPlayer.currentTime = 0;
      }
      currentPlayer = null;
      currentBlobKey = null;
      if (currentUrl) {
        revokeObjectUrl(currentUrl);
        currentUrl = null;
      }
    }
  };

  function trimPendingQueue() {
    if (segmentOrder.length <= maxPendingItems) {
      return;
    }
    const keepFrom = playing ? 1 : 0;
    const removeCount = Math.min(
      segmentOrder.length - maxPendingItems,
      Math.max(0, segmentOrder.length - keepFrom)
    );
    const removed = segmentOrder.splice(keepFrom, removeCount);
    removed.forEach((key) => {
      if (activeStreaming?.key !== key) {
        preparedStreamingSegments.get(key)?.abort();
        preparedStreamingSegments.delete(key);
        pendingSegments.delete(key);
      }
    });
  }

  async function playNextSegment() {
    if (playing) {
      return;
    }

    while (segmentOrder.length > 0) {
      const key = segmentOrder[0];
      const pending = pendingSegments.get(key);
      if (!pending) {
        segmentOrder.shift();
        continue;
      }

      const prepared = preparedStreamingSegments.get(key);
      const hasAudio = Boolean(prepared) || pending.chunks.some((item) => item.chunk.byteLength > 0);
      if (!hasAudio && !pending.final) {
        return;
      }
      if (!hasAudio && pending.final) {
        pendingSegments.delete(key);
        segmentOrder.shift();
        continue;
      }

      const streaming = prepared ?? createStreamingSession(pending.mimeType);
      if (streaming) {
        await playStreamingSegment(key, pending, streaming);
        return;
      }
      logStreamingUnsupported(pending.mimeType);

      if (!pending.final) {
        return;
      }

      const chunks = pending.chunks
        .filter((item) => item.chunk.byteLength > 0)
        .map((item) => item.chunk);
      const event = pending.event;
      pendingSegments.delete(key);
      segmentOrder.shift();
      await playBlob(key, event, new Blob(chunks, { type: pending.mimeType }));
      return;
    }
  }

  async function playStreamingSegment(
    key: string,
    pending: PendingSegmentAudio,
    session: TtsStreamingSession
  ) {
    playing = true;
    preparedStreamingSegments.delete(key);
    const event = pending.event;
    const release = () => {
      if (activeStreaming?.key !== key) {
        return;
      }
      markPlaybackFinished("stream", key, event);
      activeStreaming = null;
      pendingSegments.delete(key);
      if (segmentOrder[0] === key) {
        segmentOrder.shift();
      } else {
        removeSegmentKey(key);
      }
      playing = false;
      void playNextSegment();
    };
    activeStreaming = { key, release, session };
    session.onDone?.(release);

    const backlog = pending.chunks.splice(0);
    for (const item of backlog) {
      await session.append(item.chunk, item.final);
    }
    try {
      await session.start?.();
      markPlaybackStarted("stream", key, event);
    } catch (error) {
      logger?.warn?.("tts_playback_stream_failed", {
        ...segmentPlaybackLogData(key, pending, "stream"),
        error: errorMessage(error)
      });
      release();
      return;
    }
    if (pending.final && !session.onDone) {
      release();
    }
  }

  async function prepareStreamingSegment(key: string, pending: PendingSegmentAudio) {
    if (preparedStreamingSegments.has(key)) {
      await drainPendingToPreparedSession(key, pending);
      return;
    }

    const hasAudio = pending.chunks.some((item) => item.chunk.byteLength > 0);
    if (!hasAudio) {
      return;
    }

    const session = createStreamingSession(pending.mimeType);
    if (!session) {
      logStreamingUnsupported(pending.mimeType);
      return;
    }

    preparedStreamingSegments.set(key, session);
    session.onDone?.(() => {
      if (activeStreaming?.key === key) {
        return;
      }
      preparedStreamingSegments.delete(key);
      pendingSegments.delete(key);
      removeSegmentKey(key);
    });
    await drainPendingToPreparedSession(key, pending);
  }

  async function drainPendingToPreparedSession(key: string, pending: PendingSegmentAudio) {
    const session = preparedStreamingSegments.get(key);
    if (!session) {
      return;
    }
    const backlog = pending.chunks.splice(0);
    for (const item of backlog) {
      await session.append(item.chunk, item.final);
    }
  }

  async function playBlob(key: string, event: TtsAudioEvent, blob: Blob) {
    playing = true;
    const url = createObjectUrl(blob);
    currentUrl = url;
    currentBlobKey = key;
    const player = createPlayer(url);
    currentPlayer = player;
    const release = () => releaseCurrentBlob(url, key, event);
    player.onended = release;
    player.onerror = release;

    try {
      await player.play();
      markPlaybackStarted("blob", key, event, {
        mimeType: blob.type,
        sizeBytes: blob.size
      });
    } catch (error) {
      logger?.warn?.("tts_playback_blob_failed", {
        error: errorMessage(error),
        key,
        mimeType: blob.type,
        sizeBytes: blob.size
      });
      release();
    }
  }

  function releaseCurrentBlob(
    expectedUrl = currentUrl,
    expectedKey = currentBlobKey,
    event?: TtsAudioEvent
  ) {
    if (currentUrl !== expectedUrl || currentBlobKey !== expectedKey) {
      return;
    }
    if (expectedKey) {
      markPlaybackFinished("blob", expectedKey, event);
    }
    const url = currentUrl;
    currentUrl = null;
    currentBlobKey = null;
    currentPlayer = null;
    if (url) {
      revokeObjectUrl(url);
    }
    playing = false;
    void playNextSegment();
  }

  function markPlaybackStarted(
    mode: "blob" | "stream",
    key: string,
    event: TtsAudioEvent,
    extra: Record<string, unknown> = {}
  ) {
    const startedAt = now();
    const gapMs =
      lastPlaybackEndedAtMs === null ? 0 : Math.max(startedAt - lastPlaybackEndedAtMs, 0);
    lastPlaybackEndedAtMs = null;
    logger?.info?.("tts_playback_segment_started", {
      ...playbackQueueLogData(key, event, mode),
      gapMs: roundMetric(gapMs),
      ...extra
    });
  }

  function markPlaybackFinished(
    mode: "blob" | "stream",
    key: string,
    event?: TtsAudioEvent
  ) {
    lastPlaybackEndedAtMs = now();
    logger?.info?.("tts_playback_segment_finished", {
      ...playbackQueueLogData(key, event, mode)
    });
  }

  function playbackQueueLogData(
    key: string,
    event: Pick<TtsAudioEvent, "rev" | "segment_id" | "session_id"> | undefined,
    mode: "blob" | "stream"
  ) {
    return {
      key,
      mode,
      pendingItems: segmentOrder.length,
      preparedItems: preparedStreamingSegments.size,
      rev: event?.rev,
      segmentId: event?.segment_id,
      sessionId: event?.session_id
    };
  }

  function removeSegmentKey(key: string) {
    const index = segmentOrder.indexOf(key);
    if (index !== -1) {
      segmentOrder.splice(index, 1);
    }
  }

  function logStreamingUnsupported(mimeType: string) {
    if (unsupportedStreamingMimeTypes.has(mimeType)) {
      return;
    }
    unsupportedStreamingMimeTypes.add(mimeType);
    logger?.info?.("tts_playback_streaming_unsupported", { mimeType });
  }

  function segmentPlaybackLogData(
    key: string,
    pending: PendingSegmentAudio,
    mode: "stream"
  ) {
    return {
      audioBytes: pendingAudioBytes(pending),
      chunkCount: pending.chunks.length,
      final: pending.final,
      key,
      mimeType: pending.mimeType,
      mode,
      segmentId: pending.event.segment_id,
      sessionId: pending.event.session_id
    };
  }
}

function pendingAudioBytes(pending: PendingSegmentAudio) {
  return pending.chunks.reduce((sum, item) => sum + item.chunk.byteLength, 0);
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function roundMetric(value: number) {
  return Math.round(value * 10) / 10;
}

function createMediaSourceStreamingSession(mimeType: string): TtsStreamingSession | null {
  const MediaSourceCtor = globalThis.MediaSource;
  if (!MediaSourceCtor || !MediaSourceCtor.isTypeSupported(mimeType)) {
    return null;
  }

  const mediaSource = new MediaSourceCtor();
  const url = URL.createObjectURL(mediaSource);
  const player = new Audio(url);
  player.preload = "auto";
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
  player.load();

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
    },
    async start() {
      await player.play();
    }
  };
}
