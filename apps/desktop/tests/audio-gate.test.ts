import { describe, expect, it } from "vitest";

import { calculateAudioLevel, createAudioGate } from "../src/renderer/audio-gate";

describe("renderer audio gate", () => {
  it("drops continuous silence and avoids sending empty audio chunks", () => {
    const gate = createAudioGate({ sampleRate: 16000, chunkMs: 100, silenceMs: 300 });

    const chunks = gate.push(new Float32Array(1600 * 5));

    expect(chunks).toEqual([]);
  });

  it("starts on loud audio and marks the last chunk final after silence", () => {
    const gate = createAudioGate({
      sampleRate: 16000,
      chunkMs: 100,
      continueRms: 0.004,
      silenceMs: 200,
      startRms: 0.008
    });

    const loud = new Float32Array(1600 * 3).fill(0.08);
    const quiet = new Float32Array(1600 * 3);

    const loudChunks = gate.push(loud);
    const quietChunks = gate.push(quiet);

    expect(loudChunks).toHaveLength(3);
    expect(loudChunks.every((chunk) => chunk.type === "audio" && !chunk.isFinal)).toBe(true);
    expect(quietChunks).toEqual([
      {
        endSample: 4800,
        isFinal: true,
        startSample: 4800,
        type: "final"
      }
    ]);
  });

  it("emits active audio immediately without waiting for a lookahead chunk", () => {
    const gate = createAudioGate({
      sampleRate: 16000,
      chunkMs: 100,
      continueRms: 0.004,
      startRms: 0.008
    });

    const chunks = gate.push(new Float32Array(1600).fill(0.08));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      endSample: 1600,
      isFinal: false,
      startSample: 0,
      type: "audio"
    });
  });

  it("calculates RMS and peak for gate decisions", () => {
    const level = calculateAudioLevel(new Float32Array([0, -0.5, 0.5]));

    expect(level.peak).toBe(0.5);
    expect(level.rms).toBeGreaterThan(0.4);
  });

  it("preserves chunk boundaries across uneven pushes without sample duplication", () => {
    const gate = createAudioGate({
      sampleRate: 10,
      chunkMs: 200,
      continueRms: 0.001,
      silenceMs: 400,
      startRms: 0.001
    });

    expect(gate.push(new Float32Array([0.1]))).toEqual([]);
    const firstOutput = gate.push(new Float32Array([0.2, 0.3]));
    const secondOutput = gate.push(new Float32Array([0.4, 0.5]));
    const flushed = gate.flush();

    expect(firstOutput).toHaveLength(1);
    expect(firstOutput[0].type).toBe("audio");
    if (firstOutput[0].type !== "audio") {
      throw new Error("expected audio chunk");
    }
    expect(Array.from(firstOutput[0].samples)).toEqual([
      expect.closeTo(0.1, 6),
      expect.closeTo(0.2, 6)
    ]);
    expect(firstOutput[0].startSample).toBe(0);
    expect(firstOutput[0].endSample).toBe(2);
    expect(secondOutput).toHaveLength(1);
    expect(secondOutput[0].type).toBe("audio");
    if (secondOutput[0].type !== "audio") {
      throw new Error("expected audio chunk");
    }
    expect(Array.from(secondOutput[0].samples)).toEqual([
      expect.closeTo(0.3, 6),
      expect.closeTo(0.4, 6)
    ]);
    expect(flushed.map((chunk) => (chunk.type === "audio" ? Array.from(chunk.samples) : []))).toEqual([
      [expect.closeTo(0.5, 6)],
      []
    ]);
    expect(flushed.at(-1)?.isFinal).toBe(true);
  });
});
