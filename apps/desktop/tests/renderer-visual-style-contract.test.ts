import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const rendererSource = readFileSync(resolve(__dirname, "../src/renderer/main.tsx"), "utf8");
const stylesheet = readFileSync(resolve(__dirname, "../src/renderer/styles.css"), "utf8").replace(/\r\n/g, "\n");

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

  it("keeps the title bar focused on fixed-size window chrome buttons", () => {
    const chromeButtonRule = cssRule(".windowActions button");
    const activeDashboardSource = rendererSource.slice(
      rendererSource.indexOf("function ActiveDashboard"),
      rendererSource.indexOf("function FinishedDashboard")
    );

    expect(rendererSource).not.toContain("title=\"显示字幕窗\"");
    expect(activeDashboardSource).toContain("onShowOverlay");
    expect(activeDashboardSource).toContain("恢复悬浮窗");
    expect(stylesheet).not.toContain(".windowActions button:first-child");
    expect(stylesheet).not.toContain(".windowActions button:not(:first-child)");
    expect(chromeButtonRule).toContain("width: 32px");
    expect(chromeButtonRule).toContain("height: 32px");
    expect(chromeButtonRule).toContain("border-radius: 8px");
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
    const languageRule = cssRule(".languageDirectionGroup");

    expect(surfaceRule).toContain("gap: 12px");
    expect(surfaceRule).toContain("padding: 22px 30px 18px");
    expect(rowRule).toContain("min-height: 48px");
    expect(titleRule).toContain("font-size: 30px");
    expect(languageRule).toContain("max-width: 286px");
    expect(rendererSource).toContain("languageDirectionOptions.map");
    expect(rendererSource).toContain("onLanguageDirectionSelect(option.id)");
    expect(rendererSource).toContain("value={languageDirection.label}");
    expect(rendererSource).not.toContain("HOME_LAUNCHER_COPY.previewAction");
    expect(rendererSource).not.toContain("subtitlePreview");
    expect(rendererSource).not.toContain("免费 1 小时");
    expect(stylesheet).not.toContain(".subtitlePreview");
    expect(stylesheet).not.toContain(".previewCaptionBubble");
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
    const detailHeaderRule = cssRule(".recordDetailPanel > header");
    const detailActionsRule = cssRule(".recordDetailActions");
    const audioRule = cssRule(".recordAudioPlayer");
    const audioControlsRule = cssRule(".recordAudioControls");
    const audioTimeRule = cssRule(".recordAudioPlayer time");
    const detailLayoutRule = cssRule(".recordDetailLayout");
    const transcriptRule = cssRule(".recordTranscriptList");
    const segmentRule = cssRule(".recordSegmentPair");
    const segmentTextRule = cssRule(".recordSegmentPair p");
    const summaryRule = cssRule(".recordSummaryAside");
    const summarySectionRule = cssRule(".recordSummaryAside section");
    const summaryListItemRule = cssRule(".recordSummaryList li");
    const summaryErrorRule = cssRule(".recordSummaryError");

    expect(detailWindowRule).toContain("height: min(820px, calc(100vh - 92px))");
    expect(detailWindowRule).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(detailPanelRule).toContain("grid-template-rows: auto auto minmax(0, 1fr)");
    expect(detailPanelRule).toContain("overflow: hidden");
    expect(detailHeaderRule).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, auto)");
    expect(detailActionsRule).toContain("flex-wrap: wrap");
    expect(detailActionsRule).toContain("min-width: 0");
    expect(audioRule).toContain("grid-template-columns: minmax(0, 1fr) max-content");
    expect(audioRule).toContain("overflow: hidden");
    expect(audioControlsRule).toContain("grid-template-columns: max-content minmax(0, 1fr)");
    expect(audioTimeRule).toContain("white-space: nowrap");
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
    expect(summaryListItemRule).toContain("overflow-wrap: anywhere");
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
    const advancedSettingsSource = rendererSource.slice(
      rendererSource.indexOf('className="developerSettings advancedSettings"'),
      rendererSource.indexOf("function PreferenceMiniCard")
    );

    expect(settingsPanelSource).toContain("providerChoiceState");
    expect(settingsPanelSource).toContain("findAgentAsrProvider");
    expect(settingsPanelSource).toContain("findAgentTranslationProvider");
    expect(settingsPanelSource).toContain("findAgentTtsProvider");
    expect(settingsPanelSource).toContain('activeSection === "models"');
    expect(settingsPanelSource).toContain('activeSection === "terminology"');
    expect(settingsPanelSource).toContain('activeSection === "captions"');
    expect(settingsPanelSource).toContain("PreferenceMiniCard");
    expect(engineChoiceSource).toContain("disabled={option.disabled}");
    expect(engineChoiceSource).toContain("title={option.description}");
    expect(settingsPanelSource).toContain("terminologyImportPanel");
    expect(settingsPanelSource).toContain("导入术语");
    expect(settingsPanelSource).toContain("术语库");
    expect(settingsPanelSource).toContain("翻译模型");
    expect(settingsPanelSource).toContain("onChange={(event) => setTerminologyFileName");
    expect(cssRule(".terminologyImportPanel")).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(cssRule(".terminologyImportButton input")).toContain("opacity: 0");
    expect(cssRule(".engineSettingsPanel > nav")).toContain("grid-template-columns: repeat(5, minmax(0, 1fr))");
    expect(advancedSettingsSource).toContain("advancedDebugBlock");
    expect(advancedSettingsSource).toContain("开发者调试");
    expect(advancedSettingsSource).toContain("调试识别");
    expect(advancedSettingsSource).toContain("调试翻译");
    expect(advancedSettingsSource).not.toContain('label="语音识别"');
    expect(advancedSettingsSource).not.toContain('label="翻译"');
    expect(advancedSettingsSource).not.toContain("故障处理");
    expect(advancedSettingsSource).not.toContain("性能诊断");
    expect(advancedSettingsSource).not.toContain("延迟日志");
    expect(cssRule(".advancedDebugBlock")).toContain("display: grid");
  });

  it("keeps overlay toolbar and session controls focused on the expected subtitle workflow", () => {
    const overlayWindowSource = rendererSource.slice(
      rendererSource.indexOf("function OverlayWindow"),
      rendererSource.indexOf("type OverlayResizeDirection")
    );
    const overlayToolbarSource = rendererSource.slice(
      rendererSource.indexOf("function OverlayToolbar"),
      rendererSource.indexOf("function OverlaySessionBar")
    );
    const overlaySessionSource = rendererSource.slice(
      rendererSource.indexOf("function OverlaySessionBar"),
      rendererSource.indexOf("function SubtitleStyleWindow")
    );
    const captionTextRule = /\.overlaySource,\s*\.floatingCaption h1,\s*\.overlayTarget\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? "";
    const compactChromeSourceRule = /\.overlayStage\.layer-controls \.floatingCaption \.overlaySource,\s*\.overlayStage\.layer-settings \.floatingCaption \.overlaySource\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? "";
    const compactChromeTargetRule = /\.overlayStage\.layer-controls \.floatingCaption h1,\s*\.overlayStage\.layer-settings \.floatingCaption h1\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? "";

    expect(overlayWindowSource).toContain("interaction.hoverIntentDelayMs + 20");
    expect(overlayWindowSource).toContain("interaction.collapseDelayMs + 40");
    expect(overlayWindowSource).toContain("onOverlaySettingsWake");
    expect(overlayWindowSource).toContain("openSubtitleSettings");
    expect(overlayWindowSource).toContain("setSubtitleStyleWindowVisible(true)");
    expect(rendererSource).toContain("type OverlayChromeMenu");
    expect(overlayWindowSource).toContain("toggleChromeMenu");
    expect(overlayWindowSource).toContain("minimizeOverlay");
    expect(overlayWindowSource).toContain("requestOverlayClose");
    expect(overlayWindowSource).toContain("OverlayExitConfirmDialog");
    expect(overlayWindowSource).not.toContain("onClose={() => void window.echosyncDesktop?.setOverlayVisible(false)}");
    expect(overlayToolbarSource).toContain("overlayMenuTrigger");
    expect(overlayToolbarSource).toContain('activeMenu === "display"');
    expect(overlayToolbarSource).toContain("overlayDropdown top");
    expect(overlayToolbarSource).toContain("role=\"menuitemradio\"");
    expect(overlayToolbarSource).toContain("ToolbarIcon name={isInteractionLocked ? \"unlock\" : \"lock\"}");
    expect(overlayToolbarSource).toContain("lockToggleWrap");
    expect(overlayToolbarSource).toContain("lockToggleHint");
    expect(overlayToolbarSource).toContain("解锁字幕");
    expect(overlayToolbarSource).toContain("ToolbarIcon name=\"minimize\"");
    expect(overlayToolbarSource).not.toContain("onWakeHome");
    expect(overlayToolbarSource).not.toContain("onRecenter");
    expect(overlaySessionSource).toContain("Windows 系统声音");
    expect(overlaySessionSource).toContain("captionContentModes.map");
    expect(overlaySessionSource).toContain("onContentModeChange(mode.id)");
    expect(overlaySessionSource).toContain('activeMenu === "plan"');
    expect(overlaySessionSource).toContain('activeMenu === "language"');
    expect(overlaySessionSource).toContain("function OverlayBottomMenuDock");
    expect(overlaySessionSource).toContain("captionMenuDock");
    expect(overlaySessionSource).toContain("dockedOverlayMenu");
    expect(overlaySessionSource).toContain("onPlanSelect(option.id)");
    expect(overlaySessionSource).toContain("onLanguageDirectionSelect(option.id)");
    expect(overlaySessionSource).toContain("languageDirectionOptions.map");
    expect(overlaySessionSource).not.toContain("onPlanSettings");
    expect(cssRule(".overlayToolbar")).toContain("grid-template-columns: auto minmax(0, 1fr) auto");
    expect(cssRule(".overlayIconGroup button")).toContain("width: 30px");
    expect(cssRule(".overlayIconGroup button")).toContain("height: 30px");
    expect(cssRule(".lockToggleWrap")).toContain("position: relative");
    expect(cssRule(".lockToggleHint")).toContain("position: absolute");
    expect(cssRule(".lockToggleWrap:hover .lockToggleHint,\n.lockToggleWrap:focus-within .lockToggleHint,\n.lockToggleWrap.locked .lockToggleHint")).toContain("opacity: 1");
    expect(cssRule(".overlaySessionBar")).toContain("display: grid");
    expect(cssRule(".overlaySessionBar")).toContain("grid-template-columns: auto auto max-content minmax(96px, max-content) auto max-content");
    expect(cssRule(".overlayMenuTrigger")).toContain("min-height: 30px");
    expect(cssRule(".overlayDropdown")).toContain("animation: overlayMenuIn");
    expect(cssRule(".floatingCaption.withChrome.hasBottomMenu")).toContain("grid-template-rows: auto minmax(0, 1fr) auto auto");
    expect(cssRule(".captionMenuDock")).toContain("grid-row: 3");
    expect(cssRule(".captionMenuDock .dockedOverlayMenu")).toContain("position: static");
    expect(cssRule(".floatingCaption.withChrome.hasBottomMenu > .captionBottomChrome")).toContain("grid-row: 4");
    expect(cssRule(".overlayExitConfirmScrim")).toContain("position: absolute");
    expect(cssRule(".captionContentSwitch")).toContain("max-width: 100%");
    expect(cssRule(".floatingCaption")).toContain("user-select: none");
    expect(cssRule(".floatingCaption")).toContain("-webkit-user-select: none");
    expect(cssRule(".captionText")).toContain("user-select: none");
    expect(cssRule(".captionText")).toContain("-webkit-user-select: none");
    expect(cssRule(".overlayCaptionHistory")).toContain("user-select: none");
    expect(cssRule(".overlayCaptionHistory")).toContain("-webkit-user-select: none");
    expect(cssRule(".overlayCaptionHistory")).not.toContain("-webkit-app-region: no-drag");
    expect(cssRule(".zonedCaptionLane")).not.toContain("-webkit-app-region: no-drag");
    expect(cssRule(".captionTopChrome,\n.captionBottomChrome")).not.toContain("-webkit-app-region: no-drag");
    expect(captionTextRule).toContain("user-select: none");
    expect(captionTextRule).toContain("-webkit-user-select: none");
    expect(compactChromeSourceRule).toContain("font-size: min(var(--source-size, 18px), 16px)");
    expect(compactChromeTargetRule).toContain("font-size: min(var(--target-size, 30px), 26px)");
    expect(stylesheet).not.toContain("displayModePicker");
  });

  it("keeps overlay captions in one top-anchored middle rail with complete visible rows", () => {
    const overlaySource = rendererSource.slice(
      rendererSource.indexOf("function OverlayWindow"),
      rendererSource.indexOf("type OverlayResizeDirection")
    );
    const historyTextRule = /\.historyLine \.overlaySource,\s*\.historyLine h1,\s*\.historyLine \.overlayTarget\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? "";

    expect(overlaySource).toContain("combinedHistoryLines");
    expect(overlaySource).toContain("captionRailLines");
    expect(overlaySource).toContain("<OverlayCaptionHistory");
    expect(overlaySource).toContain("contentMode={captionContentMode}");
    expect(overlaySource).toContain("lines={captionRailLines}");
    expect(overlaySource).not.toContain("variant=\"settling\"");
    expect(rendererSource).toContain("useCompleteCaptionItemVisibility(historyRef, \".historyLine\", lineRenderKey)");
    expect(rendererSource).toContain("scrollCaptionRailToStableEdge(historyRef.current, \".historyLine\", \"smooth\")");
    expect(cssRule(".floatingCaption.withChrome > .overlayCaptionHistory")).toContain("grid-row: 2");
    expect(cssRule(".floatingCaption.withChrome > .overlayCaptionHistory")).toContain("height: 100%");
    expect(cssRule(".overlayCaptionHistory")).toContain("align-content: start");
    expect(cssRule(".overlayCaptionHistory")).toContain("scroll-behavior: smooth");
    expect(cssRule(".overlayCaptionHistory")).toContain("overflow-anchor: none");
    expect(cssRule(".overlayStage.layer-default .overlayCaptionHistory")).toContain("max-height: none");
    expect(cssRule(".overlayStage.layer-default .overlayCaptionHistory")).toContain("height: 100%");
    expect(cssRule(".historyLine.clipped,\n.zonedCaptionStream.clipped,\n.zonedCaptionLine.clipped")).toContain("visibility: hidden");
    expect(cssRule(".historyLine")).not.toContain("animation");
    expect(stylesheet).not.toContain("@keyframes historyLineLift");
    expect(historyTextRule).toContain("overflow: hidden");
    expect(historyTextRule).toContain("-webkit-box-orient: vertical");
    expect(cssRule(".historyLine .overlaySource")).toContain("-webkit-line-clamp: 1");
    expect(cssRule(".historyLine .overlaySource")).toContain("font-size: clamp(12px, calc(var(--source-size, 18px) - 4px), 14px)");
    expect(cssRule(".historyLine h1")).toContain("-webkit-line-clamp: 1");
    expect(cssRule(".historyLine h1")).toContain("font-size: clamp(17px, calc(var(--target-size, 30px) - 10px), 21px)");
  });

  it("renders caption text as paired blocks and gives zoned mode real source/target regions", () => {
    const captionTextSource = rendererSource.slice(
      rendererSource.indexOf("function CaptionText"),
      rendererSource.indexOf("function OverlayCaptionHistory")
    );
    const zonedLaneSource = rendererSource.slice(
      rendererSource.indexOf("function ZonedCaptionLane"),
      rendererSource.indexOf("function OverlayCaptionHistory")
    );

    expect(captionTextSource).toContain("selectCaptionTextBlocks");
    expect(captionTextSource).toContain("selectBufferedCaptionTextBlocks");
    expect(captionTextSource).toContain("useBufferedBlocks");
    expect(captionTextSource).toContain("splitPending");
    expect(captionTextSource).toContain("captionTextBlock");
    expect(cssRule(".captionText")).toContain("align-content: start");
    expect(cssRule(".captionTextBlock")).toContain("display: grid");
    expect(cssRule(".captionTextBlock")).toContain("transition: transform 220ms");
    const splitPendingSourceRule = cssRule(".captionText.mode-sentencePair .captionTextBlock.splitPending .overlaySource");
    const splitPendingTargetRule = cssRule(".captionText.mode-sentencePair .captionTextBlock.splitPending h1");
    for (const rule of [splitPendingSourceRule, splitPendingTargetRule]) {
      expect(rule).toContain("display: -webkit-box");
      expect(rule).toContain("-webkit-box-orient: vertical");
      expect(rule).toContain("overflow: hidden");
      expect(rule).toContain("-webkit-line-clamp: 3");
      expect(rule).toContain("line-clamp: 3");
    }
    expect(cssRule(".captionText.mode-zonedPair")).toContain("height: 100%");
    expect(cssRule(".captionText.mode-zonedPair .captionTextBlock")).toContain("grid-template-rows: minmax(0, 1fr) minmax(0, 1fr)");
    const zonedCaptionTextFallbackRule = cssRule(".captionText.mode-zonedPair .overlaySource,\n.captionText.mode-zonedPair h1");
    expect(zonedCaptionTextFallbackRule).toContain("display: block");
    expect(zonedCaptionTextFallbackRule).toContain("white-space: normal");
    expect(zonedCaptionTextFallbackRule).toContain("overflow-wrap: anywhere");
    expect(zonedCaptionTextFallbackRule).toContain("-webkit-line-clamp: unset");
    expect(cssRule(".zonedCaptionText")).toContain("display: block");
    expect(cssRule(".zonedCaptionText")).toContain("white-space: normal");
    expect(cssRule(".zonedCaptionText")).toContain("overflow-wrap: anywhere");
    expect(cssRule(".zonedCaptionText")).toContain("text-overflow: clip");
    expect(cssRule(".zonedCaptionText.sourceText,\n.zonedCaptionText.targetText")).toContain("-webkit-line-clamp: unset");
    expect(zonedLaneSource).toContain("selectZonedCaptionLaneChunks");
    expect(zonedLaneSource).toContain("const chunks = lines.length > 0");
    expect(zonedLaneSource).not.toContain("const chunks = selectedChunks.length > 0");
    expect(zonedLaneSource).toContain("useZonedCaptionLaneViewport");
    expect(zonedLaneSource).toContain("className={`zonedCaptionStream");
    expect(zonedLaneSource).toContain("className={`zonedCaptionChunk");
    expect(zonedLaneSource).not.toContain("textParts.join");
    expect(zonedLaneSource).toContain("selectZonedCaptionAlignedScrollTop");
    expect(zonedLaneSource).toContain("measureZonedCaptionLineOffsets");
    expect(zonedLaneSource).toContain("zonedCaptionTextFingerprint");
    expect(zonedLaneSource).toContain("stream.scrollTop = scrollTop");
    expect(zonedLaneSource).not.toContain("stream.scrollHeight - stream.clientHeight);\n      if");
    expect(zonedLaneSource).not.toContain("behavior: \"smooth\"");
    expect(zonedLaneSource).not.toContain("lines.map((line, index)");
    expect(cssRule(".zonedCaptionLane")).toContain("overflow-y: hidden");
    expect(cssRule(".zonedCaptionStream,\n.zonedCaptionLine")).toContain("max-height: var(--zoned-visible-height, 100%)");
    expect(cssRule(".zonedCaptionStream,\n.zonedCaptionLine")).toContain("white-space: normal");
    expect(cssRule(".zonedCaptionChunk")).toContain("display: inline");
    expect(zonedLaneSource).toContain("{chunk.text}{index < chunks.length - 1 ? \" \" : \"\"}");
    expect(stylesheet).not.toContain(".zonedCaptionChunk + .zonedCaptionChunk::before");
  });

  it("keeps the finished review layout inside the viewport with adaptive columns", () => {
    const finishedDashboardSource = rendererSource.slice(
      rendererSource.indexOf("function FinishedDashboard"),
      rendererSource.indexOf("function PreflightAudioVisualizer")
    );

    expect(finishedDashboardSource).toContain("function selectTranscriptReviewColumnTemplate");
    expect(finishedDashboardSource).toContain("84px minmax(0, ${sourceRatio.toFixed(2)}fr) minmax(0, ${targetRatio.toFixed(2)}fr)");
    expect(cssRule(".controlShell")).toContain("overflow: hidden");
    expect(cssRule(".homeShell")).toContain("height: calc(100vh - 58px)");
    expect(cssRule(".homeShell")).toContain("overflow-y: auto");
    expect(cssRule(".controlCenter.lifecycle-finished .transcriptReviewGrid")).toContain("height: clamp(240px, 38vh, 430px)");
    expect(cssRule(".controlCenter.lifecycle-finished .archivePlaybackPanel,\n.controlCenter.lifecycle-finished .archiveMissing")).toContain("order: 1");
    expect(cssRule(".controlCenter.lifecycle-finished .archivePlaybackPanel")).not.toContain("position: sticky");
    expect(cssRule(".archivePlaybackPanel")).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(cssRule(".archiveAudioControls")).toContain("grid-template-columns: max-content minmax(0, 1fr) max-content");
    expect(cssRule(".archiveAudioTime")).toContain("white-space: nowrap");
    expect(cssRule(".archiveAudioStatus,\n.archiveAudioError")).toContain("overflow-wrap: anywhere");
  });
});
