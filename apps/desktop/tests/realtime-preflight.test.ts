import { describe, expect, it } from "vitest";

import type { AgentCapabilities } from "../src/shared/agent-capabilities";
import { validateRealtimePreflight } from "../src/shared/realtime-preflight";

describe("实时同传启动预检", () => {
  it("阻止调试识别方案处理真实 Windows 系统声音", () => {
    const message = validateRealtimePreflight({
      asrLatencyMode: "balanced",
      asrProvider: "server-default",
      capabilities: capabilities({
        defaultAsrProvider: "mock"
      }),
      sourceId: "windows-system",
      ttsProvider: "server-default",
      translationProvider: "server-default"
    });

    expect(message).toContain("调试识别方案");
    expect(message).toContain("真实音频");
  });

  it("阻止缺少密钥的 Voxtral 会话", () => {
    const message = validateRealtimePreflight({
      asrLatencyMode: "balanced",
      asrProvider: "voxtral",
      capabilities: capabilities({
        voxtralStatus: "missing_key"
      }),
      sourceId: "windows-system",
      ttsProvider: "server-default",
      translationProvider: "server-default"
    });

    expect(message).toContain("MISTRAL_API_KEY");
  });

  it("阻止缺少密钥的 Deepgram 会话", () => {
    const message = validateRealtimePreflight({
      asrLatencyMode: "balanced",
      asrProvider: "deepgram",
      capabilities: capabilities({
        deepgramStatus: "missing_key"
      }),
      sourceId: "windows-system",
      ttsProvider: "server-default",
      translationProvider: "server-default"
    });

    expect(message).toContain("DEEPGRAM_API_KEY");
  });

  it("阻止缺少密钥的 DeepSeek 翻译会话", () => {
    const message = validateRealtimePreflight({
      asrLatencyMode: "balanced",
      asrProvider: "funasr",
      capabilities: capabilities({
        deepseekStatus: "missing_key"
      }),
      sourceId: "windows-system",
      ttsProvider: "server-default",
      translationProvider: "deepseek"
    });

    expect(message).toContain("DEEPSEEK_API_KEY");
  });

  it("阻止尚未完整接入的混音和文件源", () => {
    const mixed = validateRealtimePreflight({
      asrLatencyMode: "balanced",
      asrProvider: "funasr",
      capabilities: capabilities({}),
      sourceId: "mixed",
      ttsProvider: "server-default",
      translationProvider: "mock"
    });
    const file = validateRealtimePreflight({
      asrLatencyMode: "balanced",
      asrProvider: "funasr",
      capabilities: capabilities({}),
      sourceId: "file",
      ttsProvider: "server-default",
      translationProvider: "mock"
    });

    expect(mixed).toContain("尚未完整接入");
    expect(file).toContain("尚未完整接入");
  });

  it("允许可用识别和翻译方案处理真实音频", () => {
    const message = validateRealtimePreflight({
      asrLatencyMode: "balanced",
      asrProvider: "funasr",
      capabilities: capabilities({}),
      sourceId: "windows-system",
      ttsProvider: "disabled",
      translationProvider: "mock"
    });

    expect(message).toBeNull();
  });

  it("阻止后端不支持的延迟模式", () => {
    const message = validateRealtimePreflight({
      asrLatencyMode: "accuracy",
      asrProvider: "funasr",
      capabilities: capabilities({
        asrLatencyModes: ["low_latency", "balanced"]
      }),
      sourceId: "windows-system",
      ttsProvider: "server-default",
      translationProvider: "mock"
    });

    expect(message).toContain("当前延迟模式");
  });

  it("阻止缺少配置的 ElevenLabs 语音播报会话", () => {
    const message = validateRealtimePreflight({
      asrLatencyMode: "balanced",
      asrProvider: "funasr",
      capabilities: capabilities({
        elevenLabsTtsStatus: "missing_config"
      }),
      sourceId: "windows-system",
      ttsProvider: "elevenlabs",
      translationProvider: "mock"
    });

    expect(message).toContain("ELEVENLABS_VOICE_ID");
  });

  it("允许显式关闭不可用的后端默认语音播报", () => {
    const message = validateRealtimePreflight({
      asrLatencyMode: "balanced",
      asrProvider: "funasr",
      capabilities: capabilities({
        defaultTtsProvider: "elevenlabs",
        elevenLabsTtsStatus: "missing_key"
      }),
      sourceId: "windows-system",
      ttsProvider: "disabled",
      translationProvider: "mock"
    });

    expect(message).toBeNull();
  });
});

