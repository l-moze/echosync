import type { CaptionLine } from "../../shared/caption-store";

export function selectOverlayCaptionRailLines(
  historyLines: CaptionLine[],
  activeLine: CaptionLine | undefined
): CaptionLine[] {
  const selectedLines: CaptionLine[] = [];

  function upsertLine(line: CaptionLine | undefined) {
    if (!line) {
      return;
    }
    const existingIndex = selectedLines.findIndex((item) => item.id === line.id);
    if (existingIndex >= 0) {
      selectedLines[existingIndex] = line;
      return;
    }
    selectedLines.push(line);
  }

  historyLines.forEach(upsertLine);
  upsertLine(activeLine);
  return selectedLines;
}
