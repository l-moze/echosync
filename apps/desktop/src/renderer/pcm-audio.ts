export type AudioSourceKind = "microphone" | "windows_system" | "mixed" | "file" | "network_stream";

export const AUDIO_FRAME_MAGIC = 0x46415345;
export const AUDIO_FRAME_HEADER_BYTES = 24;
export const AUDIO_FRAME_FLAG_FINAL = 1 << 0;

export type AudioChunkMessage = {
  type: "audio.chunk";
  seq: number;
  sample_rate: number;
  channels: number;
  start_ms: number;
  end_ms: number;
  source_lang: string;
  source_kind: AudioSourceKind;
  device_id?: string;
  pcm_base64: string;
  is_final?: boolean;
};

export type Pcm16BinaryFrameInput = {
  seq: number;
  startMs: number;
  endMs: number;
  sentAtMs: number;
  pcm: Uint8Array;
  isFinal?: boolean;
};

export function floatToPcm16(samples: Float32Array) {
  const pcm = new Uint8Array(samples.length * 2);
  const view = new DataView(pcm.buffer);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(index * 2, value, true);
  }

  return pcm;
}

export function pcm16ToBase64(pcm: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < pcm.length; offset += chunkSize) {
    const chunk = pcm.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function downmixToMono(input: Float32Array[]) {
  if (input.length === 0) {
    return new Float32Array();
  }
  if (input.length === 1) {
    return input[0] ?? new Float32Array();
  }

  const sampleCount = input[0]?.length ?? 0;
  const mono = new Float32Array(sampleCount);
  for (let channel = 0; channel < input.length; channel += 1) {
    const samples = input[channel];
    if (!samples) {
      continue;
    }
    for (let index = 0; index < sampleCount; index += 1) {
      mono[index] += (samples[index] ?? 0) / input.length;
    }
  }
  return mono;
}

export function resampleLinear(samples: Float32Array, inputRate: number, outputRate: number) {
  if (inputRate === outputRate || samples.length === 0) {
    return samples;
  }

  const outputLength = Math.max(1, Math.round((samples.length * outputRate) / inputRate));
  const output = new Float32Array(outputLength);
  const ratio = inputRate / outputRate;

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, samples.length - 1);
    const weight = sourceIndex - left;
    output[index] = (samples[left] ?? 0) * (1 - weight) + (samples[right] ?? 0) * weight;
  }

  return output;
}

export function createAudioChunkMessage({
  channels,
  deviceId,
  endMs,
  isFinal,
  pcm,
  sampleRate,
  seq,
  sourceKind,
  sourceLang,
  startMs
}: {
  channels: number;
  deviceId?: string;
  endMs: number;
  isFinal?: boolean;
  pcm: Uint8Array;
  sampleRate: number;
  seq: number;
  sourceKind: AudioSourceKind;
  sourceLang: string;
  startMs: number;
}): AudioChunkMessage {
  const message: AudioChunkMessage = {
    type: "audio.chunk",
    seq,
    sample_rate: sampleRate,
    channels,
    start_ms: startMs,
    end_ms: endMs,
    source_lang: sourceLang,
    source_kind: sourceKind,
    pcm_base64: pcm16ToBase64(pcm)
  };

  if (deviceId) {
    message.device_id = deviceId;
  }
  if (isFinal) {
    message.is_final = true;
  }

  return message;
}

export function createPcm16BinaryFrame({
  endMs,
  isFinal,
  pcm,
  sentAtMs,
  seq,
  startMs
}: Pcm16BinaryFrameInput): ArrayBuffer {
  const frame = new ArrayBuffer(AUDIO_FRAME_HEADER_BYTES + pcm.byteLength);
  const view = new DataView(frame);
  view.setUint32(0, AUDIO_FRAME_MAGIC, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, isFinal ? AUDIO_FRAME_FLAG_FINAL : 0, true);
  view.setUint32(8, seq, true);
  view.setUint32(12, startMs, true);
  view.setUint32(16, endMs, true);
  view.setUint32(20, sentAtMs >>> 0, true);
  new Uint8Array(frame, AUDIO_FRAME_HEADER_BYTES).set(pcm);
  return frame;
}
