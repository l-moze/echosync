import type { AsrLatencyMode, AsrProviderId } from "./asr-provider-catalog";
import type { TranslationProviderId } from "./translation-provider-catalog";

export type TtsProviderId = "disabled" | "edge-tts" | "elevenlabs";
export type AgentProviderStatus =
  | "ready"
  | "missing_key"
  | "missing_config"
  | "missing_dependency"
  | "unavailable";

export type AgentProviderCapability = {
  id: string;
  label: string;
  kind: "asr" | "translation" | "tts";
  status: AgentProviderStatus;
  available: boolean;
  default: boolean;
  reason: string;
  model: string;
};

export type AgentAsrProviderCapability = AgentProviderCapability & {
  id: AsrProviderId;
  kind: "asr";
  real_audio_supported: boolean;
};

export type AgentTranslationProviderCapability = AgentProviderCapability & {
  id: TranslationProviderId;
  kind: "translation";
};

export type AgentTtsProviderCapability = AgentProviderCapability & {
  id: TtsProviderId;
  kind: "tts";
};

export type AgentCapabilities = {
  service: "echosync-agent";
  defaults: {
    asr_provider: AsrProviderId;
    asr_latency_mode: AsrLatencyMode;
    translation_provider: TranslationProviderId;
    tts_provider: TtsProviderId;
    target_lang: string;
  };
  asr_latency_modes: AsrLatencyMode[];
  asr_providers: AgentAsrProviderCapability[];
  translation_providers: AgentTranslationProviderCapability[];
  tts_providers: AgentTtsProviderCapability[];
};

export function findAgentAsrProvider(capabilities: AgentCapabilities, providerId: AsrProviderId) {
  return capabilities.asr_providers.find((provider) => provider.id === providerId);
}

export function findAgentTranslationProvider(
  capabilities: AgentCapabilities,
  providerId: TranslationProviderId
) {
  return capabilities.translation_providers.find((provider) => provider.id === providerId);
}

export function findAgentTtsProvider(capabilities: AgentCapabilities, providerId: TtsProviderId) {
  return capabilities.tts_providers.find((provider) => provider.id === providerId);
}
