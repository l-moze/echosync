import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import type { Readable } from "node:stream";
import path from "node:path";
import WebSocket from "ws";

import type { AsrLatencyMode, AsrProviderId } from "../shared/asr-provider-catalog";
import type { TtsProviderId } from "../shared/agent-capabilities";
import type { TranslationProviderId } from "../shared/translation-provider-catalog";

const AUDIO_START_PROTOCOL = "pcm16.binary.v1";
const AUDIO_FRAME_MAGIC = 0x46415345;
const AUDIO_FRAME_HEADER_BYTES = 24;
const FRAME_DURATION_MS = 80;
const TARGET_SAMPLE_RATE = 16_000;
const LENGTH_PREFIX_BYTES = 4;
const PCM16_BYTES_PER_SAMPLE = 2;
const WASAPI_CAPTURE_METRICS_INFO_INTERVAL_MS = 10_000;
const WASAPI_CAPTURE_METRICS_WARN_INTERVAL_MS = 5_000;
const WASAPI_WAKEUP_P95_WARN_MS = 40;
const WASAPI_STDOUT_WRITE_P95_WARN_MS = 20;
const WASAPI_CAPTURE_QUEUE_WARN_BYTES = 1_048_576;
const WASAPI_ACTIVITY_START_RMS = 0.008;
const WASAPI_ACTIVITY_START_PEAK = 0.03;
const REALTIME_DONE_WAIT_TIMEOUT_MS = 5000;

type WasapiSidecarProcess = ChildProcessByStdio<null, Readable, Readable>;

export type WasapiCaptureMode = "exclude-process-tree" | "include-process-tree";

export type WasapiSidecarStartRequest = {
  agentRealtimeBaseUrl: string;
  asrLatencyMode: AsrLatencyMode;
  asrProvider?: AsrProviderId;
  endToEndSourceBackfill?: boolean;
  mode?: WasapiCaptureMode;
  sessionId: string;
  sidecarPath: string;
  sourceLang?: string;
  targetPid?: number;
  translationProvider?: TranslationProviderId;
  ttsProvider?: TtsProviderId;
};

export type WasapiSidecarLogger = {
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
};

export type WasapiSidecarSession = {
  readonly mode: WasapiCaptureMode;
  readonly pid: number;
  readonly sessionId: string;
  stop: () => Promise<WasapiSidecarRecording | null>;
};

export type WasapiSidecarRecording = {
  activityRanges?: Array<{
    startMs: number;
    endMs: number;
  }>;
  data: ArrayBuffer;
  mimeType: "audio/wav";
  sessionId: string;
};

export type WasapiDiagnosticLogGateState = {
  lastCaptureMetricsInfoAtMs: number | null;
  lastCaptureMetricsWarnAtMs: number | null;
};

export type WasapiDiagnosticLogDecision = {
  data?: unknown;
  level: "info" | "warn" | "skip";
  message: string;
};

export function createWasapiDiagnosticLogGateState(): WasapiDiagnosticLogGateState {
  return {
    lastCaptureMetricsInfoAtMs: null,
    lastCaptureMetricsWarnAtMs: null
  };
}

export function resolveWasapiSidecarPath({
  env = process.env,
  exists = existsSync,
  isPackaged = false,
  mainDir = __dirname,
  resourcesPath = process.resourcesPath
}: {
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  isPackaged?: boolean;
  mainDir?: string;
  resourcesPath?: string;
} = {}) {
  if (env.ECHOSYNC_WASAPI_SIDECAR_PATH) {
    return env.ECHOSYNC_WASAPI_SIDECAR_PATH;
  }
  if (isPackaged) {
    return path.join(resourcesPath, "wasapi-sidecar", "echosync-wasapi-sidecar.exe");
  }
  const developmentCandidates = [
    path.resolve(mainDir, "../../resources/wasapi-sidecar/echosync-wasapi-sidecar.exe"),
    path.resolve(mainDir, "../../../wasapi-sidecar/target/debug/echosync-wasapi-sidecar.exe"),
    path.resolve(mainDir, "../../../wasapi-sidecar/target/release/echosync-wasapi-sidecar.exe"),
    path.resolve(mainDir, "../../../../.tmp/wasapi-target/debug/echosync-wasapi-sidecar.exe"),
    path.resolve(mainDir, "../../../../.tmp/wasapi-target/release/echosync-wasapi-sidecar.exe")
  ];
  return developmentCandidates.find((candidate) => exists(candidate)) ?? developmentCandidates[0];
}

