import fixWebmDuration, { type FixWebmDurationFunction } from "fix-webm-duration";

export type SessionRecording = {
  activityRanges?: Array<{
    startMs: number;
    endMs: number;
  }>;
  blob: Blob;
  mimeType: string;
};

export type SessionRecorder = {
  start: (stream: MediaStream) => void;
  stop: () => Promise<SessionRecording | null>;
  discard: () => void;
};

export type SessionRecorderDeps = {
  BlobCtor?: typeof Blob;
  MediaRecorderCtor?: typeof MediaRecorder;
};

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus"
];

export function createSessionRecorder({
  BlobCtor = Blob,
  MediaRecorderCtor
}: SessionRecorderDeps = {}): SessionRecorder {
  let recorder: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];
  let mimeType = "";

  return {
    start(stream) {
      const ResolvedMediaRecorder = MediaRecorderCtor ?? globalThis.MediaRecorder;
      if (!ResolvedMediaRecorder) {
        return;
      }
      chunks = [];
      mimeType = selectMimeType(ResolvedMediaRecorder);
      recorder = new ResolvedMediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mimeType = recorder.mimeType || mimeType || "audio/webm";
      recorder.ondataavailable = (event) => {
        if (event.data.size === undefined || event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.start();
    },
    stop() {
      if (!recorder) {
        return Promise.resolve(null);
      }
      const activeRecorder = recorder;
      recorder = null;
      return new Promise((resolve) => {
        activeRecorder.onstop = () => {
          const blob = new BlobCtor(chunks, { type: mimeType });
          chunks = [];
          resolve({ blob, mimeType });
        };
        if (activeRecorder.state === "inactive") {
          activeRecorder.onstop?.(new Event("stop"));
          return;
        }
        activeRecorder.stop();
      });
    },
    discard() {
      chunks = [];
      if (recorder?.state !== "inactive") {
        recorder?.stop();
      }
      recorder = null;
    }
  };
}

export async function ensureSeekableSessionRecording(
  recording: SessionRecording | null | undefined,
  durationMs: number,
  fixDuration: FixWebmDurationFunction = fixWebmDuration
): Promise<SessionRecording | null> {
  if (!recording) {
    return null;
  }
  const normalizedDurationMs = Math.max(1, Math.round(durationMs));
  if (!Number.isFinite(normalizedDurationMs) || recording.blob.size <= 0) {
    return recording;
  }
  if (isPcm16WavRecording(recording)) {
    return trimPcm16WavRecording(recording, normalizedDurationMs);
  }
  if (!isWebmRecording(recording)) {
    return {
      blob: recording.blob,
      mimeType: recording.mimeType,
      ...activityRangesRecord(clipActivityRanges(recording.activityRanges, normalizedDurationMs))
    };
  }
  try {
    const fixedBlob = await fixDuration(recording.blob, normalizedDurationMs, { logger: false });
    return {
      blob: fixedBlob,
      mimeType: fixedBlob.type || recording.mimeType,
      ...activityRangesRecord(clipActivityRanges(recording.activityRanges, normalizedDurationMs))
    };
  } catch {
    return recording;
  }
}

function selectMimeType(MediaRecorderCtor: typeof MediaRecorder) {
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorderCtor.isTypeSupported(type)) ?? "";
}

function isWebmRecording(recording: SessionRecording) {
  return recording.mimeType.includes("webm") || recording.blob.type.includes("webm");
}

function isPcm16WavRecording(recording: SessionRecording) {
  const mimeType = `${recording.mimeType} ${recording.blob.type}`.toLowerCase();
  return mimeType.includes("wav") || mimeType.includes("wave");
}

async function trimPcm16WavRecording(
  recording: SessionRecording,
  durationMs: number
): Promise<SessionRecording> {
  const sourceBuffer = await recording.blob.arrayBuffer();
  const wav = parsePcm16Wav(sourceBuffer);
  if (!wav) {
    return {
      blob: recording.blob,
      mimeType: recording.mimeType,
      ...activityRangesRecord(clipActivityRanges(recording.activityRanges, durationMs))
    };
  }

  const targetBytes = alignToBlock(
    Math.floor((durationMs * wav.byteRate) / 1000),
    wav.blockAlign
  );
  const clippedBytes = Math.min(wav.dataBytes, Math.max(0, targetBytes));
  if (clippedBytes >= wav.dataBytes) {
    return {
      blob: recording.blob,
      mimeType: recording.mimeType,
      ...activityRangesRecord(clipActivityRanges(recording.activityRanges, durationMs))
    };
  }

  const nextBuffer = sourceBuffer.slice(0, wav.dataOffset + clippedBytes);
  const view = new DataView(nextBuffer);
  view.setUint32(4, nextBuffer.byteLength - 8, true);
  view.setUint32(wav.dataSizeOffset, clippedBytes, true);
  const blob = new Blob([nextBuffer], { type: recording.mimeType || recording.blob.type || "audio/wav" });
  return {
    blob,
    mimeType: blob.type || recording.mimeType,
    ...activityRangesRecord(clipActivityRanges(recording.activityRanges, durationMs))
  };
}

function parsePcm16Wav(buffer: ArrayBuffer) {
  if (buffer.byteLength < 44) {
    return null;
  }
  const view = new DataView(buffer);
  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
    return null;
  }

  let offset = 12;
  let byteRate = 0;
  let blockAlign = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  while (offset + 8 <= buffer.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const payloadOffset = offset + 8;
    if (payloadOffset + chunkSize > buffer.byteLength) {
      return null;
    }

    if (chunkId === "fmt " && chunkSize >= 16) {
      audioFormat = view.getUint16(payloadOffset, true);
      byteRate = view.getUint32(payloadOffset + 8, true);
      blockAlign = view.getUint16(payloadOffset + 12, true);
      bitsPerSample = view.getUint16(payloadOffset + 14, true);
    }

    if (chunkId === "data") {
      if (audioFormat !== 1 || bitsPerSample !== 16 || byteRate <= 0 || blockAlign <= 0) {
        return null;
      }
      return {
        blockAlign,
        byteRate,
        dataBytes: chunkSize,
        dataOffset: payloadOffset,
        dataSizeOffset: offset + 4
      };
    }

    offset = payloadOffset + chunkSize + (chunkSize % 2);
  }
  return null;
}

function alignToBlock(bytes: number, blockAlign: number) {
  if (blockAlign <= 1) {
    return bytes;
  }
  return bytes - (bytes % blockAlign);
}

function readAscii(view: DataView, offset: number, length: number) {
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index));
  }
  return text;
}

function clipActivityRanges(
  ranges: SessionRecording["activityRanges"],
  durationMs: number
): SessionRecording["activityRanges"] {
  if (!ranges || ranges.length === 0) {
    return ranges;
  }
  const clipped = ranges
    .map((range) => ({
      endMs: Math.min(Math.max(0, Math.round(range.endMs)), durationMs),
      startMs: Math.min(Math.max(0, Math.round(range.startMs)), durationMs)
    }))
    .filter((range) => range.endMs > range.startMs);
  return clipped.length > 0 ? clipped : undefined;
}

function activityRangesRecord(ranges: SessionRecording["activityRanges"]) {
  return ranges ? { activityRanges: ranges } : {};
}
