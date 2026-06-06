import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const rendererSource = readFileSync(resolve(__dirname, "../src/renderer/main.tsx"), "utf8");
const stylesheet = readFileSync(resolve(__dirname, "../src/renderer/styles.css"), "utf8");

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n|})\\s*${escaped}\\s*\\{([^}]*)\\}`, "g").exec(stylesheet)?.[1] ?? "";
}

describe("renderer visual style contract", () => {
  it("title bar uses a consistent packaged app icon mark", () => {
    const markPath = resolve(__dirname, "../src/renderer/assets/icons/app-mark-64.png");

    expect(rendererSource).toContain("appBrandMark");
    expect(rendererSource).not.toContain("brandDot");
    expect(stylesheet).not.toContain(".brandDot");
    expect(cssRule(".appBrandMark")).toContain("background-image: url(\"./assets/icons/app-mark-64.png\")");
    expect(existsSync(markPath)).toBe(true);
  });

  it("uses brand sync as a product accent without replacing the primary action blue", () => {
    const rootRule = cssRule(":root");

    expect(rootRule).toContain("--brand-ink");
    expect(rootRule).toContain("--brand-sync");
    expect(rootRule).toContain("--blue");
  });

  it("keeps active toolbar controls visually bounded and selected states brand-led", () => {
    const toolbarButtonRule = cssRule(".activeToolbar button");
    const selectedRule = cssRule(".activeToolbar button.selected");

    expect(toolbarButtonRule).toContain("min-height: 34px");
    expect(toolbarButtonRule).toContain("border-radius: 999px");
    expect(selectedRule).toContain("var(--brand-sync)");
  });

  it("separates the title bar overlay action from fixed-size window chrome buttons", () => {
    const overlayActionRule = cssRule(".windowActions button:first-child");
    const chromeButtonRule = cssRule(".windowActions button:not(:first-child)");

    expect(overlayActionRule).toContain("min-width: 84px");
    expect(overlayActionRule).toContain("border-radius: 999px");
    expect(chromeButtonRule).toContain("width: 32px");
    expect(chromeButtonRule).toContain("height: 32px");
  });

  it("keeps the home launcher inside the first viewport instead of letting the shell crop", () => {
    const launcherRule = cssRule(".homeLauncher");
    const surfaceRule = cssRule(".launcherSurface");

    expect(launcherRule).toContain("align-items: start");
    expect(surfaceRule).toContain("width: min(100%, 780px)");
    expect(surfaceRule).toContain("max-height: calc(100vh - 92px)");
    expect(surfaceRule).toContain("overflow: auto");
    expect(surfaceRule).toContain("scrollbar-gutter: stable");
  });

  it("keeps the home launcher rhythm compact enough for framed desktop screenshots", () => {
    const surfaceRule = cssRule(".launcherSurface");
    const rowRule = cssRule(".launcherRow");
    const titleRule = cssRule(".launcherIntro h1");
    const previewRule = cssRule(".subtitlePreview");
    const bubbleRule = cssRule(".previewCaptionBubble");

    expect(surfaceRule).toContain("gap: 12px");
    expect(surfaceRule).toContain("padding: 22px 30px 18px");
    expect(rowRule).toContain("min-height: 48px");
    expect(titleRule).toContain("font-size: 30px");
    expect(previewRule).toContain("gap: 8px");
    expect(bubbleRule).toContain("min-height: 104px");
    expect(bubbleRule).toContain("padding: 18px 24px");
  });

  it("treats the record window as a stable desktop panel with scannable rows", () => {
    const recordWindowRule = cssRule(".recordWindow");
    const recordRowHoverRule = cssRule(".recordTableRow:hover");

    expect(recordWindowRule).toContain("width: min(1040px, calc(100vw - 48px))");
    expect(recordWindowRule).toContain("max-height: calc(100vh - 92px)");
    expect(recordWindowRule).toContain("border-radius: 12px");
    expect(recordWindowRule).toContain("scrollbar-gutter: stable");
    expect(recordRowHoverRule).toContain("background: #f8fbff");
  });

  it("keeps finished transcript review segments in readable block flow", () => {
    const gridRule = cssRule(".transcriptReviewGrid");
    const stackedGridRule = cssRule(".transcriptReviewGrid.stacked");
    const columnRule = cssRule(".reviewColumn");
    const stackedColumnRule = cssRule(".transcriptReviewGrid.stacked .reviewColumn");
    const stackedDividerRule = cssRule(".transcriptReviewGrid.stacked .reviewColumn + .reviewColumn");
    const segmentRule = cssRule(".reviewSegment");
    const textRule = cssRule(".reviewText");
    const timestampRule = cssRule(".reviewTimestamp");

    expect(rendererSource).toContain("TRANSCRIPT_REVIEW_STACKED_WIDTH_PX");
    expect(rendererSource).toContain("selectTranscriptReviewColumnTemplate");
    expect(rendererSource).toContain("selectReviewTextWeight");
    expect(rendererSource).toContain("ResizeObserver");
    expect(rendererSource).toContain("useLayoutEffect");
    expect(rendererSource).toContain("grid.clientWidth < TRANSCRIPT_REVIEW_STACKED_WIDTH_PX");
    expect(rendererSource).toContain("style={{ \"--review-column-template\": columnTemplate } as CSSProperties}");
    expect(rendererSource).toContain("layoutMode === \"stacked\"");
    expect(rendererSource).not.toContain("PanelResizeHandle");
    expect(rendererSource).not.toContain("reviewResizeHandle");
    expect(rendererSource).toContain("<article");
    expect(rendererSource).toContain("role=\"button\"");
    expect(rendererSource).toContain("tabIndex={0}");
    expect(rendererSource).toContain("handleReviewSegmentKeyDown");
    expect(rendererSource).toContain("<span className=\"reviewTimestamp\">{formatTime(line.startMs)}-{formatTime(line.endMs)}</span>");
    expect(rendererSource).toContain("<span className=\"reviewText\">{line.sourceText}</span>");
    expect(rendererSource).toContain("<span className=\"reviewText\">{line.targetText}</span>");
    expect(gridRule).toContain("--review-column-template");
    expect(gridRule).toContain("grid-template-columns: var(--review-column-template)");
    expect(stackedGridRule).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(columnRule).toContain("display: block");
    expect(columnRule).toContain("scrollbar-gutter: stable");
    expect(stackedColumnRule).toContain("max-height: min(34vh, 360px)");
    expect(stackedDividerRule).toContain("border-top: 1px solid var(--line)");
    expect(stackedDividerRule).toContain("border-left: 0");
    expect(segmentRule).toContain("display: grid");
    expect(segmentRule).toContain("height: auto");
    expect(segmentRule).toContain("align-content: start");
    expect(segmentRule).toContain("gap: 5px");
    expect(segmentRule).toContain("cursor: pointer");
    expect(segmentRule).toContain("font: inherit");
    expect(timestampRule).toContain("line-height: 1.2");
    expect(textRule).toContain("display: block");
    expect(textRule).toContain("margin: 0");
    expect(textRule).toContain("line-height: 1.55");
    expect(textRule).toContain("overflow-wrap: anywhere");
  });

  it("lets the finished review page protect transcript width before the side panel can crowd it", () => {
    const earlyFinishedBreakpoint = /@media \(max-width: 1120px\)\s*\{\s*\.controlCenter\.lifecycle-finished \.dashboardGrid\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? "";

    expect(earlyFinishedBreakpoint).toContain("grid-template-columns: minmax(0, 1fr)");
  });
});
