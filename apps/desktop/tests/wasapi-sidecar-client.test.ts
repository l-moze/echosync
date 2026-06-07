import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  calculatePcm16AudioLevel,
  createPcm16WavBuffer,
  createWasapiDiagnosticLogGateState,
  createAudioStartMessage,
  createWasapiSidecarRecording,
  decideWasapiDiagnosticLog,
  extractPcm16PayloadFromBinaryFrame,
  isAudiblePcm16Payload,
  parseLengthPrefixedPackets,
  parseRealtimeControlMessage,
  readPcm16FrameRange,
  resolveWasapiSidecarPath,
  type WasapiSidecarStartRequest
} from "../src/main/wasapi-sidecar-client";

describe("WASAPI sidecar client", () => {
  it("优先使用显式配置的 sidecar 路径", () => {
    const configuredPath = "D:\\tools\\echosync-wasapi-sidecar.exe";

    expect(
      resolveWasapiSidecarPath({
        env: { ECHOSYNC_WASAPI_SIDECAR_PATH: configuredPath },
        mainDir: "D:\\code\\echosync\\apps\\desktop\\dist\\main"
      })
    ).toBe(configuredPath);
  });

  it("开发态优先使用已复制到 desktop resources 的 sidecar", () => {
    const mainDir = path.join("D:", "code", "echosync", "apps", "desktop", "dist", "main");
    const expectedPath = path.resolve(mainDir, "../../resources/wasapi-sidecar/echosync-wasapi-sidecar.exe");

    expect(
      resolveWasapiSidecarPath({
        env: {},
        exists: (candidate) => candidate === expectedPath,
        mainDir
      })
    ).toBe(expectedPath);
  });

  it("开发态支持 apps/wasapi-sidecar 的默认 cargo debug target", () => {
    const mainDir = path.join("D:", "code", "echosync", "apps", "desktop", "dist", "main");
    const expectedPath = path.resolve(mainDir, "../../../wasapi-sidecar/target/debug/echosync-wasapi-sidecar.exe");

    expect(
      resolveWasapiSidecarPath({
        env: {},
        exists: (candidate) => candidate === expectedPath,
        mainDir
      })
    ).toBe(expectedPath);
  });

  it("开发态支持 D 盘临时 target 目录，避免 C 盘空间不足", () => {
    const mainDir = path.join("D:", "code", "echosync", "apps", "desktop", "dist", "main");
    const expectedPath = path.resolve(mainDir, "../../../../.tmp/wasapi-target/release/echosync-wasapi-sidecar.exe");

    expect(
      resolveWasapiSidecarPath({
        env: {},
        exists: (candidate) => candidate === expectedPath,
        mainDir
      })
    ).toBe(expectedPath);
  });

  it("打包态解析 extraResources 中的 sidecar", () => {
    expect(
      resolveWasapiSidecarPath({
        env: {},
        isPackaged: true,
        resourcesPath: "D:\\EchoSync\\resources"
      })
    ).toBe(path.join("D:\\EchoSync\\resources", "wasapi-sidecar", "echosync-wasapi-sidecar.exe"));
  });

  it("创建 Agent audio.start 时声明排除 EchoSync 进程树的原生系统声", () => {
    const request: WasapiSidecarStartRequest = {
      agentRealtimeBaseUrl: "ws://127.0.0.1:8766/v1/realtime/sessions",
      asrLatencyMode: "low_latency",
      asrProvider: "funasr",
      endToEndSourceBackfill: false,
      sessionId: "sess_test",
      sidecarPath: "D:\\tools\\echosync-wasapi-sidecar.exe",
      sourceLang: "en",
      translationProvider: "deepseek",
      ttsProvider: "edge-tts"
    };

    expect(createAudioStartMessage(request, "exclude-process-tree", 1234)).toMatchObject({
      asr_latency_mode: "low_latency",
      asr_provider: "funasr",
      channels: 1,
      device_id: "wasapi:exclude-process-tree:1234",
      end_to_end_source_backfill: false,
      frame_duration_ms: 80,
      protocol: "pcm16.binary.v1",
      sample_rate: 16000,
      source_kind: "windows_system",
      source_lang: "en",
      trace_id: "sess_test",
      translation_provider: "deepseek",
      tts_provider: "edge-tts",
      type: "audio.start"
    });
  });

  it("解析 sidecar stdout 的 length-prefixed binary frame，并保留半包", () => {
    const first = Buffer.from([1, 2, 3]);
    const second = Buffer.from([4, 5]);
    const third = Buffer.from([6, 7, 8, 9]);
    const partialThird = Buffer.concat([lengthPrefix(third.length), third.subarray(0, 2)]);
    const firstRead = Buffer.concat([packet(first), packet(second), partialThird]);

    const parsed = parseLengthPrefixedPackets(firstRead);

    expect(parsed.packets.map((item) => Array.from(item))).toEqual([
      [1, 2, 3],
      [4, 5]
    ]);
    expect(Array.from(parsed.remaining)).toEqual(Array.from(partialThird));

    const secondRead = Buffer.concat([parsed.remaining, third.subarray(2)]);
    const completed = parseLengthPrefixedPackets(secondRead);
    expect(completed.packets.map((item) => Array.from(item))).toEqual([[6, 7, 8, 9]]);
    expect(completed.remaining.length).toBe(0);
  });

  it("解析 Agent realtime 控制消息，忽略非 JSON 数据", () => {
    expect(parseRealtimeControlMessage(Buffer.from("{\"type\":\"realtime.done\",\"session_id\":\"sess_done\"}"))).toEqual({
      session_id: "sess_done",
      type: "realtime.done"
    });
    expect(parseRealtimeControlMessage([
      Buffer.from("{\"type\":\""),
      Buffer.from("realtime.error\"}")
    ])).toEqual({ type: "realtime.error" });
    expect(parseRealtimeControlMessage(Buffer.from("not-json"))).toBeNull();
  });

  it("从 sidecar binary frame 提取 PCM 并合成为可回放 WAV", () => {
    const pcm = Buffer.from([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80, 0x11, 0x22]);
    const frame = binaryAudioFrame({ endMs: 80, pcm, seq: 1, startMs: 0 });

    expect(Array.from(extractPcm16PayloadFromBinaryFrame(frame))).toEqual(Array.from(pcm));
    expect(readPcm16FrameRange(frame)).toEqual({ endMs: 80, startMs: 0 });

    const recording = createWasapiSidecarRecording("sess_wav", [extractPcm16PayloadFromBinaryFrame(frame)], [
      { endMs: 80, startMs: 0 }
    ]);

    expect(recording).toMatchObject({
      activityRanges: [{ endMs: 80, startMs: 0 }],
      mimeType: "audio/wav",
      sessionId: "sess_wav"
    });
    const wav = Buffer.from(recording?.data ?? new ArrayBuffer(0));
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(pcm.byteLength);
    expect(Array.from(wav.subarray(44))).toEqual(Array.from(pcm));
  });

  it("创建 PCM16 WAV 时写入 16k 单声道头信息", () => {
    const wav = createPcm16WavBuffer(Buffer.from([1, 2, 3, 4]));

    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt16LE(34)).toBe(16);
  });

  it("按 PCM16 RMS 和峰值区分 WASAPI 有效音频与数字静音", () => {
    const silence = Buffer.alloc(160);
    const speechLike = Buffer.alloc(160);
    for (let offset = 0; offset < speechLike.length; offset += 2) {
      speechLike.writeInt16LE(offset % 4 === 0 ? 2500 : -2500, offset);
    }

    expect(calculatePcm16AudioLevel(silence)).toEqual({ peak: 0, rms: 0 });
    expect(isAudiblePcm16Payload(silence)).toBe(false);
    expect(isAudiblePcm16Payload(speechLike)).toBe(true);
    expect(calculatePcm16AudioLevel(speechLike).rms).toBeGreaterThan(0.03);
  });

  it("节流 WASAPI 采集指标日志，避免 Electron 控制台每秒刷屏", () => {
    const state = createWasapiDiagnosticLogGateState();
    const metrics = createHealthyCaptureMetrics();

    expect(decideWasapiDiagnosticLog(metrics, state, 1_000)).toMatchObject({
      level: "info",
      message: "[wasapi-sidecar] WASAPI 采集指标"
    });
    expect(decideWasapiDiagnosticLog(metrics, state, 5_000)).toMatchObject({
      level: "skip"
    });
    expect(decideWasapiDiagnosticLog(metrics, state, 11_000)).toMatchObject({
      level: "info",
      message: "[wasapi-sidecar] WASAPI 采集指标"
    });
  });

  it("WASAPI 采集指标异常时保留告警，但同样做短窗口节流", () => {
    const state = createWasapiDiagnosticLogGateState();
    const metrics = {
      ...createHealthyCaptureMetrics(),
      max_capture_queue_bytes: 2_000_000,
      p95_stdout_write_ms: 25,
      p95_wakeup_interval_ms: 45
    };

    const first = decideWasapiDiagnosticLog(metrics, state, 1_000);
    expect(first).toMatchObject({
      level: "warn",
      message: "[wasapi-sidecar] WASAPI 采集指标异常"
    });
    expect(first.data).toMatchObject({
      warnings: ["wakeup_interval_p95_high", "stdout_write_p95_high", "capture_queue_high"]
    });

    expect(decideWasapiDiagnosticLog(metrics, state, 4_000)).toMatchObject({
      level: "skip"
    });
    expect(decideWasapiDiagnosticLog(metrics, state, 6_000)).toMatchObject({
      level: "warn"
    });
  });

  it("非 metrics 诊断日志仍保持可见", () => {
    const state = createWasapiDiagnosticLogGateState();

    expect(
      decideWasapiDiagnosticLog(
        {
          event: "wasapi_sidecar_started",
          session_id: "sess_test"
        },
        state,
        1_000
      )
    ).toMatchObject({
      level: "info",
      message: "[wasapi-sidecar]"
    });
  });
});

