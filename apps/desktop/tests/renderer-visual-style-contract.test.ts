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

  it("bounds record detail content so transcript and summary panes scroll independently", () => {
    const detailWindowRule = cssRule(".recordWindow.detail");
    const detailPanelRule = cssRule(".recordDetailPanel");
    const detailLayoutRule = cssRule(".recordDetailLayout");
    const transcriptRule = cssRule(".recordTranscriptList");
    const segmentRule = cssRule(".recordSegmentPair");
    const segmentTextRule = cssRule(".recordSegmentPair p");
    const summaryRule = cssRule(".recordSummaryAside");
    const summarySectionRule = cssRule(".recordSummaryAside section");
    const summaryErrorRule = cssRule(".recordSummaryError");

    expect(detailWindowRule).toContain("height: min(820px, calc(100vh - 92px))");
    expect(detailWindowRule).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(detailPanelRule).toContain("grid-template-rows: auto auto minmax(0, 1fr)");
    expect(detailPanelRule).toContain("overflow: hidden");
    expect(detailLayoutRule).toContain("height: 100%");
    expect(detailLayoutRule).toContain("min-height: 0");
    expect(transcriptRule).toContain("min-height: 0");
    expect(transcriptRule).toContain("overflow-y: auto");
    expect(segmentRule).toContain("height: auto");
    expect(segmentRule).toContain("min-height: 112px");
    expect(segmentRule).toContain("align-content: start");
    expect(segmentRule).toContain("cursor: pointer");
    expect(segmentTextRule).toContain("display: block");
    expect(segmentTextRule).toContain("white-space: normal");
    expect(summaryRule).toContain("min-height: 0");
    expect(summaryRule).toContain("overflow-y: auto");
    expect(summaryRule).toContain("overflow-x: hidden");
    expect(summarySectionRule).toContain("min-width: 0");
    expect(summaryErrorRule).toContain("overflow-wrap: anywhere");
  });

  it("keeps finished transcript review segments in readable block flow", () => {
    const gridRule = cssRule(".transcriptReviewGrid");
    const headerRule = cssRule(".reviewHeader");
    const headerCellRule = cssRule(".reviewHeader span");
    const pairRule = cssRule(".reviewPair");
    const stackedPairRule = cssRule(".transcriptReviewGrid.stacked .reviewPair");
    const sourceRule = cssRule(".reviewSegment.reviewSource");
    const targetRule = cssRule(".reviewSegment.reviewTarget");
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
    expect(rendererSource).toContain("key={line.id}");
    expect(rendererSource).toContain("<span className=\"reviewTimestamp\">{formatPreciseTime(line.startMs)}-{formatPreciseTime(line.endMs)}</span>");
    expect(rendererSource).toContain("<span className=\"reviewText reviewSource\">{line.sourceText || \"原文为空\"}</span>");
    expect(rendererSource).toContain("<span className=\"reviewText reviewTarget\">{line.targetText || \"译文待补全\"}</span>");
    expect(rendererSource).not.toContain("key={`source-${line.id}`}");
    expect(rendererSource).not.toContain("key={`target-${line.id}`}");
    expect(gridRule).toContain("--review-column-template");
    expect(gridRule).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(gridRule).toContain("overflow-y: auto");
    expect(headerRule).toContain("position: sticky");
    expect(headerRule).toContain("grid-template-columns: var(--review-column-template)");
    expect(pairRule).toContain("display: grid");
    expect(pairRule).toContain("grid-template-columns: var(--review-column-template)");
    expect(stackedPairRule).toContain("display: grid");
    expect(sourceRule).toContain("grid-column: 2");
    expect(targetRule).toContain("grid-column: 3");
    expect(segmentRule).toContain("display: grid");
    expect(segmentRule).toContain("height: auto");
    expect(segmentRule).toContain("align-content: start");
    expect(segmentRule).toContain("gap: 5px");
    expect(segmentRule).toContain("cursor: pointer");
    expect(segmentRule).toContain("font: inherit");
    expect(timestampRule).toContain("line-height: 1.35");
    expect(textRule).toContain("display: block");
    expect(textRule).toContain("margin: 0");
    expect(textRule).toContain("line-height: 1.55");
    expect(textRule).toContain("overflow-wrap: anywhere");
  });

  it("lets the finished review page protect transcript width before the side panel can crowd it", () => {
    const earlyFinishedBreakpoint = /@media \(max-width: 1120px\)\s*\{\s*\.controlCenter\.lifecycle-finished \.dashboardGrid\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? "";

    expect(earlyFinishedBreakpoint).toContain("grid-template-columns: minmax(0, 1fr)");
  });

  it("disables unavailable provider choices before session start", () => {
    const settingsPanelSource = rendererSource.slice(
      rendererSource.indexOf("function PreferenceSettingsPanel"),
      rendererSource.indexOf("function PreferenceRow")
    );
    const engineChoiceSource = rendererSource.slice(
      rendererSource.indexOf("function EngineChoiceRow"),
      rendererSource.indexOf("function engineOptionLabel")
    );

    expect(settingsPanelSource).toContain("providerChoiceState");
    expect(settingsPanelSource).toContain("findAgentAsrProvider");
    expect(settingsPanelSource).toContain("findAgentTranslationProvider");
    expect(settingsPanelSource).toContain("findAgentTtsProvider");
    expect(engineChoiceSource).toContain("disabled={option.disabled}");
    expect(engineChoiceSource).toContain("title={option.description}");
  });

  it("keeps overlay caption history as one clipped bottom-anchored rail", () => {
    const overlaySource = rendererSource.slice(
      rendererSource.indexOf("function OverlayWindow"),
      rendererSource.indexOf("type OverlayResizeDirection")
    );
    const historyTextRule = /\.historyLine \.overlaySource,\s*\.historyLine h1,\s*\.historyLine \.overlayTarget\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? "";

    expect(overlaySource).toContain("combinedHistoryLines");
    expect(overlaySource).toContain("<OverlayCaptionHistory lines={combinedHistoryLines}");
    expect(overlaySource).not.toContain("variant=\"settling\"");
    expect(rendererSource).toContain("scrollTranscriptToBottom(historyRef.current, \"smooth\")");
    expect(cssRule(".floatingCaption.hasHistory")).toContain("grid-template-rows: minmax(0, 1fr) auto");
    expect(cssRule(".floatingCaption.withChrome.hasHistory")).toContain("grid-template-rows: auto minmax(0, 1fr) auto auto");
    expect(cssRule(".overlayCaptionHistory")).toContain("scroll-behavior: smooth");
    expect(cssRule(".overlayCaptionHistory")).toContain("overflow-anchor: none");
    expect(cssRule(".overlayStage.layer-default .overlayCaptionHistory")).toContain("max-height: none");
    expect(cssRule(".overlayStage.layer-default .overlayCaptionHistory")).toContain("height: 100%");
    expect(cssRule(".historyLine")).not.toContain("animation");
    expect(stylesheet).not.toContain("@keyframes historyLineLift");
    expect(historyTextRule).toContain("overflow: hidden");
    expect(historyTextRule).toContain("-webkit-box-orient: vertical");
    expect(cssRule(".historyLine .overlaySource")).toContain("-webkit-line-clamp: 1");
    expect(cssRule(".historyLine h1")).toContain("-webkit-line-clamp: 1");
  });

  it("renders caption text as paired blocks and gives zoned mode real source/target regions", () => {
    const captionTextSource = rendererSource.slice(
      rendererSource.indexOf("function CaptionText"),
      rendererSource.indexOf("function OverlayCaptionHistory")
    );

    expect(captionTextSource).toContain("selectCaptionTextBlocks");
    expect(captionTextSource).toContain("selectBufferedCaptionTextBlocks");
    expect(captionTextSource).toContain("useBufferedBlocks");
    expect(captionTextSource).toContain("splitPending");
    expect(captionTextSource).toContain("captionTextBlock");
    expect(cssRule(".captionText")).toContain("align-content: end");
    expect(cssRule(".captionTextBlock")).toContain("display: grid");
    expect(cssRule(".captionTextBlock")).toContain("transition: transform 220ms");
    expect(cssRule(".captionText.mode-sentencePair .captionTextBlock.splitPending .overlaySource")).toContain("display: -webkit-box");
    expect(cssRule(".captionText.mode-sentencePair .captionTextBlock.splitPending .overlaySource")).toContain("-webkit-line-clamp: 3");
    expect(cssRule(".captionText.mode-sentencePair .captionTextBlock.splitPending h1")).toContain("-webkit-line-clamp: 3");
    expect(cssRule(".captionText.mode-zonedPair")).toContain("height: 100%");
    expect(cssRule(".captionText.mode-zonedPair .captionTextBlock")).toContain("grid-template-rows: minmax(0, 1fr) minmax(0, 1fr)");
    expect(cssRule(".captionText.mode-zonedPair .overlaySource")).toContain("-webkit-line-clamp: 3");
    expect(cssRule(".captionText.mode-zonedPair h1")).toContain("-webkit-line-clamp: 3");
  });
});
