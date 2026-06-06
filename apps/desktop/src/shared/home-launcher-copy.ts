export const HOME_FORBIDDEN_TERMS = [
  "Mock",
  "ASR",
  "TTS",
  "Agent",
  "模型路由",
  "provider",
  "后端默认"
] as const;

export const HOME_LAUNCHER_COPY = {
  title: "实时双语字幕",
  description: "为当前音频生成低延迟字幕覆盖层。",
  primaryAction: "开始同传",
  previewAction: "打开字幕窗预览",
  preferencesAction: "偏好设置"
} as const;

export type HomeReadinessState = {
  audioActive: boolean;
  engineReady: boolean;
  overlayReady: boolean;
  serviceReady: boolean;
};

export type EngineSettingsNavItem = {
  id: "general" | "captions" | "quality" | "privacy";
  label: string;
};

export type AdvancedSettingsNavItem = {
  id: "engine" | "fallback" | "diagnostics" | "developer";
  label: string;
};

export const PREFERENCE_SETTINGS_NAV: EngineSettingsNavItem[] = [
  { id: "general", label: "常规" },
  { id: "captions", label: "字幕" },
  { id: "quality", label: "同传质量" },
  { id: "privacy", label: "记录与隐私" }
];

export const PREFERENCE_ADVANCED_ENTRY = { label: "高级" } as const;

export const ADVANCED_SETTINGS_NAV: AdvancedSettingsNavItem[] = [
  { id: "engine", label: "引擎详情" },
  { id: "fallback", label: "故障处理" },
  { id: "diagnostics", label: "性能诊断" },
  { id: "developer", label: "开发者" }
];

export const SUBTITLE_WINDOW_SETTINGS_ITEMS = [
  "字体大小",
  "双语顺序",
  "显示模式",
  "背景透明度",
  "背景模糊",
  "窗口阴影",
  "锁定位置",
  "鼠标穿透",
  "重置位置"
] as const;

export const RECORD_DETAIL_DEFAULT_SECTIONS = [
  "返回",
  "原文",
  "译文",
  "音频播放器",
  "播放高亮",
  "字号",
  "导出",
  "自动保存",
  "诊断信息"
] as const;

export const RECORD_LIST_COLUMNS = [
  "名称",
  "结束时间",
  "时长",
  "操作"
] as const;

export function buildHomeReadinessSummary(state: HomeReadinessState): string {
  if (!state.serviceReady) {
    return "需要检查 · 同传服务未连接";
  }
  if (!state.audioActive) {
    return "需要检查 · 系统声音暂无输入";
  }
  if (!state.overlayReady) {
    return "需要检查 · 字幕窗未打开";
  }
  if (!state.engineReady) {
    return "需要检查 · 当前引擎不可用";
  }
  return "已就绪 · 系统声音有输入 · 字幕窗可用";
}

export function findHomeForbiddenTerms(text: string): string[] {
  return HOME_FORBIDDEN_TERMS.filter((term) => text.includes(term));
}

export function productizeHomeDiagnostic(message: string): string {
  return message
    .replaceAll(/\s*Agent\s*/g, "同传服务")
    .replaceAll(/\s*ASR provider\s*/g, "语音识别引擎")
    .replaceAll(/\s*翻译 provider\s*/g, "翻译引擎")
    .replaceAll(/\s*provider\s*/g, "引擎")
    .replaceAll(/\s*ASR\s*/g, "语音识别")
    .replaceAll("Agent", "同传服务")
    .replaceAll("provider", "引擎")
    .replaceAll("ASR", "语音识别");
}
