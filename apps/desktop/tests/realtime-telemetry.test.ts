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
        trace_id: "trace_demo",
        span_id: "translation:seg_demo:1",
        metrics: {
          asr_latency_ms: 80,
          asr_queue_wait_ms: 12,
          asr_stream_elapsed_ms: 900,
          asr_audio_lag_ms: 120,
          caption_send_failures: 0,
          caption_send_ms: 3,
          llm_delta_count: 4,
          llm_request_ms: 18,
          llm_stream_ms: 240,
          llm_ttft_ms: 110,
          translation_queue_wait_ms: 45,
          translation_first_token_ms: 120,
          translation_latency_ms: 180
        }
      },
      1755
    );

    expect(telemetry).toMatchObject({
      type: "translation.partial",
      sessionId: "sess_demo",
      segmentId: "seg_demo",
      status: "stable",
      traceId: "trace_demo",
      spanId: "translation:seg_demo:1",
      agentToRendererMs: 55,
      asrLatencyMs: 80,
      asrQueueWaitMs: 12,
      asrStreamElapsedMs: 900,
      asrAudioLagMs: 120,
      captionSendFailures: 0,
      captionSendMs: 3,
      llmDeltaCount: 4,
      llmRequestMs: 18,
      llmStreamMs: 240,
      llmTtftMs: 110,
      mergeWaitMs: undefined,
      translationQueueWaitMs: 45,
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

    expect(entries[0]?.[0]).toBe("caption_event_renderer_received");
    expect(entries[0]?.[1]).toMatchObject({
      type: "translation.partial",
      sessionId: "sess_demo",
      segmentId: "seg_demo",
      status: "stable",
      agentToRendererMs: 115,
      asrLatencyMs: undefined,
      mergeWaitMs: 40,
      translationFirstTokenMs: 95,
      translationLatencyMs: undefined
    });
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
        metrics: {
          tts_first_audio_ms: 180,
          tts_queue_wait_ms: 35,
          tts_total_ms: 420,
          tts_audio_chunks: 3,
          tts_audio_bytes: 12288
        },
        published_at_ms: 3000
      },
      3088
    );

    expect(telemetry).toMatchObject({
      type: "tts.audio",
      sessionId: "sess_voice",
      segmentId: "seg_voice",
      status: undefined,
      agentToRendererMs: 88,
      asrLatencyMs: undefined,
      mergeWaitMs: undefined,
      translationFirstTokenMs: undefined,
      translationLatencyMs: undefined,
      ttsFirstAudioMs: 180,
      ttsQueueWaitMs: 35,
      ttsTotalMs: 420,
      ttsAudioChunks: 3,
      ttsAudioBytes: 12288
    });
  });

  it("记录可复盘的字幕事件文本摘要、版本和时间窗", () => {
    const telemetry = buildRealtimeEventTelemetry(
      {
        type: "translation.partial",
        session_id: "sess_trace",
        segment_id: "seg_trace",
        rev: 7,
        source_lang: "en",
        target_lang: "zh-CN",
        source_text: "So for people who are not familiar with that, you can",
        target_text: "所以对于不熟悉这个的人来说，你可以",
        status: "stable",
        stability: 0.88,
        start_ms: 1800,
        end_ms: 3600,
        published_at_ms: 5000
      },
      5120
    );

    expect(telemetry).toMatchObject({
      endMs: 3600,
      revision: 7,
      sourcePreview: "So for people who are not familiar with that, you can",
      sourceTextLength: 53,
      startMs: 1800,
      targetPreview: "所以对于不熟悉这个的人来说，你可以",
      targetTextLength: 17
    });
  });

  it("记录 realtime.error 消息但不需要字幕文本", () => {
    const telemetry = buildRealtimeEventTelemetry(
      {
        type: "realtime.error",
        session_id: "sess_error",
        message: "Realtime pipeline cancelled after user stop",
        published_at_ms: 6000
      },
      6015
    );

    expect(telemetry).toMatchObject({
      agentToRendererMs: 15,
      message: "Realtime pipeline cancelled after user stop",
      sessionId: "sess_error",
      type: "realtime.error"
    });
  });

  it("记录 TTS 错误的供应商、错误码和非致命重试属性", () => {
    const telemetry = buildRealtimeEventTelemetry(
      {
        type: "tts.error",
        session_id: "sess_voice",
        segment_id: "seg_voice",
        rev: 4,
        start_ms: 1200,
        end_ms: 2400,
        target_lang: "zh-CN",
        provider: "ElevenLabsTtsSynthesizer",
        message: "ElevenLabs TTS failed: HTTP 404 voice_not_found",
        code: "tts.elevenlabs.voice_not_found",
        retryable: false,
        target_text: "你好，欢迎。",
        metrics: {
          tts_failed: 1,
          tts_total_ms: 95,
          tts_audio_chunks: 0,
          tts_audio_bytes: 0
        },
        published_at_ms: 7000
      },
      7042
    );

    expect(telemetry).toMatchObject({
      agentToRendererMs: 42,
      code: "tts.elevenlabs.voice_not_found",
      message: "ElevenLabs TTS failed: HTTP 404 voice_not_found",
      provider: "ElevenLabsTtsSynthesizer",
      retryable: false,
      sessionId: "sess_voice",
      segmentId: "seg_voice",
      targetPreview: "你好，欢迎。",
      ttsAudioChunks: 0,
      ttsFailed: 1,
      ttsTotalMs: 95,
      type: "tts.error"
    });
  });
});
