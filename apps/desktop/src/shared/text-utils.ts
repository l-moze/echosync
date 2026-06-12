/**
 * 计算文本中的可见字符数（过滤空格）
 *
 * 使用 Array.from() 正确处理 Unicode 字符（包括 emoji）
 *
 * @example
 * countVisibleChars("Hello World")  // 10
 * countVisibleChars("你好 世界")     // 4
 * countVisibleChars("Hi 👋")        // 3
 */
export function countVisibleChars(text: string): number {
  return Array.from(text).filter((char) => char.trim() !== "").length;
}
