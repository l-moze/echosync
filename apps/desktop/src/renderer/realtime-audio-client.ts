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
const DEFAULT_TELEMETRY_WINDOW_MS = 1000;

export type RealtimeAudioClient = {
  readonly sessionId: string;
  start: () => Promise<void>;
  stop: () => Promise<SessionRecording | null>;
};

export type RealtimeAudioCaptureTelemetry = {
  sessionId: string;
  sourceId: DesktopAudioSourceId;
  inputSampleRate: number;
  inputChannels: number;
  callbacks: number;
  inputSamples: number;
  resampledSamples: number;
  audioFramesSent: number;
  finalMarkersSent: number;
  encodedBytes: number;
  avgDownmixMs: number;
  p95DownmixMs: number;
  avgResampleMs: number;
  p95ResampleMs: number;
  avgGateMs: number;
  p95GateMs: number;
  avgEncodeMs: number;
  p95EncodeMs: number;
  avgSendMs: number;
  p95SendMs: number;
  avgProcessingMs: number;
  p95ProcessingMs: number;
  avgCallbackIntervalMs?: number;
  p95CallbackIntervalMs?: number;
  maxWebsocketBufferedAmount: number;
  maxWebsocketBufferedAmountBeforeSend: number;
  maxWebsocketBufferedAmountAfterSend: number;
  windowMs: number;
};

export type RealtimeAudioTelemetryLogger = {
  info: (message: string, data: RealtimeAudioCaptureTelemetry) => void;
};

export type RealtimeAudioClientOptions = {
  asrLatencyMode?: AsrLatencyMode;
  asrProvider?: AsrProviderId;
  sourceId: DesktopAudioSourceId;
  sourceLang?: string;
  endpointBaseUrl?: string;
  recorder?: SessionRecorder;
  sessionId?: string;
  telemetryWindowMs?: number;
  translationProvider?: TranslationProviderId;
  ttsProvider?: TtsProviderId;
  telemetryLogger?: RealtimeAudioTelemetryLogger;
};

