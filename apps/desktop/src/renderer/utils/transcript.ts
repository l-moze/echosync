import type { CaptionLine } from "../../shared/caption-store";

export function transcriptLinesToEditableText(lines: CaptionLine[]) {
  return lines
    .map((line) => [`原文: ${line.sourceText}`, `译文: ${line.targetText}`].join("\n"))
    .join("\n\n");
}

export function editableTextToTranscriptLines(text: string, fallbackLines: CaptionLine[]) {
  const blocks = text.split(/\n{2,}/);
  return fallbackLines.map((line, index) => {
    const block = blocks[index]?.trim();
    if (!block) {
      return line;
    }

    const sourceText = extractEditableTranscriptField(block, "原文") ?? line.sourceText;
    const targetText = extractEditableTranscriptField(block, "译文") ?? line.targetText;
    return { ...line, sourceText, targetText };
  });
}

export function extractEditableTranscriptField(block: string, label: "原文" | "译文") {
  const line = block
    .split("\n")
    .find((item) => item.trimStart().startsWith(`${label}:`) || item.trimStart().startsWith(`${label}：`));
  if (!line) {
    return undefined;
  }
  return line.replace(new RegExp(`^\\s*${label}[:：]\\s*`), "").trim();
}
