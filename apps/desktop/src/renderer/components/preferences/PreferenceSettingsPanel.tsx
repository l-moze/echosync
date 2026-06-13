import { useState } from "react";

import {
  findAgentAsrProvider,
  findAgentTranslationProvider,
  findAgentTtsProvider,
  type AgentCapabilities
} from "../../../shared/agent-capabilities";
import {
  ASR_LATENCY_OPTIONS,
  ASR_PROVIDER_OPTIONS,
  asrLatencyModeLabel,
  asrProviderLabel,
  type AsrLatencyMode,
  type AsrProviderSelection
} from "../../../shared/asr-provider-catalog";
import type { DesktopAudioSource } from "../../../shared/audio-source-catalog";
import {
  PREFERENCE_ADVANCED_ENTRY,
  PREFERENCE_SETTINGS_NAV
} from "../../../shared/home-launcher-copy";
import {
  selectedTranslationProviderId,
  TRANSLATION_PROVIDER_OPTIONS,
  translationProviderLabel,
  type TranslationProviderId,
  type TranslationProviderSelection
} from "../../../shared/translation-provider-catalog";
import {
  TTS_PROVIDER_OPTIONS,
  ttsProviderLabel,
  type TtsProviderSelection
} from "../../../shared/tts-provider-catalog";
import { PreferenceRow } from "../common/PreferenceRow";
import { PreferenceMiniCard } from "../home/PreferenceMiniCard";
import { engineOptionLabel } from "../../utils/labels";
import type { LanguageDirectionOption } from "../../types/language";

