import { describe, expect, it, vi } from "vitest";

import { createSessionRecorder, ensureSeekableSessionRecording } from "../src/renderer/session-recorder";

class FakeBlob {
  readonly parts: BlobPart[];
  readonly type: string;

  constructor(parts: BlobPart[], options?: BlobPropertyBag) {
    this.parts = parts;
    this.type = options?.type ?? "";
  }
}

class FakeMediaRecorder {
  static isTypeSupported(type: string) {
    return type === "audio/webm;codecs=opus";
  }

  readonly mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state: "inactive" | "recording" = "inactive";

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? "";
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

describe("会话原始音频录制器", () => {
  it("停止后返回连续原始音频 blob 和 MIME 类型", async () => {
    const recorder = createSessionRecorder({
      BlobCtor: FakeBlob as unknown as typeof Blob,
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder
    });

    recorder.start({} as MediaStream);
    const result = await recorder.stop();

    if (!result) {
      throw new Error("录音结果不能为空");
    }
    expect(result.mimeType).toBe("audio/webm;codecs=opus");
    expect(result.blob.type).toBe("audio/webm;codecs=opus");
  });

  it("停止后用真实会话时长补写 WebM duration，保证复盘点击可 seek", async () => {
    const originalBlob = new Blob(["audio"], { type: "audio/webm" });
    const fixedBlob = new Blob(["fixed-audio"], { type: "audio/webm" });
    const fixWebmDuration = vi.fn().mockResolvedValue(fixedBlob);

    const result = await ensureSeekableSessionRecording(
      { blob: originalBlob, mimeType: "audio/webm" },
      12_340,
      fixWebmDuration
    );

    expect(fixWebmDuration).toHaveBeenCalledWith(originalBlob, 12_340, { logger: false });
    expect(result).toEqual({ blob: fixedBlob, mimeType: "audio/webm" });
  });

  it("补写 WebM duration 时保留有效音频区间元数据", async () => {
    const originalBlob = new Blob(["audio"], { type: "audio/webm" });
    const fixedBlob = new Blob(["fixed-audio"], { type: "audio/webm" });

    const result = await ensureSeekableSessionRecording(
      {
        activityRanges: [
          { startMs: 0, endMs: 1200 },
          { startMs: 6200, endMs: 8000 }
        ],
        blob: originalBlob,
        mimeType: "audio/webm"
      },
      12_000,
      vi.fn().mockResolvedValue(fixedBlob)
    );

    expect(result?.activityRanges).toEqual([
      { startMs: 0, endMs: 1200 },
      { startMs: 6200, endMs: 8000 }
    ]);
  });

  it("按真实会话时长裁剪 Windows 系统声 PCM16 WAV，避免复盘保存长尾静音", async () => {
    const sourceWav = createPcm16Wav({
      durationMs: 5000,
      sampleRate: 16000
    });

    const result = await ensureSeekableSessionRecording(
      {
        activityRanges: [
          { startMs: 250, endMs: 900 },
          { startMs: 1200, endMs: 5000 }
        ],
        blob: new Blob([sourceWav], { type: "audio/wav" }),
        mimeType: "audio/wav"
      },
      1000,
      vi.fn()
    );

    const outputBuffer = result ? await result.blob.arrayBuffer() : new ArrayBuffer(0);
    const output = Buffer.from(outputBuffer);
    expect(output.length).toBe(44 + 16000 * 2);
    expect(output.toString("ascii", 0, 4)).toBe("RIFF");
    expect(output.readUInt32LE(4)).toBe(output.length - 8);
    expect(output.toString("ascii", 36, 40)).toBe("data");
    expect(output.readUInt32LE(40)).toBe(16000 * 2);
    expect(result?.activityRanges).toEqual([{ startMs: 250, endMs: 900 }]);
  });
});

function createPcm16Wav({
  durationMs,
  sampleRate
}: {
  durationMs: number;
  sampleRate: number;
}) {
  const bytesPerSample = 2;
  const samples = Math.round((sampleRate * durationMs) / 1000);
  const pcmBytes = samples * bytesPerSample;
  const wav = Buffer.alloc(44 + pcmBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + pcmBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * bytesPerSample, 28);
  wav.writeUInt16LE(bytesPerSample, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(pcmBytes, 40);
  return wav;
}