export async function startWasapiSidecarCapture(
  request: WasapiSidecarStartRequest,
  logger: WasapiSidecarLogger
): Promise<WasapiSidecarSession> {
  const mode = request.mode ?? "exclude-process-tree";
  const targetPid = request.targetPid ?? globalThis.process.pid;
  const sidecarProcess = spawnSidecar(request.sidecarPath, {
    mode,
    sessionId: request.sessionId,
    targetPid
  });
  const closed = onceClosed(sidecarProcess, logger);
  const stderrPump = pumpSidecarDiagnostics(sidecarProcess, logger, closed);
  const pcmChunks: Buffer[] = [];
  const activityRanges: NonNullable<WasapiSidecarRecording["activityRanges"]> = [];
  await waitForSidecarSpawn(sidecarProcess);
  let socket: WebSocket;
  try {
    socket = await openAgentSocket(
      `${request.agentRealtimeBaseUrl.replace(/\/$/, "")}/${request.sessionId}`
    );
  } catch (error) {
    if (!sidecarProcess.killed) {
      sidecarProcess.kill();
    }
    throw error;
  }
  if (sidecarProcess.exitCode !== null || sidecarProcess.signalCode !== null) {
    socket.close();
    throw new Error("WASAPI 原生采集进程启动后提前退出，请查看 wasapi-sidecar 日志。");
  }
  const stdoutPump = pumpSidecarFramesToAgent(sidecarProcess, socket, closed, (packet) => {
    const payload = extractPcm16PayloadFromBinaryFrame(packet);
    if (payload.length > 0) {
      pcmChunks.push(Buffer.from(payload));
    }
    const range = readPcm16FrameRange(packet);
    if (range && isAudiblePcm16Payload(payload)) {
      recordWasapiActivityRange(activityRanges, range.startMs, range.endMs);
    }
  });
  socket.on("error", (error) => {
    logger.warn("[wasapi-sidecar] Agent WebSocket 运行时错误", error);
  });

  const audioStartMessage = createAudioStartMessage(request, mode, targetPid);
  logger.info("[wasapi-sidecar] 发送 Agent audio.start", {
    asrLatencyMode: audioStartMessage.asr_latency_mode,
    asrProvider: audioStartMessage.asr_provider ?? "server-default",
    deviceId: audioStartMessage.device_id,
    endToEndSourceBackfill: audioStartMessage.end_to_end_source_backfill,
    sessionId: request.sessionId,
    translationProvider: audioStartMessage.translation_provider ?? "server-default",
    ttsProvider: audioStartMessage.tts_provider ?? "server-default"
  });
  socket.send(JSON.stringify(audioStartMessage));
  logger.info("[wasapi-sidecar] 原生系统声采集已启动", {
    mode,
    pid: targetPid,
    sessionId: request.sessionId
  });

  return {
    mode,
    pid: targetPid,
    sessionId: request.sessionId,
    async stop() {
      if (!sidecarProcess.killed) {
        sidecarProcess.kill();
      }
      await Promise.allSettled([stdoutPump, stderrPump]);
      if (socket.readyState === WebSocket.OPEN) {
        const realtimeDone = waitForRealtimeDone(socket, request.sessionId, logger);
        socket.send(JSON.stringify({ type: "audio.end", reason: "user_stop" }));
        await realtimeDone;
      }
      socket.close();
      return createWasapiSidecarRecording(request.sessionId, pcmChunks, activityRanges);
    }
  };
}

function spawnSidecar(
  sidecarPath: string,
  {
    mode,
    sessionId,
    targetPid
  }: {
    mode: WasapiCaptureMode;
    sessionId: string;
    targetPid: number;
  }
): WasapiSidecarProcess {
  return spawn(
    sidecarPath,
    ["--pid", String(targetPid), "--session-id", sessionId, "--mode", mode],
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  ) as WasapiSidecarProcess;
}