export function PreferenceSettingsPanel({
  agentCapabilities,
  asrLatencyMode,
  asrProvider,
  currentSource,
  endToEndSourceBackfill,
  isOpen,
  languageDirection,
  onAsrLatencyModeSelect,
  onAsrProviderSelect,
  onClose,
  onEndToEndSourceBackfillSelect,
  onTranslationProviderSelect,
  onTtsProviderSelect,
  translationProvider,
  ttsProvider
}: {
  agentCapabilities: AgentCapabilities | null;
  asrLatencyMode: AsrLatencyMode;
  asrProvider: AsrProviderSelection;
  currentSource: DesktopAudioSource;
  endToEndSourceBackfill: boolean;
  isOpen: boolean;
  languageDirection: LanguageDirectionOption;
  onAsrLatencyModeSelect: (mode: AsrLatencyMode) => void;
  onAsrProviderSelect: (provider: AsrProviderSelection) => void;
  onClose: () => void;
  onEndToEndSourceBackfillSelect: (enabled: boolean) => void;
  onTranslationProviderSelect: (provider: TranslationProviderSelection) => void;
  onTtsProviderSelect: (provider: TtsProviderSelection) => void;
  translationProvider: TranslationProviderSelection;
  ttsProvider: TtsProviderSelection;
}) {
  const [activeSection, setActiveSection] = useState<(typeof PREFERENCE_SETTINGS_NAV)[number]["id"]>("general");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [terminologyFileName, setTerminologyFileName] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const asrOptions = ASR_PROVIDER_OPTIONS.filter((provider) => provider.id !== "mock");
  const translationOptions = TRANSLATION_PROVIDER_OPTIONS.filter((provider) => provider.id !== "mock");
  const ttsOptions = TTS_PROVIDER_OPTIONS;
  const asrStatus = asrProviderLabel(asrProvider, agentCapabilities?.defaults.asr_provider).replace("后端默认", "自动");
  const translationStatus = translationProviderLabel(
    translationProvider,
    agentCapabilities?.defaults.translation_provider
  ).replace("通用模型", "自动");
  const ttsStatus = ttsProviderLabel(ttsProvider, agentCapabilities?.defaults.tts_provider);
  const providerChoiceState = {
    asr: (providerId: typeof asrOptions[number]["providerId"], fallbackDescription: string) => {
      if (!providerId || !agentCapabilities) {
        return { description: fallbackDescription, disabled: false };
      }
      const provider = findAgentAsrProvider(agentCapabilities, providerId);
      return {
        description:
          provider?.real_audio_supported === false
            ? "当前调试识别方案不能处理真实音频。"
            : provider?.reason || fallbackDescription,
        disabled: provider ? !provider.available || !provider.real_audio_supported : true
      };
    },
    translation: (
      providerId: typeof translationOptions[number]["providerId"],
      fallbackDescription: string
    ) => {
      if (!providerId || !agentCapabilities) {
        return { description: fallbackDescription, disabled: false };
      }
      const provider = findAgentTranslationProvider(agentCapabilities, providerId);
      return {
        description: provider?.reason || fallbackDescription,
        disabled: provider ? !provider.available : true
      };
    },
    tts: (providerId: typeof ttsOptions[number]["providerId"], fallbackDescription: string) => {
      if (!providerId || !agentCapabilities) {
        return { description: fallbackDescription, disabled: false };
      }
      const provider = findAgentTtsProvider(agentCapabilities, providerId);
      return {
        description: provider?.reason || fallbackDescription,
        disabled: provider ? !provider.available : true
      };
    }
  };

  return (
    <aside className="engineSettingsPanel preferenceSettingsPanel" aria-label="偏好设置">
      <header>
        <div>
          <p>设置</p>
          <h2>偏好设置</h2>
        </div>
        <button aria-label="关闭偏好设置" onClick={onClose}>×</button>
      </header>
      <nav aria-label="设置分组">
        {PREFERENCE_SETTINGS_NAV.map((item) => (
          <button
            className={item.id === activeSection ? "selected" : ""}
            key={item.id}
            onClick={() => setActiveSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {activeSection === "general" ? (
        <section className="engineSettingsGroup">
          <h3>常规</h3>
          <PreferenceRow label="默认音频源" value={currentSource.label} />
          <PreferenceRow label="默认语言方向" value={languageDirection.label} />
          <PreferenceRow label="默认同传节奏" value={asrLatencyModeLabel(asrLatencyMode)} />
          <div className="choiceGroup qualityGroup">
            {ASR_LATENCY_OPTIONS.map((mode) => (
              <button
                className={mode.id === asrLatencyMode ? "selected" : ""}
                key={mode.id}
                onClick={() => onAsrLatencyModeSelect(mode.id)}
                title={mode.description}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <PreferenceRow label="启动时打开字幕窗" value="开启" />
        </section>
      ) : null}
      {activeSection === "models" ? (
        <section className="engineSettingsGroup">
          <div className="settingsSectionLead">
            <h3>模型方案</h3>
            <p>把识别、翻译和播报拆成可扫描的方案，后续可以扩展多套翻译模型。</p>
          </div>
          <div className="modelPlanGrid" aria-label="模型方案">
            <PreferenceMiniCard
              label="当前方案"
              title={translationStatus}
              values={[`识别 ${asrStatus}`, `播报 ${ttsStatus}`]}
            />
            <PreferenceMiniCard
              label="预留方案"
              title="GPT-4o 翻译"
              values={["会议长上下文", "等待接口接入"]}
            />
          </div>
          <EngineChoiceRow
            label="语音识别"
            options={asrOptions.map((option) => {
              const providerId = option.providerId ?? agentCapabilities?.defaults.asr_provider;
              const choiceState = providerChoiceState.asr(providerId, option.description);
              return {
                id: option.id,
                description: choiceState.description,
                disabled: choiceState.disabled,
                label: engineOptionLabel(option.label, option.id),
                selected: option.id === asrProvider,
                onSelect: () => onAsrProviderSelect(option.id)
              };
            })}
            status={asrStatus}
          />
          <EngineChoiceRow
            label="翻译模型"
            options={translationOptions.map((option) => {
              const providerId = option.providerId ?? agentCapabilities?.defaults.translation_provider;
              const choiceState = providerChoiceState.translation(providerId, option.description);
              return {
                id: option.id,
                description: choiceState.description,
                disabled: choiceState.disabled,
                label: engineOptionLabel(option.label, option.id),
                selected: option.id === translationProvider,
                onSelect: () => onTranslationProviderSelect(option.id)
              };
            })}
            status={translationStatus}
          />
          <EngineChoiceRow
            label="端到端补原文"
            options={[
              {
                id: "on",
                description: "Qwen 端到端同传输出译文，同时用当前识别模型补原文，支持双语显示。",
                disabled: !isEndToEndTranslationSelected(translationProvider, agentCapabilities?.defaults.translation_provider),
                label: "开",
                selected: endToEndSourceBackfill,
                onSelect: () => onEndToEndSourceBackfillSelect(true)
              },
              {
                id: "off",
                description: "只运行端到端同传译文链路，降低成本；原文/双语可能为空。",
                disabled: !isEndToEndTranslationSelected(translationProvider, agentCapabilities?.defaults.translation_provider),
                label: "关",
                selected: !endToEndSourceBackfill,
                onSelect: () => onEndToEndSourceBackfillSelect(false)
              }
            ]}
            status={endToEndSourceBackfill ? "开启" : "关闭"}
          />
          <EngineChoiceRow
            label="语音播报"
            options={ttsOptions.map((option) => {
              const providerId = option.providerId ?? agentCapabilities?.defaults.tts_provider;
              const choiceState = providerChoiceState.tts(providerId, option.description);
              return {
                id: option.id,
                description: choiceState.description,
                disabled: choiceState.disabled,
                label: engineOptionLabel(option.label, option.id),
                selected: option.id === ttsProvider,
                onSelect: () => onTtsProviderSelect(option.id)
              };
            })}
            status={ttsStatus}
          />
        </section>
      ) : null}
      {activeSection === "terminology" ? (
        <section className="engineSettingsGroup">
          <section className="terminologyImportPanel">
            <div>
              <h4>术语库</h4>
              <p>导入会议、产品、品牌或行业词汇，翻译模型优先采用这些固定表达。</p>
            </div>
            <label className="terminologyImportButton">
              导入术语
              <input
                accept=".csv,.txt,.json"
                aria-label="导入术语文件"
                onChange={(event) => setTerminologyFileName(event.currentTarget.files?.[0]?.name ?? null)}
                type="file"
              />
            </label>
          </section>
          <div className="terminologyStatusLine">
            <span>{terminologyFileName ? `已选择 ${terminologyFileName}` : "支持 CSV、TXT、JSON，推荐一行一个术语或术语对。"}</span>
          </div>
          <div className="terminologyFormats" aria-label="术语导入格式">
            <span>产品名 → 固定译名</span>
            <span>缩写 → 完整解释</span>
            <span>禁译词 → 原样保留</span>
          </div>
        </section>
      ) : null}
      {activeSection === "captions" ? (
        <section className="engineSettingsGroup">
          <div className="settingsSectionLead">
            <h3>字幕窗口</h3>
            <p>字幕窗口只管理显示体验，不承载模型、日志或接口配置。</p>
          </div>
          <PreferenceRow label="默认显示模式" value="逐句对照" />
          <PreferenceRow label="分区对照" value="上下独立滚动" />
          <PreferenceRow label="字幕选中" value="禁止选中文本" />
          <PreferenceRow label="悬浮栏收起" value="延迟淡出" />
          <PreferenceRow label="字号与透明度" value="在字幕窗设置" />
        </section>
      ) : null}
      {activeSection === "privacy" ? (
        <section className="engineSettingsGroup">
          <h3>记录与隐私</h3>
          <PreferenceRow label="保存原始音频" value="本次会话后询问" />
          <PreferenceRow label="保存双语记录" value="开启" />
          <PreferenceRow label="自动清理" value="关闭" />
          <PreferenceRow label="诊断信息" value="按需导出" />
        </section>
      ) : null}
      <details
        className="developerSettings advancedSettings"
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        open={advancedOpen}
      >
        <summary>{PREFERENCE_ADVANCED_ENTRY.label}</summary>
        {advancedOpen ? (
          <section className="advancedDebugBlock" aria-label="开发者调试">
            <div className="settingsSectionLead">
              <h3>开发者调试</h3>
              <p>只保留链路调试项；模型、术语、字幕窗口和记录隐私在上方分组维护。</p>
            </div>
            <PreferenceRow label="WebSocket 地址" value="由桌面端管理" />
            <PreferenceRow label="事件调试" value="开发者模式" />
            <div className="choiceGroup">
              <button
                className={asrProvider === "mock" ? "selected" : ""}
                onClick={() => onAsrProviderSelect("mock")}
              >
                调试识别
              </button>
              <button
                className={translationProvider === "mock" ? "selected" : ""}
                onClick={() => onTranslationProviderSelect("mock")}
              >
                调试翻译
              </button>
            </div>
          </section>
        ) : null}
      </details>
    </aside>
  );
}

function EngineChoiceRow({
  label,
  options,
  status
}: {
  label: string;
  options: Array<{ id: string; description: string; disabled: boolean; label: string; selected: boolean; onSelect: () => void }>;
  status: string;
}) {
  return (
    <div className="engineChoiceRow">
      <span>{label}</span>
      <strong>{status}</strong>
      <div className="choiceGroup">
        {options.map((option) => (
          <button
            className={option.selected ? "selected" : ""}
            disabled={option.disabled}
            key={option.id}
            onClick={option.onSelect}
            title={option.description}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function isEndToEndTranslationSelected(
  selection: TranslationProviderSelection,
  defaultProvider?: TranslationProviderId
): boolean {
  return (selection === "server-default" ? defaultProvider : selection) === "qwen-livetranslate";
}
