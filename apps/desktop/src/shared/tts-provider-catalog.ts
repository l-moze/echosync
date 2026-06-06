import type { TtsProviderId } from "./agent-capabilities";

export type TtsProviderSelection = "server-default" | TtsProviderId;

export type TtsProviderOption = {
  id: TtsProviderSelection;
  label: string;
  description: string;
  providerId?: TtsProviderId;
};

export const TTS_PROVIDER_OPTIONS: TtsProviderOption[] = [
  {
    id: "server-default",
    label: "自动",
    description: "使用 Agent 后端默认配置"
  },
  {
    id: "disabled",
    label: "关闭",
    description: "只显示字幕，不播放译文语音",
    providerId: "disabled"
  },
  {
    id: "edge-tts",
    label: "Edge 语音",
    description: "使用 Edge 在线语音播报译文",
    providerId: "edge-tts"
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    description: "使用 ElevenLabs 多语言语音播报译文",
    providerId: "elevenlabs"
  }
];

export function selectedTtsProviderId(selection: TtsProviderSelection): TtsProviderId | undefined {
  if (selection === "server-default") {
    return undefined;
  }
  return selection;
}

export function ttsProviderLabel(
  selection: TtsProviderSelection,
  defaultProvider?: TtsProviderId
): string {
  if (selection === "server-default" && defaultProvider) {
    return `自动 (${providerName(defaultProvider)})`;
  }
  return TTS_PROVIDER_OPTIONS.find((option) => option.id === selection)?.label ?? TTS_PROVIDER_OPTIONS[0].label;
}

function providerName(provider: TtsProviderId): string {
  return TTS_PROVIDER_OPTIONS.find((option) => option.providerId === provider)?.label ?? provider;
}
