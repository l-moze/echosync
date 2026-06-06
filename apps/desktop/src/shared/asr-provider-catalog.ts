export type AsrProviderId = "mock" | "funasr" | "voxtral";
export type AsrProviderSelection = "server-default" | AsrProviderId;
export type AsrLatencyMode = "low_latency" | "balanced" | "accuracy";

export type AsrProviderOption = {
  id: AsrProviderSelection;
  label: string;
  description: string;
  providerId?: AsrProviderId;
};

export type AsrLatencyOption = {
  id: AsrLatencyMode;
  label: string;
  description: string;
};

export const ASR_PROVIDER_OPTIONS: AsrProviderOption[] = [
  {
    id: "server-default",
    label: "后端默认",
    description: "使用 Agent .env 配置"
  },
  {
    id: "funasr",
    label: "FunASR",
    description: "本地流式识别",
    providerId: "funasr"
  },
  {
    id: "voxtral",
    label: "Voxtral",
    description: "云端低延迟识别",
    providerId: "voxtral"
  },
  {
    id: "mock",
    label: "调试 Mock",
    description: "只用于事件演示",
    providerId: "mock"
  }
];

export const ASR_LATENCY_OPTIONS: AsrLatencyOption[] = [
  {
    id: "low_latency",
    label: "低延迟",
    description: "优先跟上直播节奏"
  },
  {
    id: "balanced",
    label: "均衡",
    description: "延迟和稳定度折中"
  },
  {
    id: "accuracy",
    label: "高准确",
    description: "允许更多等待"
  }
];

export function selectedAsrProviderId(selection: AsrProviderSelection): AsrProviderId | undefined {
  if (selection === "server-default") {
    return undefined;
  }
  return selection;
}

export function asrProviderLabel(
  selection: AsrProviderSelection,
  defaultProvider?: AsrProviderId
): string {
  if (selection === "server-default" && defaultProvider) {
    return `后端默认 (${providerName(defaultProvider)})`;
  }
  return ASR_PROVIDER_OPTIONS.find((option) => option.id === selection)?.label ?? ASR_PROVIDER_OPTIONS[0].label;
}

export function asrLatencyModeLabel(mode: AsrLatencyMode): string {
  return ASR_LATENCY_OPTIONS.find((option) => option.id === mode)?.label ?? mode;
}

function providerName(provider: AsrProviderId): string {
  return ASR_PROVIDER_OPTIONS.find((option) => option.providerId === provider)?.label ?? provider;
}
