export type SessionRecording = {
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

function selectMimeType(MediaRecorderCtor: typeof MediaRecorder) {
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorderCtor.isTypeSupported(type)) ?? "";
}