function packet(payload: Buffer) {
  return Buffer.concat([lengthPrefix(payload.length), payload]);
}

function lengthPrefix(length: number) {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(length, 0);
  return prefix;
}

function binaryAudioFrame({
  endMs,
  pcm,
  seq,
  startMs
}: {
  endMs: number;
  pcm: Buffer;
  seq: number;
  startMs: number;
}) {
  const frame = Buffer.alloc(24 + pcm.byteLength);
  frame.writeUInt32LE(0x46415345, 0);
  frame.writeUInt16LE(1, 4);
  frame.writeUInt16LE(0, 6);
  frame.writeUInt32LE(seq, 8);
  frame.writeUInt32LE(startMs, 12);
  frame.writeUInt32LE(endMs, 16);
  frame.writeUInt32LE(1234, 20);
  pcm.copy(frame, 24);
  return frame;
}

function createHealthyCaptureMetrics() {
  return {
    capture_mode: "wasapi.exclude_process_tree",
    event: "wasapi_capture_metrics",
    max_capture_queue_bytes: 30_720,
    output_frames: 13,
    p95_encode_ms: 0.0035,
    p95_resample_ms: 0.0028,
    p95_stdout_write_ms: 0.0349,
    p95_wakeup_interval_ms: 10.9183,
    raw_bytes: 387_840,
    session_id: "sess_test",
    target_pid: 27_444,
    window_ms: 1009.8286
  };
}
