import { describe, expect, it } from "vitest";

import { buildRealtimeEventTelemetry, logRealtimeEventTelemetry } from "../src/shared/realtime-telemetry";

describe("实时事件遥测", () => {
  it("计算 Agent 发布到 renderer 接收的延迟并保留模型指标", () => {
    const telemetry = buildRealtimeEventTelemetry(
      {
        type: "translation.partial",
        session_id: "sess_demo",
        segment_id: "seg_demo",
        rev: 1,
        source_lang: "en",
        target_lang: "zh-CN",
        source_text: "Hello",
        target_text: "你好",
        status: "stable",
        stability: 0.9,
        start_ms: 0,
        end_ms: 1000,
        published_at_ms: 1700,
        metrics: {
          asr_latency_ms: 80,
          translation_first_token_ms: 120,
          translation_latency_ms: 180
        }
      },
      1755
    );

    expect(telemetry).toEqual({
      type: "translation.partial",
      sessionId: "sess_demo",
      segmentId: "seg_demo",
      status: "stable",
      agentToRendererMs: 55,
      asrLatencyMs: 80,
      mergeWaitMs: undefined,
      translationFirstTokenMs: 120,
      translationLatencyMs: 180
    });
  });

  it("通过注入的成熟日志器记录 renderer 接收延迟", () => {
    const entries: unknown[][] = [];
    const logger = {
      debug: (...params: unknown[]) => entries.push(params)
    };

    logRealtimeEventTelemetry(
      logger,
      {
        type: "translation.partial",
        session_id: "sess_demo",
        segment_id: "seg_demo",
        rev: 2,
        source_lang: "en",
        target_lang: "zh-CN",
        source_text: "Hello world",
        target_text: "你好世界",
        status: "stable",
        stability: 0.92,
        start_ms: 0,
        end_ms: 1200,
        published_at_ms: 2000,
        metrics: {
          merge_wait_ms: 40,
          translation_first_token_ms: 95
        }
      },
      2115
    );

    expect(entries).toEqual([
      [
        "caption_event_renderer_received",
        {
          type: "translation.partial",
          sessionId: "sess_demo",
          segmentId: "seg_demo",
          status: "stable",
          agentToRendererMs: 115,
          asrLatencyMs: undefined,
          mergeWaitMs: 40,
          translationFirstTokenMs: 95,
          translationLatencyMs: undefined
        }
      ]
    ]);
  });

  it("记录 TTS 音频事件的到达延迟和分段信息", () => {
    const telemetry = buildRealtimeEventTelemetry(
      {
        type: "tts.audio",
        session_id: "sess_voice",
        segment_id: "seg_voice",
        rev: 1,
        start_ms: 1200,
        end_ms: 2400,
        target_lang: "zh-CN",
        audio_base64: "YXVkaW8=",
        mime_type: "audio/mpeg",
        sample_rate: null,
        final: true,
        published_at_ms: 3000
      },
      3088
    );

    expect(telemetry).toEqual({
      type: "tts.audio",
      sessionId: "sess_voice",
      segmentId: "seg_voice",
      status: undefined,
      agentToRendererMs: 88,
      asrLatencyMs: undefined,
      mergeWaitMs: undefined,
      translationFirstTokenMs: undefined,
      translationLatencyMs: undefined
    });
  });
});