export function createAudioStartMessage(
  request: WasapiSidecarStartRequest,
  mode: WasapiCaptureMode,
  targetPid: number
) {
  const message: Record<string, unknown> = {
    type: "audio.start",
    protocol: AUDIO_START_PROTOCOL,
    frame_duration_ms: FRAME_DURATION_MS,
    source_lang: request.sourceLang ?? "en",
    sample_rate: TARGET_SAMPLE_RATE,
    channels: 1,
    source_kind: "windows_system",
    device_id: `wasapi:${mode}:${targetPid}`,
    trace_id: request.sessionId,
    asr_latency_mode: request.asrLatencyMode,
    end_to_end_source_backfill: request.endToEndSourceBackfill ?? true
  };
  if (request.asrProvider) {
    message.asr_provider = request.asrProvider;
  }
  if (request.translationProvider) {
    message.translation_provider = request.translationProvider;
  }
  if (request.ttsProvider) {
    message.tts_provider = request.ttsProvider;
  }
  return message;
}

function openAgentSocket(url: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", (error) => reject(error));
  });
}

export function parseRealtimeControlMessage(data: WebSocket.RawData) {
  const text = Array.isArray(data)
    ? Buffer.concat(data).toString("utf8")
    : Buffer.isBuffer(data)
      ? data.toString("utf8")
      : data instanceof ArrayBuffer
        ? Buffer.from(data).toString("utf8")
        : Buffer.from(data).toString("utf8");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function waitForRealtimeDone(
  socket: WebSocket,
  sessionId: string,
  logger: WasapiSidecarLogger,
  timeoutMs = REALTIME_DONE_WAIT_TIMEOUT_MS
) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (done: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("close", onClose);
      socket.off("error", onError);
      resolve(done);
    };
    const onMessage = (data: WebSocket.RawData) => {
      const message = parseRealtimeControlMessage(data);
      if (!message || message.session_id !== sessionId) {
        return;
      }
      if (message.type === "realtime.done") {
        logger.info("[wasapi-sidecar] Agent realtime.done 已返回", { sessionId });
        finish(true);
      }
      if (message.type === "realtime.error") {
        logger.warn("[wasapi-sidecar] Agent realtime.error", message);
        finish(true);
      }
    };
    const onClose = () => finish(false);
    const onError = () => finish(false);
    const timer = setTimeout(() => {
      logger.warn("[wasapi-sidecar] 等待 Agent realtime.done 超时", {
        sessionId,
        timeoutMs
      });
      finish(false);
    }, timeoutMs);
    socket.on("message", onMessage);
    socket.once("close", onClose);
    socket.once("error", onError);
  });
}

function waitForSidecarSpawn(sidecar: WasapiSidecarProcess) {
  return new Promise<void>((resolve, reject) => {
    sidecar.once("spawn", () => resolve());
    sidecar.once("error", (error) => reject(error));
  });
}

async function pumpSidecarFramesToAgent(
  sidecar: WasapiSidecarProcess,
  socket: WebSocket,
  closed: Promise<void>,
  onPacket?: (packet: Buffer<ArrayBufferLike>) => void
) {
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  sidecar.stdout.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    const parsed = parseLengthPrefixedPackets(buffer);
    buffer = parsed.remaining;
    for (const packet of parsed.packets) {
      onPacket?.(packet);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(packet);
      }
    }
  });
  await closed;
}

export function parseLengthPrefixedPackets(buffer: Buffer<ArrayBufferLike>): {
  packets: Array<Buffer<ArrayBufferLike>>;
  remaining: Buffer<ArrayBufferLike>;
} {
  const packets: Array<Buffer<ArrayBufferLike>> = [];
  let cursor = 0;
  while (buffer.length - cursor >= LENGTH_PREFIX_BYTES) {
    const frameLength = buffer.readUInt32LE(cursor);
    const packetStart = cursor + LENGTH_PREFIX_BYTES;
    const packetEnd = packetStart + frameLength;
    if (buffer.length < packetEnd) {
      break;
    }
    packets.push(buffer.subarray(packetStart, packetEnd));
    cursor = packetEnd;
  }

  return {
    packets,
    remaining: buffer.subarray(cursor)
  };
}

export function extractPcm16PayloadFromBinaryFrame(packet: Buffer<ArrayBufferLike>) {
  if (packet.length <= AUDIO_FRAME_HEADER_BYTES || !hasAudioFrameMagic(packet)) {
    return Buffer.alloc(0);
  }
  return packet.subarray(AUDIO_FRAME_HEADER_BYTES);
}

