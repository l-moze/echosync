import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createWasapiDiagnosticLogGateState,
  createAudioStartMessage,
  decideWasapiDiagnosticLog,
  parseLengthPrefixedPackets,
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