function capabilities({
  asrLatencyModes = ["low_latency", "balanced", "accuracy"],
  deepseekStatus = "ready",
  deepgramStatus = "ready",
  defaultAsrProvider = "funasr",
  defaultTtsProvider = "disabled",
  elevenLabsTtsStatus = "missing_key",
  voxtralStatus = "ready"
}: {
  asrLatencyModes?: AgentCapabilities["asr_latency_modes"];
  deepseekStatus?: "ready" | "missing_key" | "missing_dependency" | "unavailable";
  deepgramStatus?: "ready" | "missing_key" | "missing_dependency" | "unavailable";
  defaultAsrProvider?: "mock" | "funasr" | "voxtral" | "deepgram";
  defaultTtsProvider?: "disabled" | "edge-tts" | "elevenlabs";
  elevenLabsTtsStatus?: "ready" | "missing_key" | "missing_config" | "unavailable";
  voxtralStatus?: "ready" | "missing_key" | "missing_dependency" | "unavailable";
}): AgentCapabilities {
  return {
    service: "echosync-agent",
    defaults: {
      asr_latency_mode: "balanced",
      asr_provider: defaultAsrProvider,
      target_lang: "zh-CN",
      translation_provider: "mock",
      tts_provider: defaultTtsProvider
    },
    asr_latency_modes: asrLatencyModes,
    asr_providers: [
      {
        available: true,
        default: defaultAsrProvider === "mock",
        id: "mock",
        kind: "asr",
        label: "调试 Mock",
        model: "mock",
        real_audio_supported: false,
        reason: "只用于事件链路演示。",
        status: "ready"
      },
      {
        available: true,
        default: defaultAsrProvider === "funasr",
        id: "funasr",
        kind: "asr",
        label: "FunASR 本地",
        model: "paraformer-zh-streaming",
        real_audio_supported: true,
        reason: "",
        status: "ready"
      },
      {
        available: voxtralStatus === "ready",
        default: defaultAsrProvider === "voxtral",
        id: "voxtral",
        kind: "asr",
        label: "Voxtral Realtime",
        model: "voxtral-mini-transcribe-realtime-2602",
        real_audio_supported: true,
        reason: voxtralStatus === "missing_key" ? "缺少 MISTRAL_API_KEY。" : "",
        status: voxtralStatus
      },
      {
        available: deepgramStatus === "ready",
        default: defaultAsrProvider === "deepgram",
        id: "deepgram",
        kind: "asr",
        label: "Deepgram",
        model: "nova-3",
        real_audio_supported: true,
        reason: deepgramStatus === "missing_key" ? "缺少 DEEPGRAM_API_KEY。" : "",
        status: deepgramStatus
      }
    ],
    translation_providers: [
      {
        available: true,
        default: true,
        id: "mock",
        kind: "translation",
        label: "调试 Mock",
        model: "mock",
        reason: "只用于事件链路演示。",
        status: "ready"
      },
      {
        available: deepseekStatus === "ready",
        default: false,
        id: "deepseek",
        kind: "translation",
        label: "DeepSeek-V3",
        model: "deepseek-chat",
        reason: deepseekStatus === "missing_key" ? "缺少 DEEPSEEK_API_KEY。" : "",
        status: deepseekStatus
      }
    ],
    tts_providers: [
      {
        available: true,
        default: defaultTtsProvider === "disabled",
        id: "disabled",
        kind: "tts",
        label: "关闭",
        model: "none",
        reason: "字幕优先链路默认不启用语音播报。",
        status: "ready"
      },
      {
        available: true,
        default: defaultTtsProvider === "edge-tts",
        id: "edge-tts",
        kind: "tts",
        label: "Edge TTS",
        model: "zh-CN-XiaoxiaoNeural",
        reason: "",
        status: "ready"
      },
      {
        available: elevenLabsTtsStatus === "ready",
        default: defaultTtsProvider === "elevenlabs",
        id: "elevenlabs",
        kind: "tts",
        label: "ElevenLabs",
        model: "eleven_multilingual_v2",
        reason:
          elevenLabsTtsStatus === "missing_config"
            ? "缺少 ELEVENLABS_VOICE_ID。"
            : elevenLabsTtsStatus === "missing_key"
              ? "缺少 ELEVENLABS_API_KEY。"
              : "",
        status: elevenLabsTtsStatus
      }
    ]
  };
}
