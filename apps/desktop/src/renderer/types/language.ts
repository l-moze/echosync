export type LanguageDirectionId = "en-zh" | "zh-en" | "ja-zh" | "ko-zh";

export type LanguageDirectionOption = {
  id: LanguageDirectionId;
  label: string;
  shortLabel: string;
  sourceLang: string;
  targetLang: string;
};
