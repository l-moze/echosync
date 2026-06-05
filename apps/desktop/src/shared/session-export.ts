import type { CaptionLine } from "./caption-store";

export function cleanTranscriptLines(lines: CaptionLine[]): CaptionLine[] {
  return lines.map((line) => ({
    ...line,
    sourceText: cleanTranscriptText(line.sourceText),
    targetText: cleanTranscriptText(line.targetText)
  }));
}

export function serializeTranscriptMarkdown(lines: CaptionLine[]) {
  const body = lines
    .map((line) =>
      [
        `## ${formatMarkdownTime(line.startMs)} - ${formatMarkdownTime(line.endMs)}`,
        "",
        `**原文** ${line.sourceText}`,
        "",
        `**译文** ${line.targetText}`
      ].join("\n")
    )
    .join("\n\n");

  return ["# EchoSync Transcript", "", body].join("\n").trimEnd();
}

export function serializeTranscriptSrt(lines: CaptionLine[]) {
  return lines
    .map((line, index) =>
      [
        `${index + 1}`,
        `${formatSrtTime(line.startMs)} --> ${formatSrtTime(line.endMs)}`,
        line.targetText,
        line.sourceText,
        ""
      ].join("\n")
    )
    .join("\n");
}

function cleanTranscriptText(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+([。，！？；：])/g, "$1")
    .trim();
}

function formatMarkdownTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = ms % 1000;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
}

function formatSrtTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = ms % 1000;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")},${milliseconds.toString().padStart(3, "0")}`;
}
