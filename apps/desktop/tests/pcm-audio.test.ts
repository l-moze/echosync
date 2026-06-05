import { describe, expect, it } from "vitest";

import {
  AUDIO_FRAME_HEADER_BYTES,
  AUDIO_FRAME_MAGIC,
  createAudioChunkMessage,
  createPcm16BinaryFrame,
  floatToPcm16,
  pcm16ToBase64
} from "../src/renderer/pcm-audio";

describe("renderer pcm audio helpers", () => {
  it("converts mono float samples to little-endian PCM16", () => {
    const pcm = floatToPcm16(new Float32Array([-1, -0.5, 0, 0.5, 1]));
    const view = new DataView(pcm.buffer);

    expect(view.getInt16(0, true)).toBe(-32768);
    expect(view.getInt16(2, true)).toBe(-16384);
    expect(view.getInt16(4, true)).toBe(0);
    expect(view.getInt16(6, true)).toBe(16383);
    expect(view.getInt16(8, true)).toBe(32767);
  });

  it("encodes PCM chunks into the realtime websocket envelope", () => {
    const pcm = new Uint8Array([72, 105]);
    const message = createAudioChunkMessage({
      seq: 7,
      pcm,
      sampleRate: 16000,
      channels: 1,
      startMs: 320,
      endMs: 640,
      sourceLang: "en",
      sourceKind: "windows_system",
      deviceId: "loopback"
    });

    expect(message).toEqual({
      type: "audio.chunk",
      seq: 7,
      sample_rate: 16000,
      channels: 1,
      start_ms: 320,
      end_ms: 640,
      source_lang: "en",
      source_kind: "windows_system",
      device_id: "loopback",
      pcm_base64: "SGk="
    });
    expect(pcm16ToBase64(pcm)).toBe("SGk=");
  });

  it("encodes PCM chunks into the binary realtime audio frame", () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    const frame = createPcm16BinaryFrame({
      endMs: 80,
      isFinal: true,
      pcm,
      sentAtMs: 123456789,
      seq: 42,
      startMs: 0
    });
    const view = new DataView(frame);

    expect(frame.byteLength).toBe(AUDIO_FRAME_HEADER_BYTES + pcm.byteLength);
    expect(view.getUint32(0, true)).toBe(AUDIO_FRAME_MAGIC);
    expect(view.getUint16(4, true)).toBe(1);
    expect(view.getUint16(6, true)).toBe(1);
    expect(view.getUint32(8, true)).toBe(42);
    expect(view.getUint32(12, true)).toBe(0);
    expect(view.getUint32(16, true)).toBe(80);
    expect(view.getUint32(20, true)).toBe(123456789);
    expect(Array.from(new Uint8Array(frame, AUDIO_FRAME_HEADER_BYTES))).toEqual([1, 2, 3, 4]);
  });
});
