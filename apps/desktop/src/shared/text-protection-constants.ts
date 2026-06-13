// 前端字幕文本异常缩短保护阈值。新文本比历史文本短超过该值时，
// 视为可能的流式修订截断，优先保留历史文本；小幅缩短仍允许作为正常 ASR 修正。
export const TEXT_SHRINK_THRESHOLD = 8;
