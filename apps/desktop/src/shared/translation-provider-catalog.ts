export type TranslationProviderId = "mock" | "deepseek" | "deepl" | "qwen-livetranslate";
export type TranslationProviderSelection = "server-default" | TranslationProviderId;

export type TranslationProviderOption = {
  id: TranslationProviderSelection;
  label: string;
  description: string;
  providerId?: TranslationProviderId;
};

export const TRANSLATION_PROVIDER_OPTIONS: TranslationProviderOption[] = [
  {
    id: "server-default",
    label: "通用模型",
    description: "使用 Agent 后端默认配置"
  },
  {
    id: "deepseek",
    label: "DeepSeek-V3",
    description: "低延迟流式翻译",
    providerId: "deepseek"
  },
  {
    id: "deepl",
    label: "DeepL",
    description: "批量请求专用翻译",
    providerId: "deepl"
  },
  {
    id: "qwen-livetranslate",
    label: "Qwen 端到端同传",
    description: "阿里云音频直译，默认用识别模型补原文",
    providerId: "qwen-livetranslate"
  },
  {
    id: "mock",
    label: "调试 Mock",
    description: "本地事件链路测试",
    providerId: "mock"
  }
];

export function selectedTranslationProviderId(
  selection: TranslationProviderSelection
): TranslationProviderId | undefined {
  if (selection === "server-default") {
    return undefined;
  }
  return selection;
}

export function translationProviderLabel(
  selection: TranslationProviderSelection,
  defaultProvider?: TranslationProviderId
): string {
  if (selection === "server-default" && defaultProvider) {
    return `通用模型 (${providerName(defaultProvider)})`;
  }
  return (
    TRANSLATION_PROVIDER_OPTIONS.find((option) => option.id === selection)?.label ??
    TRANSLATION_PROVIDER_OPTIONS[0].label
  );
}

function providerName(provider: TranslationProviderId): string {
  return TRANSLATION_PROVIDER_OPTIONS.find((option) => option.providerId === provider)?.label ?? provider;
}
