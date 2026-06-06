import { describe, expect, it } from "vitest";

import type { AgentCapabilities } from "../src/shared/agent-capabilities";
import { validateRealtimePreflight } from "../src/shared/realtime-preflight";

describe("实时同传启动预检", () => {
  it("阻止 mock ASR 处理真实 Windows 系统声音", () => {
    const message = validateRealtimePreflight({
      asrLatencyMode: "balanced",
      asrProvider: "server-default",
      capabilities: capabilities({
        defaultAsrProvider: "mock"
      }),
      sourceId: "windows-system",
      translationProvider: "server-default"
    });

    expect(message).toContain("mock ASR");
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
      translationProvider: "server-default"
    });

    expect(message).toContain("MISTRAL_API_KEY");
  });

  it("阻止缺少密钥的 DeepSeek 翻译会话", () => {
    const message = validateRealtimePreflight({
      asrLatencyMode: "balanced",
      asrProvider: "funasr",
      capabilities: capabilities({
        deepseekStatus: "missing_key"
      }),
      sourceId: "windows-system",
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
      translationProvider: "mock"
    });
    const file = validateRealtimePreflight({
      asrLatencyMode: "balanced",
      asrProvider: "funasr",
      capabilities: capabilities({}),
      sourceId: "file",
      translationProvider: "mock"
    });

    expect(mixed).toContain("尚未完整接入");
    expect(file).toContain("尚未完整接入");
  });

  it("允许可用 ASR 和翻译 provider 处理真实音频", () => {
    const message = validateRealtimePreflight({
      asrLatencyMode: "balanced",
      asrProvider: "funasr",
      capabilities: capabilities({}),
      sourceId: "windows-system",
      translationProvider: "mock"
    });

    expect(message).toBeNull();
  });

  it("阻止后端不支持的 ASR 延迟模式", () => {
    const message = validateRealtimePreflight({
      asrLatencyMode: "accuracy",
      asrProvider: "funasr",
      capabilities: capabilities({
        asrLatencyModes: ["low_latency", "balanced"]
      }),
      sourceId: "windows-system",
      translationProvider: "mock"
    });

    expect(message).toContain("ASR 延迟模式");
  });
});

function capabilities({
  asrLatencyModes = ["low_latency", "balanced", "accuracy"],
  deepseekStatus = "ready",
  defaultAsrProvider = "funasr",
  voxtralStatus = "ready"
}: {
  asrLatencyModes?: AgentCapabilities["asr_latency_modes"];
  deepseekStatus?: "ready" | "missing_key" | "missing_dependency" | "unavailable";
  defaultAsrProvider?: "mock" | "funasr" | "voxtral";
  voxtralStatus?: "ready" | "missing_key" | "missing_dependency" | "unavailable";
}): AgentCapabilities {
  return {
    service: "echosync-agent",
    defaults: {
      asr_latency_mode: "balanced",
      asr_provider: defaultAsrProvider,
      target_lang: "zh-CN",
      translation_provider: "mock"
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
    ]
  };
}
