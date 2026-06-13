import { languageDirectionOptions } from "../constants/language";
import { LANGUAGE_DIRECTION_STORAGE_KEY } from "../constants/storage-keys";
import type { LanguageDirectionId, LanguageDirectionOption } from "../types/language";

export function languageDirectionForId(id: string | null | undefined): LanguageDirectionOption {
  return languageDirectionOptions.find((option) => option.id === id) ?? languageDirectionOptions[0];
}

export function readStoredLanguageDirectionId(): LanguageDirectionId {
  try {
    return languageDirectionForId(window.localStorage.getItem(LANGUAGE_DIRECTION_STORAGE_KEY)).id;
  } catch {
    return languageDirectionOptions[0].id;
  }
}

export function writeStoredLanguageDirectionId(id: LanguageDirectionId) {
  try {
    window.localStorage.setItem(LANGUAGE_DIRECTION_STORAGE_KEY, id);
  } catch {
    // 非持久化 renderer 上下文仍可使用主进程同步过来的内存状态。
  }
}
