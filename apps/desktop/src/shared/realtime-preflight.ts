import type { DesktopAudioSourceId } from "./audio-source-catalog";
import { DESKTOP_AUDIO_SOURCES } from "./audio-source-catalog";
import type { AgentCapabilities } from "./agent-capabilities";
import { findAgentAsrProvider, findAgentTranslationProvider, findAgentTtsProvider } from "./agent-capabilities";
import type { AsrLatencyMode, AsrProviderSelection } from "./asr-provider-catalog";
import type { TtsProviderSelection } from "./tts-provider-catalog";
import { selectedTtsProviderId } from "./tts-provider-catalog";
import type { TranslationProviderSelection } from "./translation-provider-catalog";
import { selectedTranslationProviderId } from "./translation-provider-catalog";

export type RealtimePreflightInput = {
  asrLatencyMode: AsrLatencyMode;
  asrProvider: AsrProviderSelection;
  capabilities: AgentCapabilities | null;
  sourceId: DesktopAudioSourceId;
  ttsProvider: TtsProviderSelection;
  translationProvider: TranslationProviderSelection;
};

export function validateRealtimePreflight({
  asrLatencyMode,
  asrProvider,
  capabilities,
  sourceId,
  ttsProvider,
  translationProvider
}: RealtimePreflightInput): string | null {
  if (sourceId === "mixed" || sourceId === "file") {
    return "混音和文件回放入口尚未完整接入，请先使用 Windows 系统声音或麦克风。";
  }
  if (!capabilities) {
    return "无法读取同传服务能力信息，请确认 8766 实时字幕服务已启动。";
  }
  if (!capabilities.asr_latency_modes.includes(asrLatencyMode)) {
    return `同传服务不支持当前延迟模式：${asrLatencyMode}`;
  }

  const resolvedAsrProvider = asrProvider === "server-default" ? capabilities.defaults.asr_provider : asrProvider;
  const asrCapability = findAgentAsrProvider(capabilities, resolvedAsrProvider);
  if (!asrCapability) {
    return `同传服务不支持当前语音识别方案：${resolvedAsrProvider}`;
  }
  if (!asrCapability.real_audio_supported) {
    return "当前调试识别方案不能处理 Windows 或麦克风这类真实音频。";
  }
  if (!asrCapability.available) {
    return asrCapability.reason || `${asrCapability.label} 当前不可用。`;
  }

  const explicitTranslationProvider = selectedTranslationProviderId(translationProvider);
  const resolvedTranslationProvider =
    explicitTranslationProvider ?? capabilities.defaults.translation_provider;
  const translationCapability = findAgentTranslationProvider(capabilities, resolvedTranslationProvider);
  if (!translationCapability) {
    return `同传服务不支持当前翻译方案：${resolvedTranslationProvider}`;
  }
  if (!translationCapability.available) {
    return translationCapability.reason || `${translationCapability.label} 当前不可用。`;
  }

  const explicitTtsProvider = selectedTtsProviderId(ttsProvider);
  const resolvedTtsProvider = explicitTtsProvider ?? capabilities.defaults.tts_provider;
  const source = DESKTOP_AUDIO_SOURCES.find((item) => item.id === sourceId);
  const systemCaptureExcludesSelf = Boolean(source?.capabilities.includes("exclude-self"));
  if (sourceId === "windows-system" && resolvedTtsProvider !== "disabled" && !systemCaptureExcludesSelf) {
    return "安全限制：Windows 系统声音采集会包含扬声器输出，不能同时启用语音播报（TTS）。请将语音播报设为“关闭”，或改用麦克风输入。";
  }
  const ttsCapability = findAgentTtsProvider(capabilities, resolvedTtsProvider);
  if (!ttsCapability) {
    return `同传服务不支持当前语音播报方案：${resolvedTtsProvider}`;
  }
  if (!ttsCapability.available) {
    return ttsCapability.reason || `${ttsCapability.label} 当前不可用。`;
  }

  return null;
}