export function readPcm16FrameRange(packet: Buffer<ArrayBufferLike>) {
  if (packet.length < AUDIO_FRAME_HEADER_BYTES || !hasAudioFrameMagic(packet)) {
    return null;
  }
  const startMs = packet.readUInt32LE(12);
  const endMs = packet.readUInt32LE(16);
  if (endMs <= startMs) {
    return null;
  }
  return { startMs, endMs };
}

export function calculatePcm16AudioLevel(payload: Buffer<ArrayBufferLike>) {
  if (payload.length < PCM16_BYTES_PER_SAMPLE) {
    return { peak: 0, rms: 0 };
  }

  let peak = 0;
  let sumSquares = 0;
  let samples = 0;
  for (let offset = 0; offset + 1 < payload.length; offset += PCM16_BYTES_PER_SAMPLE) {
    const value = Math.abs(payload.readInt16LE(offset)) / 32768;
    peak = Math.max(peak, value);
    sumSquares += value * value;
    samples += 1;
  }

  return {
    peak,
    rms: samples === 0 ? 0 : Math.sqrt(sumSquares / samples)
  };
}

export function isAudiblePcm16Payload(payload: Buffer<ArrayBufferLike>) {
  const level = calculatePcm16AudioLevel(payload);
  return level.rms >= WASAPI_ACTIVITY_START_RMS || level.peak >= WASAPI_ACTIVITY_START_PEAK;
}

export function createPcm16WavBuffer(pcm: Buffer<ArrayBufferLike>, sampleRate = TARGET_SAMPLE_RATE, channels = 1) {
  const headerBytes = 44;
  const wav = Buffer.alloc(headerBytes + pcm.byteLength);
  const byteRate = sampleRate * channels * PCM16_BYTES_PER_SAMPLE;
  const blockAlign = channels * PCM16_BYTES_PER_SAMPLE;

  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + pcm.byteLength, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(pcm.byteLength, 40);
  pcm.copy(wav, headerBytes);
  return wav;
}

export function createWasapiSidecarRecording(
  sessionId: string,
  pcmChunks: Buffer<ArrayBufferLike>[],
  activityRanges: NonNullable<WasapiSidecarRecording["activityRanges"]> = []
): WasapiSidecarRecording | null {
  const pcm = Buffer.concat(pcmChunks);
  if (pcm.byteLength <= 0) {
    return null;
  }
  const wav = createPcm16WavBuffer(pcm);
  return {
    activityRanges: activityRanges.length > 0 ? [...activityRanges] : undefined,
    data: arrayBufferFromBuffer(wav),
    mimeType: "audio/wav",
    sessionId
  };
}

function hasAudioFrameMagic(packet: Buffer<ArrayBufferLike>) {
  return packet.length >= AUDIO_FRAME_HEADER_BYTES && packet.readUInt32LE(0) === AUDIO_FRAME_MAGIC;
}

function recordWasapiActivityRange(
  activityRanges: NonNullable<WasapiSidecarRecording["activityRanges"]>,
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

function arrayBufferFromBuffer(buffer: Buffer<ArrayBufferLike>) {
  const data = new Uint8Array(buffer.byteLength);
  data.set(buffer);
  return data.buffer;
}

async function pumpSidecarDiagnostics(
  sidecar: WasapiSidecarProcess,
  logger: WasapiSidecarLogger,
  closed: Promise<void>
) {
  let textBuffer = "";
  const logGateState = createWasapiDiagnosticLogGateState();
  sidecar.stderr.on("data", (chunk: Buffer) => {
    textBuffer += chunk.toString("utf8");
    const lines = textBuffer.split(/\r?\n/);
    textBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      try {
        const decision = decideWasapiDiagnosticLog(JSON.parse(line), logGateState);
        if (decision.level === "info") {
          logger.info(decision.message, decision.data);
        }
        if (decision.level === "warn") {
          logger.warn(decision.message, decision.data);
        }
      } catch {
        logger.warn("[wasapi-sidecar] 非 JSON 诊断输出", line);
      }
    }
  });
  await closed;
}

