type ReviewTextLine = {
  sourceText: string;
  targetText: string;
};

export function selectTranscriptReviewColumnTemplate(lines: ReviewTextLine[]) {
  const sourceWeight = selectReviewTextWeight(lines.map((line) => line.sourceText));
  const targetWeight = selectReviewTextWeight(lines.map((line) => line.targetText));
  const totalWeight = Math.max(sourceWeight + targetWeight, 1);
  const sourceRatio = Math.min(0.62, Math.max(0.38, sourceWeight / totalWeight));
  const targetRatio = 1 - sourceRatio;
  return `84px minmax(0, ${sourceRatio.toFixed(2)}fr) minmax(0, ${targetRatio.toFixed(2)}fr)`;
}

export function selectReviewTextWeight(texts: string[]) {
  return texts.reduce((sum, text) => {
    const asciiCount = (text.match(/[\w'-]+/g) ?? []).length;
    const wideCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    return sum + asciiCount * 1.15 + wideCount * 0.62 + text.length * 0.05;
  }, 0);
}
