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

    expect(loudChunks).toHaveLength(2);
    expect(loudChunks.every((chunk) => !chunk.isFinal)).toBe(true);
    expect(quietChunks).toHaveLength(2);
    expect(quietChunks[0].isFinal).toBe(false);
    expect(quietChunks[1].isFinal).toBe(true);
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

    expect(firstOutput).toEqual([]);
    expect(secondOutput).toHaveLength(1);
    expect(Array.from(secondOutput[0].samples)).toEqual([
      expect.closeTo(0.1, 6),
      expect.closeTo(0.2, 6)
    ]);
    expect(secondOutput[0].startSample).toBe(0);
    expect(secondOutput[0].endSample).toBe(2);
    expect(flushed.map((chunk) => Array.from(chunk.samples))).toEqual([
      [expect.closeTo(0.3, 6), expect.closeTo(0.4, 6)],
      [expect.closeTo(0.5, 6)]
    ]);
    expect(flushed.at(-1)?.isFinal).toBe(true);
  });
});