export function decideWasapiDiagnosticLog(
  payload: unknown,
  state: WasapiDiagnosticLogGateState,
  nowMs = Date.now()
): WasapiDiagnosticLogDecision {
  if (!isRecord(payload) || payload.event !== "wasapi_capture_metrics") {
    return {
      data: payload,
      level: "info",
      message: "[wasapi-sidecar]"
    };
  }

  const summary = summarizeWasapiCaptureMetrics(payload);
  const warnings = collectWasapiCaptureMetricWarnings(summary);
  if (warnings.length > 0) {
    const shouldWarn =
      state.lastCaptureMetricsWarnAtMs === null ||
      nowMs - state.lastCaptureMetricsWarnAtMs >= WASAPI_CAPTURE_METRICS_WARN_INTERVAL_MS;
    if (!shouldWarn) {
      return {
        level: "skip",
        message: "[wasapi-sidecar] WASAPI 采集指标异常"
      };
    }
    state.lastCaptureMetricsWarnAtMs = nowMs;
    state.lastCaptureMetricsInfoAtMs = nowMs;
    return {
      data: {
        ...summary,
        warnings
      },
      level: "warn",
      message: "[wasapi-sidecar] WASAPI 采集指标异常"
    };
  }

  const shouldLogInfo =
    state.lastCaptureMetricsInfoAtMs === null ||
    nowMs - state.lastCaptureMetricsInfoAtMs >= WASAPI_CAPTURE_METRICS_INFO_INTERVAL_MS;
  if (!shouldLogInfo) {
    return {
      level: "skip",
      message: "[wasapi-sidecar] WASAPI 采集指标"
    };
  }

  state.lastCaptureMetricsInfoAtMs = nowMs;
  return {
    data: summary,
    level: "info",
    message: "[wasapi-sidecar] WASAPI 采集指标"
  };
}

function summarizeWasapiCaptureMetrics(payload: Record<string, unknown>) {
  return compactRecord({
    capture_mode: readString(payload, "capture_mode"),
    event: "wasapi_capture_metrics",
    max_capture_queue_bytes: readNumber(payload, "max_capture_queue_bytes"),
    output_frames: readNumber(payload, "output_frames"),
    p95_encode_ms: roundMetric(readNumber(payload, "p95_encode_ms")),
    p95_resample_ms: roundMetric(readNumber(payload, "p95_resample_ms")),
    p95_stdout_write_ms: roundMetric(readNumber(payload, "p95_stdout_write_ms")),
    p95_wakeup_interval_ms: roundMetric(readNumber(payload, "p95_wakeup_interval_ms")),
    raw_bytes: readNumber(payload, "raw_bytes"),
    session_id: readString(payload, "session_id"),
    target_pid: readNumber(payload, "target_pid"),
    window_ms: roundMetric(readNumber(payload, "window_ms"))
  });
}

function collectWasapiCaptureMetricWarnings(summary: Record<string, unknown>) {
  const warnings: string[] = [];
  const p95WakeupIntervalMs = readNumber(summary, "p95_wakeup_interval_ms");
  const p95StdoutWriteMs = readNumber(summary, "p95_stdout_write_ms");
  const maxCaptureQueueBytes = readNumber(summary, "max_capture_queue_bytes");
  if (p95WakeupIntervalMs !== undefined && p95WakeupIntervalMs > WASAPI_WAKEUP_P95_WARN_MS) {
    warnings.push("wakeup_interval_p95_high");
  }
  if (p95StdoutWriteMs !== undefined && p95StdoutWriteMs > WASAPI_STDOUT_WRITE_P95_WARN_MS) {
    warnings.push("stdout_write_p95_high");
  }
  if (maxCaptureQueueBytes !== undefined && maxCaptureQueueBytes > WASAPI_CAPTURE_QUEUE_WARN_BYTES) {
    warnings.push("capture_queue_high");
  }
  return warnings;
}

function compactRecord(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function readNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function roundMetric(value: number | undefined) {
  return value === undefined ? undefined : Math.round(value * 1000) / 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onceClosed(sidecar: WasapiSidecarProcess, logger: WasapiSidecarLogger) {
  return new Promise<void>((resolve) => {
    sidecar.once("error", (error) => {
      logger.error("[wasapi-sidecar] 进程启动失败", error);
      resolve();
    });
    sidecar.once("close", (code, signal) => {
      logger.info("[wasapi-sidecar] 进程已退出", { code, signal });
      resolve();
    });
  });
}