export function createRealtimeAudioClient({
  asrLatencyMode = "balanced",
  asrProvider,
  endpointBaseUrl = DEFAULT_REALTIME_WS_URL,
  recorder = createSessionRecorder(),
  sessionId = createSessionId(),
  sourceId,
  sourceLang = "en",
  telemetryLogger,
  telemetryWindowMs = DEFAULT_TELEMETRY_WINDOW_MS,
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
  let lastAudioCallbackAtMs: number | null = null;
  let activityRanges: NonNullable<SessionRecording["activityRanges"]> = [];
  const telemetryWindow = createCaptureTelemetryWindow();
  const audioGate = createAudioGate({
    chunkMs: AUDIO_FRAME_DURATION_MS,
    sampleRate: TARGET_SAMPLE_RATE
  });

  async function start() {
    if (started) {
      return;
    }
    started = true;
    activityRanges = [];

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
        trace_id: sessionId,
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

        const processingStartedAtMs = monotonicNowMs();
        const callbackIntervalMs =
          lastAudioCallbackAtMs === null ? undefined : Math.max(0, processingStartedAtMs - lastAudioCallbackAtMs);
        lastAudioCallbackAtMs = processingStartedAtMs;
        const inputBuffer = event.inputBuffer;
        const channels = Array.from({ length: inputBuffer.numberOfChannels }, (_value, index) =>
          inputBuffer.getChannelData(index)
        );
        const downmixStartedAtMs = monotonicNowMs();
        const mono = downmixToMono(channels);
        const downmixMs = monotonicNowMs() - downmixStartedAtMs;
        const resampleStartedAtMs = monotonicNowMs();
        const resampled = resampleLinear(mono, audioContext.sampleRate, TARGET_SAMPLE_RATE);
        const resampleMs = monotonicNowMs() - resampleStartedAtMs;
        const gateStartedAtMs = monotonicNowMs();
        const chunks = audioGate.push(resampled);
        const gateMs = monotonicNowMs() - gateStartedAtMs;
        const sendStats: AudioSendStats = {
          audioFramesSent: 0,
          encodedBytes: 0,
          encodeMs: 0,
          finalMarkersSent: 0,
          maxWebsocketBufferedAmountAfterSend: socket.bufferedAmount,
          maxWebsocketBufferedAmountBeforeSend: socket.bufferedAmount,
          sendMs: 0
        };
        for (const chunk of chunks) {
          addAudioSendStats(sendStats, sendAudioGateOutput(chunk));
        }
        const processingMs = monotonicNowMs() - processingStartedAtMs;
        recordCaptureTelemetry(telemetryWindow, {
          audioFramesSent: sendStats.audioFramesSent,
          callbackIntervalMs,
          capturedAtMs: processingStartedAtMs,
          downmixMs,
          encodedBytes: sendStats.encodedBytes,
          encodeMs: sendStats.encodeMs,
          finalMarkersSent: sendStats.finalMarkersSent,
          gateMs,
          inputChannels: inputBuffer.numberOfChannels,
          inputSampleRate: audioContext.sampleRate,
          inputSamples: mono.length,
          maxWebsocketBufferedAmountAfterSend: sendStats.maxWebsocketBufferedAmountAfterSend,
          maxWebsocketBufferedAmountBeforeSend: sendStats.maxWebsocketBufferedAmountBeforeSend,
          processingMs,
          resampledSamples: resampled.length,
          resampleMs,
          sendMs: sendStats.sendMs,
          websocketBufferedAmount: socket.bufferedAmount
        });
        if (telemetryLogger && shouldFlushCaptureTelemetry(telemetryWindow, processingStartedAtMs, telemetryWindowMs)) {
          telemetryLogger.info(
            "realtime_audio_capture_metrics",
            snapshotCaptureTelemetry(telemetryWindow, sessionId, sourceId, processingStartedAtMs)
          );
          resetCaptureTelemetryWindow(telemetryWindow);
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
    return recording
      ? {
          ...recording,
          activityRanges: [...activityRanges]
        }
      : null;
  }

  return {
    sessionId,
    start,
    stop
  };

  function sendAudioGateOutput(chunk: AudioGateChunk): AudioSendStats {
    const emptyStats = createEmptyAudioSendStats();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return emptyStats;
    }

    if (chunk.type === "final") {
      if (seq <= 0) {
        return emptyStats;
      }
      const endMs = samplesToMs(chunk.endSample);
      const sendStartedAtMs = monotonicNowMs();
      const bufferedAmountBeforeSend = socket.bufferedAmount;
      socket.send(
        JSON.stringify({
          type: "audio.final",
          seq,
          start_ms: endMs,
          end_ms: endMs
        })
      );
      const sendMs = monotonicNowMs() - sendStartedAtMs;
      return {
        ...emptyStats,
        finalMarkersSent: 1,
        maxWebsocketBufferedAmountAfterSend: socket.bufferedAmount,
        maxWebsocketBufferedAmountBeforeSend: bufferedAmountBeforeSend,
        sendMs
      };
    }

    const encodeStartedAtMs = monotonicNowMs();
    const pcm = floatToPcm16(chunk.samples);
    const encodeMs = monotonicNowMs() - encodeStartedAtMs;
    if (pcm.length === 0) {
      return {
        ...emptyStats,
        encodeMs
      };
    }

    seq += 1;
    recordActivityRange(activityRanges, samplesToMs(chunk.startSample), samplesToMs(chunk.endSample));
    const frame = createPcm16BinaryFrame({
      endMs: samplesToMs(chunk.endSample),
      isFinal: chunk.isFinal,
      pcm,
      sentAtMs: nowMs(),
      seq,
      startMs: samplesToMs(chunk.startSample)
    });
    const bufferedAmountBeforeSend = socket.bufferedAmount;
    const sendStartedAtMs = monotonicNowMs();
    socket.send(frame);
    const sendMs = monotonicNowMs() - sendStartedAtMs;
    return {
      ...emptyStats,
      audioFramesSent: 1,
      encodedBytes: pcm.byteLength,
      encodeMs,
      maxWebsocketBufferedAmountAfterSend: socket.bufferedAmount,
      maxWebsocketBufferedAmountBeforeSend: bufferedAmountBeforeSend,
      sendMs
    };
  }
}

function recordActivityRange(
  activityRanges: NonNullable<SessionRecording["activityRanges"]>,
  startMs: number,
  endMs: number
) {
  const normalizedStartMs = Math.max(0, Math.round(startMs));
  const normalizedEndMs = Math.max(normalizedStartMs, Math.round(endMs));
  if (normalizedEndMs <= normalizedStartMs) {
    return;
  }
  const previous = activityRanges.at(-1);
  if (previous && normalizedStartMs <= previous.endMs + 1) {
    previous.endMs = Math.max(previous.endMs, normalizedEndMs);
    return;
  }
  activityRanges.push({
    endMs: normalizedEndMs,
    startMs: normalizedStartMs
  });
}

type AudioSendStats = {
  audioFramesSent: number;
  finalMarkersSent: number;
  encodedBytes: number;
  encodeMs: number;
  maxWebsocketBufferedAmountAfterSend: number;
  maxWebsocketBufferedAmountBeforeSend: number;
  sendMs: number;
};

type CaptureTelemetrySample = AudioSendStats & {
  callbackIntervalMs?: number;
  capturedAtMs: number;
  downmixMs: number;
  gateMs: number;
  inputChannels: number;
  inputSampleRate: number;
  inputSamples: number;
  processingMs: number;
  resampledSamples: number;
  resampleMs: number;
  websocketBufferedAmount: number;
};

type CaptureTelemetryWindow = {
  audioFramesSent: number;
  callbackIntervalsMs: number[];
  callbacks: number;
  downmixTimesMs: number[];
  encodedBytes: number;
  encodeTimesMs: number[];
  finalMarkersSent: number;
  gateTimesMs: number[];
  inputChannels: number;
  inputSampleRate: number;
  inputSamples: number;
  maxWebsocketBufferedAmount: number;
  maxWebsocketBufferedAmountAfterSend: number;
  maxWebsocketBufferedAmountBeforeSend: number;
  processingTimesMs: number[];
  resampledSamples: number;
  resampleTimesMs: number[];
  sendTimesMs: number[];
  startedAtMs: number | null;
};

function createEmptyAudioSendStats(): AudioSendStats {
  return {
    audioFramesSent: 0,
    encodedBytes: 0,
    encodeMs: 0,
    finalMarkersSent: 0,
    maxWebsocketBufferedAmountAfterSend: 0,
    maxWebsocketBufferedAmountBeforeSend: 0,
    sendMs: 0
  };
}

function addAudioSendStats(total: AudioSendStats, next: AudioSendStats): void {
  total.audioFramesSent += next.audioFramesSent;
  total.finalMarkersSent += next.finalMarkersSent;
  total.encodedBytes += next.encodedBytes;
  total.encodeMs += next.encodeMs;
  total.sendMs += next.sendMs;
  total.maxWebsocketBufferedAmountBeforeSend = Math.max(
    total.maxWebsocketBufferedAmountBeforeSend,
    next.maxWebsocketBufferedAmountBeforeSend
  );
  total.maxWebsocketBufferedAmountAfterSend = Math.max(
    total.maxWebsocketBufferedAmountAfterSend,
    next.maxWebsocketBufferedAmountAfterSend
  );
}

function createCaptureTelemetryWindow(): CaptureTelemetryWindow {
  return {
    audioFramesSent: 0,
    callbackIntervalsMs: [],
    callbacks: 0,
    downmixTimesMs: [],
    encodedBytes: 0,
    encodeTimesMs: [],
    finalMarkersSent: 0,
    gateTimesMs: [],
    inputChannels: 0,
    inputSampleRate: 0,
    inputSamples: 0,
    maxWebsocketBufferedAmount: 0,
    maxWebsocketBufferedAmountAfterSend: 0,
    maxWebsocketBufferedAmountBeforeSend: 0,
    processingTimesMs: [],
    resampledSamples: 0,
    resampleTimesMs: [],
    sendTimesMs: [],
    startedAtMs: null
  };
}

function recordCaptureTelemetry(
  telemetryWindow: CaptureTelemetryWindow,
  sample: CaptureTelemetrySample
): void {
  if (telemetryWindow.startedAtMs === null) {
    telemetryWindow.startedAtMs = sample.capturedAtMs;
  }
  telemetryWindow.audioFramesSent += sample.audioFramesSent;
  telemetryWindow.callbacks += 1;
  telemetryWindow.encodedBytes += sample.encodedBytes;
  telemetryWindow.finalMarkersSent += sample.finalMarkersSent;
  telemetryWindow.inputChannels = sample.inputChannels;
  telemetryWindow.inputSampleRate = sample.inputSampleRate;
  telemetryWindow.inputSamples += sample.inputSamples;
  telemetryWindow.maxWebsocketBufferedAmount = Math.max(
    telemetryWindow.maxWebsocketBufferedAmount,
    sample.websocketBufferedAmount
  );
  telemetryWindow.maxWebsocketBufferedAmountBeforeSend = Math.max(
    telemetryWindow.maxWebsocketBufferedAmountBeforeSend,
    sample.maxWebsocketBufferedAmountBeforeSend
  );
  telemetryWindow.maxWebsocketBufferedAmountAfterSend = Math.max(
    telemetryWindow.maxWebsocketBufferedAmountAfterSend,
    sample.maxWebsocketBufferedAmountAfterSend
  );
  telemetryWindow.downmixTimesMs.push(sample.downmixMs);
  telemetryWindow.gateTimesMs.push(sample.gateMs);
  telemetryWindow.processingTimesMs.push(sample.processingMs);
  telemetryWindow.resampledSamples += sample.resampledSamples;
  telemetryWindow.resampleTimesMs.push(sample.resampleMs);
  if (sample.sendMs > 0) {
    telemetryWindow.sendTimesMs.push(sample.sendMs);
  }
  if (sample.encodeMs > 0) {
    telemetryWindow.encodeTimesMs.push(sample.encodeMs);
  }
  if (sample.callbackIntervalMs !== undefined) {
    telemetryWindow.callbackIntervalsMs.push(sample.callbackIntervalMs);
  }
}

function shouldFlushCaptureTelemetry(
  telemetryWindow: CaptureTelemetryWindow,
  nowMs: number,
  windowMs: number
): boolean {
  if (telemetryWindow.startedAtMs === null || telemetryWindow.callbacks === 0) {
    return false;
  }
  return nowMs - telemetryWindow.startedAtMs >= windowMs;
}

function snapshotCaptureTelemetry(
  telemetryWindow: CaptureTelemetryWindow,
  sessionId: string,
  sourceId: DesktopAudioSourceId,
  nowMs: number
): RealtimeAudioCaptureTelemetry {
  return {
    audioFramesSent: telemetryWindow.audioFramesSent,
    avgCallbackIntervalMs: averageRounded(telemetryWindow.callbackIntervalsMs),
    avgDownmixMs: averageRounded(telemetryWindow.downmixTimesMs) ?? 0,
    avgEncodeMs: averageRounded(telemetryWindow.encodeTimesMs) ?? 0,
    avgGateMs: averageRounded(telemetryWindow.gateTimesMs) ?? 0,
    avgProcessingMs: averageRounded(telemetryWindow.processingTimesMs) ?? 0,
    avgResampleMs: averageRounded(telemetryWindow.resampleTimesMs) ?? 0,
    avgSendMs: averageRounded(telemetryWindow.sendTimesMs) ?? 0,
    callbacks: telemetryWindow.callbacks,
    encodedBytes: telemetryWindow.encodedBytes,
    finalMarkersSent: telemetryWindow.finalMarkersSent,
    inputChannels: telemetryWindow.inputChannels,
    inputSampleRate: telemetryWindow.inputSampleRate,
    inputSamples: telemetryWindow.inputSamples,
    maxWebsocketBufferedAmount: telemetryWindow.maxWebsocketBufferedAmount,
    maxWebsocketBufferedAmountAfterSend: telemetryWindow.maxWebsocketBufferedAmountAfterSend,
    maxWebsocketBufferedAmountBeforeSend: telemetryWindow.maxWebsocketBufferedAmountBeforeSend,
    p95CallbackIntervalMs: percentileRounded(telemetryWindow.callbackIntervalsMs, 0.95),
    p95DownmixMs: percentileRounded(telemetryWindow.downmixTimesMs, 0.95) ?? 0,
    p95EncodeMs: percentileRounded(telemetryWindow.encodeTimesMs, 0.95) ?? 0,
    p95GateMs: percentileRounded(telemetryWindow.gateTimesMs, 0.95) ?? 0,
    p95ProcessingMs: percentileRounded(telemetryWindow.processingTimesMs, 0.95) ?? 0,
    p95ResampleMs: percentileRounded(telemetryWindow.resampleTimesMs, 0.95) ?? 0,
    p95SendMs: percentileRounded(telemetryWindow.sendTimesMs, 0.95) ?? 0,
    resampledSamples: telemetryWindow.resampledSamples,
    sessionId,
    sourceId,
    windowMs: Math.max(0, Math.round(nowMs - (telemetryWindow.startedAtMs ?? nowMs)))
  };
}

function resetCaptureTelemetryWindow(telemetryWindow: CaptureTelemetryWindow): void {
  const next = createCaptureTelemetryWindow();
  Object.assign(telemetryWindow, next);
}

function averageRounded(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return roundMs(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentileRounded(values: number[], percentile: number): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1));
  return roundMs(sorted[index] ?? 0);
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

function monotonicNowMs() {
  if (typeof performance !== "undefined") {
    return performance.now();
  }
  return Date.now();
}

function roundMs(value: number) {
  return Math.max(0, Math.round(value));
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
