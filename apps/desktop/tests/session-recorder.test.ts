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
});
