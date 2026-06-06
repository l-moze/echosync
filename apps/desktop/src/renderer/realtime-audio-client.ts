import type { DesktopAudioSourceId } from "../shared/audio-source-catalog";
import type { AsrLatencyMode, AsrProviderId } from "../shared/asr-provider-catalog";
import type { TtsProviderId } from "../shared/agent-capabilities";
import type { TranslationProviderId } from "../shared/translation-provider-catalog";

import { createAudioGate, type AudioGateChunk } from "./audio-gate";
import {
  createPcm16BinaryFrame,
  downmixToMono,
  floatToPcm16,
  resampleLinear,
  type AudioSourceKind
} from "./pcm-audio";
import { createSessionRecorder, type SessionRecorder, type SessionRecording } from "./session-recorder";

const DEFAULT_REALTIME_WS_URL = "ws://127.0.0.1:8766/v1/realtime/sessions";
const TARGET_SAMPLE_RATE = 16_000;
const AUDIO_PROCESSOR_BUFFER_SIZE = 2048;
const AUDIO_FRAME_DURATION_MS = 80;

export type RealtimeAudioClient = {
  readonly sessionId: string;
  start: () => Promise<void>;
  stop: () => Promise<SessionRecording | null>;
};

export type RealtimeAudioClientOptions = {
  asrLatencyMode?: AsrLatencyMode;
  asrProvider?: AsrProviderId;
  sourceId: DesktopAudioSourceId;
  sourceLang?: string;
  endpointBaseUrl?: string;
  recorder?: SessionRecorder;
  sessionId?: string;
  translationProvider?: TranslationProviderId;
  ttsProvider?: TtsProviderId;
};

export function createRealtimeAudioClient({
  asrLatencyMode = "balanced",
  asrProvider,
  endpointBaseUrl = DEFAULT_REALTIME_WS_URL,
  recorder = createSessionRecorder(),
  sessionId = createSessionId(),
  sourceId,
  sourceLang = "en",
  translationProvider,
  ttsProvider
}: RealtimeAudioClientOptions): RealtimeAudioClient {
  let socket: WebSocket | null = null;
  let mediaStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let silentOutput: GainNode | null = null;
  let seq = 0;
  let started = false;
  let recordingStarted = false;
  const audioGate = createAudioGate({
    chunkMs: AUDIO_FRAME_DURATION_MS,
    sampleRate: TARGET_SAMPLE_RATE
  });

  async function start() {
    if (started) {
      return;
    }
    started = true;

    try {
      mediaStream = await openCaptureStream(sourceId);
      recorder.start(mediaStream);
      recordingStarted = true;
      socket = await openRealtimeSocket(`${endpointBaseUrl}/${sessionId}`);

      const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
      audioContext = new AudioContextCtor();
      sourceNode = audioContext.createMediaStreamSource(mediaStream);
      processor = audioContext.createScriptProcessor(AUDIO_PROCESSOR_BUFFER_SIZE, 2, 1);
      silentOutput = audioContext.createGain();
      silentOutput.gain.value = 0;

      const startMessage: Record<string, unknown> = {
        type: "audio.start",
        protocol: "pcm16.binary.v1",
        frame_duration_ms: AUDIO_FRAME_DURATION_MS,
        source_lang: sourceLang,
        sample_rate: TARGET_SAMPLE_RATE,
        channels: 1,
        source_kind: sourceKindForSource(sourceId),
        device_id: sourceId,
        asr_latency_mode: asrLatencyMode
      };
      if (asrProvider) {
        startMessage.asr_provider = asrProvider;
      }
      if (translationProvider) {
        startMessage.translation_provider = translationProvider;
      }
      if (ttsProvider) {
        startMessage.tts_provider = ttsProvider;
      }
      socket.send(JSON.stringify(startMessage));

      processor.onaudioprocess = (event) => {
        if (!socket || socket.readyState !== WebSocket.OPEN || !audioContext) {
          return;
        }

        const inputBuffer = event.inputBuffer;
        const channels = Array.from({ length: inputBuffer.numberOfChannels }, (_value, index) =>
          inputBuffer.getChannelData(index)
        );
        const mono = downmixToMono(channels);
        const resampled = resampleLinear(mono, audioContext.sampleRate, TARGET_SAMPLE_RATE);
        for (const chunk of audioGate.push(resampled)) {
          sendAudioGateOutput(chunk);
        }
      };

      sourceNode.connect(processor);
      processor.connect(silentOutput);
      silentOutput.connect(audioContext.destination);
    } catch (error) {
      recorder.discard();
      recordingStarted = false;
      await stop();
      throw error;
    }
  }

  async function stop() {
    started = false;
    const recording = recordingStarted ? await recorder.stop() : null;
    recordingStarted = false;

    if (socket?.readyState === WebSocket.OPEN) {
      for (const chunk of audioGate.flush()) {
        sendAudioGateOutput(chunk);
      }
      socket.send(JSON.stringify({ type: "audio.end", reason: "user_stop" }));
    }
    processor?.disconnect();
    sourceNode?.disconnect();
    silentOutput?.disconnect();
    processor = null;
    sourceNode = null;
    silentOutput = null;

    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;

    if (audioContext && audioContext.state !== "closed") {
      await audioContext.close();
    }
    audioContext = null;

    socket?.close();
    socket = null;
    return recording;
  }

  return {
    sessionId,
    start,
    stop
  };

  function sendAudioGateOutput(chunk: AudioGateChunk) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (chunk.type === "final") {
      if (seq <= 0) {
        return;
      }
      const endMs = samplesToMs(chunk.endSample);
      socket.send(
        JSON.stringify({
          type: "audio.final",
          seq,
          start_ms: endMs,
          end_ms: endMs
        })
      );
      return;
    }

    const pcm = floatToPcm16(chunk.samples);
    if (pcm.length === 0) {
      return;
    }

    seq += 1;
    const frame = createPcm16BinaryFrame({
      endMs: samplesToMs(chunk.endSample),
      isFinal: chunk.isFinal,
      pcm,
      sentAtMs: nowMs(),
      seq,
      startMs: samplesToMs(chunk.startSample)
    });
    socket.send(frame);
  }
}

async function openCaptureStream(sourceId: DesktopAudioSourceId) {
  if (sourceId === "microphone") {
    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false
    });
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: true
  });
  stream.getVideoTracks().forEach((track) => track.stop());
  return stream;
}

function openRealtimeSocket(url: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error(`无法连接同传服务实时音频入口：${url}`)), {
      once: true
    });
  });
}

function samplesToMs(samples: number) {
  return Math.round((samples / TARGET_SAMPLE_RATE) * 1000);
}

function nowMs() {
  if (typeof performance !== "undefined") {
    return Math.round(performance.timeOrigin + performance.now());
  }
  return Date.now();
}

function sourceKindForSource(sourceId: DesktopAudioSourceId): AudioSourceKind {
  if (sourceId === "microphone") {
    return "microphone";
  }
  if (sourceId === "mixed") {
    return "mixed";
  }
  if (sourceId === "file") {
    return "file";
  }
  return "windows_system";
}

function createSessionId() {
  if (globalThis.crypto?.randomUUID) {
    return `sess_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  }
  return `sess_${Date.now().toString(36)}`;
}
