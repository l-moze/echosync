import type { LanguageDirectionOption } from "../types/language";

export const languageDirectionOptions: LanguageDirectionOption[] = [
  { id: "en-zh", label: "English → 中文", shortLabel: "英 → 中", sourceLang: "en", targetLang: "zh-CN" },
  { id: "zh-en", label: "中文 → English", shortLabel: "中 → 英", sourceLang: "zh-CN", targetLang: "en" },
  { id: "ja-zh", label: "日本語 → 中文", shortLabel: "日 → 中", sourceLang: "ja", targetLang: "zh-CN" },
  { id: "ko-zh", label: "한국어 → 中文", shortLabel: "韩 → 中", sourceLang: "ko", targetLang: "zh-CN" }
];
