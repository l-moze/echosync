export type AudioLevel = {
  peak: number;
  rms: number;
};

type AudioSamples = Float32Array<ArrayBufferLike>;

export type AudioGateChunk = {
  samples: AudioSamples;
  startSample: number;
  endSample: number;
  isFinal: boolean;
};

export type AudioGateOptions = {
  sampleRate: number;
  chunkMs?: number;
  silenceMs?: number;
  startRms?: number;
  continueRms?: number;
  startPeak?: number;
};

export type AudioGate = {
  push: (samples: AudioSamples) => AudioGateChunk[];
  flush: () => AudioGateChunk[];
};

const DEFAULT_CHUNK_MS = 240;
const DEFAULT_SILENCE_MS = 640;
const DEFAULT_START_RMS = 0.008;
const DEFAULT_CONTINUE_RMS = 0.004;
const DEFAULT_START_PEAK = 0.03;

export function calculateAudioLevel(samples: AudioSamples): AudioLevel {
  if (samples.length === 0) {
    return { peak: 0, rms: 0 };
  }

  let peak = 0;
  let sumSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.abs(samples[index] ?? 0);
    peak = Math.max(peak, value);
    sumSquares += value * value;
  }

  return {
    peak,
    rms: Math.sqrt(sumSquares / samples.length)
  };
}

export function createAudioGate({
  chunkMs = DEFAULT_CHUNK_MS,
  continueRms = DEFAULT_CONTINUE_RMS,
  sampleRate,
  silenceMs = DEFAULT_SILENCE_MS,
  startPeak = DEFAULT_START_PEAK,
  startRms = DEFAULT_START_RMS
}: AudioGateOptions): AudioGate {
  const chunkSamples = Math.max(1, Math.round((sampleRate * chunkMs) / 1000));
  const silenceSamples = Math.max(chunkSamples, Math.round((sampleRate * silenceMs) / 1000));
  const buffer = createSampleQueue();
  let nextSample = 0;
  let active = false;
  let quietSamples = 0;
  let pending: AudioGateChunk | null = null;

  function push(samples: AudioSamples) {
    buffer.push(samples);
    const output: AudioGateChunk[] = [];

    while (buffer.length() >= chunkSamples) {
      processChunk(buffer.take(chunkSamples), output);
    }

    return output;
  }

  function flush() {
    const output: AudioGateChunk[] = [];
    if (buffer.length() > 0) {
      processChunk(buffer.take(buffer.length()), output);
    }
    if (pending) {
      output.push({ ...pending, isFinal: true });
      pending = null;
    }
    active = false;
    quietSamples = 0;
    return output;
  }

  function processChunk(samples: AudioSamples, output: AudioGateChunk[]) {
    const startSample = nextSample;
    const endSample = startSample + samples.length;
    nextSample = endSample;

    const level = calculateAudioLevel(samples);
    const loudEnoughToStart = level.rms >= startRms || level.peak >= startPeak;
    const loudEnoughToContinue = level.rms >= continueRms || loudEnoughToStart;

    if (!active && !loudEnoughToStart) {
      return;
    }

    if (active && !loudEnoughToContinue) {
      quietSamples += samples.length;
      if (quietSamples >= silenceSamples) {
        if (pending) {
          output.push({ ...pending, isFinal: true });
          pending = null;
        }
        active = false;
        quietSamples = 0;
        return;
      }
    } else {
      active = true;
      quietSamples = 0;
    }

    if (pending) {
      output.push({ ...pending, isFinal: false });
    }
    pending = {
      endSample,
      isFinal: false,
      samples,
      startSample
    };
  }

  return { flush, push };
}

function createSampleQueue() {
  const chunks: AudioSamples[] = [];
  let headIndex = 0;
  let firstOffset = 0;
  let queuedSamples = 0;

  return {
    length() {
      return queuedSamples;
    },
    push(samples: AudioSamples) {
      if (samples.length === 0) {
        return;
      }
      chunks.push(samples);
      queuedSamples += samples.length;
    },
    take(count: number): AudioSamples {
      const output = new Float32Array(count);
      let written = 0;

      while (written < count && headIndex < chunks.length) {
        const first = chunks[headIndex];
        const available = first.length - firstOffset;
        const needed = count - written;
        const toCopy = Math.min(available, needed);

        output.set(first.subarray(firstOffset, firstOffset + toCopy), written);
        written += toCopy;
        firstOffset += toCopy;
        queuedSamples -= toCopy;

        if (firstOffset >= first.length) {
          headIndex += 1;
          firstOffset = 0;
          if (headIndex > 32 && headIndex * 2 > chunks.length) {
            chunks.splice(0, headIndex);
            headIndex = 0;
          }
        }
      }

      return output;
    }
  };
}
