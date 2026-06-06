import type { DesktopAudioSourceId } from "./audio-source-catalog";
import type { AgentCapabilities } from "./agent-capabilities";
import { findAgentAsrProvider, findAgentTranslationProvider } from "./agent-capabilities";
import type { AsrLatencyMode, AsrProviderSelection } from "./asr-provider-catalog";
import type { TranslationProviderSelection } from "./translation-provider-catalog";
import { selectedTranslationProviderId } from "./translation-provider-catalog";

export type RealtimePreflightInput = {
  asrLatencyMode: AsrLatencyMode;
  asrProvider: AsrProviderSelection;
  capabilities: AgentCapabilities | null;
  sourceId: DesktopAudioSourceId;
  translationProvider: TranslationProviderSelection;
};

export function validateRealtimePreflight({
  asrLatencyMode,
  asrProvider,
  capabilities,
  sourceId,
  translationProvider
}: RealtimePreflightInput): string | null {
  if (sourceId === "mixed" || sourceId === "file") {
    return "混音和文件回放入口尚未完整接入，请先使用 Windows 系统声音或麦克风。";
  }
  if (!capabilities) {
    return "无法读取 Agent 能力信息，请确认 8766 实时字幕服务已启动。";
  }
  if (!capabilities.asr_latency_modes.includes(asrLatencyMode)) {
    return `Agent 不支持 ASR 延迟模式：${asrLatencyMode}`;
  }

  const resolvedAsrProvider = asrProvider === "server-default" ? capabilities.defaults.asr_provider : asrProvider;
  const asrCapability = findAgentAsrProvider(capabilities, resolvedAsrProvider);
  if (!asrCapability) {
    return `Agent 不支持 ASR provider：${resolvedAsrProvider}`;
  }
  if (!asrCapability.real_audio_supported) {
    return "当前是 mock ASR，不能处理 Windows/麦克风这类真实音频。";
  }
  if (!asrCapability.available) {
    return asrCapability.reason || `${asrCapability.label} 当前不可用。`;
  }

  const explicitTranslationProvider = selectedTranslationProviderId(translationProvider);
  const resolvedTranslationProvider =
    explicitTranslationProvider ?? capabilities.defaults.translation_provider;
  const translationCapability = findAgentTranslationProvider(capabilities, resolvedTranslationProvider);
  if (!translationCapability) {
    return `Agent 不支持翻译 provider：${resolvedTranslationProvider}`;
  }
  if (!translationCapability.available) {
    return translationCapability.reason || `${translationCapability.label} 当前不可用。`;
  }

  return null;
}
