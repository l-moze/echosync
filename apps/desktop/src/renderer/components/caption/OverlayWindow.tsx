import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import log from "electron-log/renderer";

import { findAgentTranslationProvider, type AgentCapabilities } from "../../../shared/agent-capabilities";
import {
  createInitialCaptionDisplayBuffer,
  selectDisplayCaptionLines,
  selectDisplayCaptionPresentation,
  type CaptionDisplayBuffer
} from "../../../shared/caption-display-buffer";
import {
  selectOverlayDisplayWindow,
  selectOverlayHistoryLinesForDisplay,
  type CaptionLine
} from "../../../shared/caption-store";
import type { DesktopAudioSourceId } from "../../../shared/audio-source-catalog";
import type { DesktopCaptureSnapshot } from "../../../shared/desktop-api";
import {
  createInitialOverlayInteractionState,
  reduceOverlayInteraction,
  type OverlayInteractionEvent
} from "../../../shared/overlay-interaction";
import { selectSessionClockMs } from "../../../shared/session-clock";
import {
  normalizeSubtitleDisplayMode,
  type SubtitleDisplayMode
} from "../../../shared/subtitle-style-state";
import {
  TRANSLATION_PROVIDER_OPTIONS,
  translationProviderLabel,
  type TranslationProviderSelection
} from "../../../shared/translation-provider-catalog";
import { useSharedSubtitleStyle } from "../../hooks/useSharedSubtitleStyle";
import {
  onOverlaySettingsWake,
  onOverlayWake,
  setOverlayLayer,
  setOverlayVisible
} from "../../services/ipc/overlay";
import {
  setOverlayLocked,
  setOverlayPinned,
  setSubtitleStyleWindowVisible
} from "../../services/ipc/subtitle-style";
import type { CaptionContentMode } from "../../types/caption";
import type { LanguageDirectionId, LanguageDirectionOption } from "../../types/language";
import type { OverlayChromeMenu } from "../../types/overlay";
import { formatTime, roundMetric } from "../../utils/format";
import { engineOptionLabel, sourceLabel } from "../../utils/labels";
import { selectOverlayCaptionRailLines } from "../../utils/overlay-caption-lines";
import { OverlayBottomMenuDock } from "./OverlayBottomMenuDock";
import { OverlayCaptionHistory } from "./OverlayCaptionHistory";
import { OverlayExitConfirmDialog } from "./OverlayExitConfirmDialog";
import { OverlayResizeHandles } from "./OverlayResizeHandles";
import { OverlaySessionBar } from "./OverlaySessionBar";
import { OverlayToolbar } from "./OverlayToolbar";
import { ZonedCaptionRail } from "./ZonedCaptionRail";

export function OverlayWindow({
  activeLine,
  agentCapabilities,
  languageDirection,
  lines,
  onLanguageDirectionSelect,
  onSourceStart,
  onStop,
  onTranslationProviderSelect,
  snapshot,
  translationProvider
}: {
  activeLine?: CaptionLine;
  agentCapabilities: AgentCapabilities | null;
  languageDirection: LanguageDirectionOption;
  lines: CaptionLine[];
  onLanguageDirectionSelect: (directionId: LanguageDirectionId) => void;
  onSourceStart: (sourceId: DesktopAudioSourceId) => void;
  onStop: () => void;
  onTranslationProviderSelect: (provider: TranslationProviderSelection) => void;
  snapshot: DesktopCaptureSnapshot;
  translationProvider: TranslationProviderSelection;
}) {
  const isListening = snapshot.state === "listening";
  const [interaction, setInteraction] = useState(createInitialOverlayInteractionState);
  const { subtitleStyle, updateSubtitleStyle } = useSharedSubtitleStyle();
  const isPinned = interaction.layer === "pinned";
  const [overlayExitConfirmOpen, setOverlayExitConfirmOpen] = useState(false);
  const [displayBuffer, setDisplayBuffer] = useState<CaptionDisplayBuffer>(createInitialCaptionDisplayBuffer);
  const displayBufferRef = useRef<CaptionDisplayBuffer>(displayBuffer);
  const overlayRenderMetricsLoggedAtRef = useRef(0);
  const overlayRenderMetricsEventName = "caption_overlay_render_metrics";
  const [displayNowMs, setDisplayNowMs] = useState(() => Date.now());
  const [sessionStartedAtMs, setSessionStartedAtMs] = useState<number | null>(null);
  const [sessionNowMs, setSessionNowMs] = useState(() => Date.now());
  const overlayDisplayLines = useMemo(
    () => selectOverlayDisplayWindow(lines, activeLine?.id),
    [activeLine?.id, lines]
  );
  const displaySelectionResult = useMemo(() => {
    const selectStartedAt = performance.now();
    const selection = selectDisplayCaptionLines(displayBuffer, overlayDisplayLines, displayNowMs);
    return {
      selection,
      selectDisplayMs: performance.now() - selectStartedAt
    };
  }, [displayBuffer, displayNowMs, overlayDisplayLines]);
  const displaySelection = displaySelectionResult.selection;
  const pendingLineCount = displaySelection.pendingLineIds.length;
  const displayMode = normalizeSubtitleDisplayMode(subtitleStyle.displayMode);
  const displayPresentationResult = useMemo(() => {
    const presentationStartedAt = performance.now();
    const presentation = selectDisplayCaptionPresentation(displaySelection, displayMode);
    return {
      presentation,
      presentationMs: performance.now() - presentationStartedAt
    };
  }, [displayMode, displaySelection]);
  const displayPresentation = displayPresentationResult.presentation;
  const displayActiveLine = displayPresentation.activeLine ?? displayPresentation.settlingLines.at(-1);
  const captionLineForDisplay = displayActiveLine ?? activeLine;
  const historyLines = useMemo(
    () => selectOverlayHistoryLinesForDisplay(interaction.layer, displayPresentation.historyLines, displayActiveLine?.id, displayMode),
    [displayActiveLine?.id, displayMode, displayPresentation.historyLines, interaction.layer]
  );
  const settlingLines = useMemo(
    () => displayPresentation.settlingLines.filter((line) => line.id !== displayActiveLine?.id),
    [displayActiveLine?.id, displayPresentation.settlingLines]
  );
  const combinedHistoryLines = useMemo(
    () => [...historyLines, ...settlingLines],
    [historyLines, settlingLines]
  );
  const zonedCaptionLines = useMemo(
    () => selectOverlayCaptionRailLines(combinedHistoryLines, captionLineForDisplay),
    [captionLineForDisplay, combinedHistoryLines]
  );
  const [overlayInteractionLocked, setOverlayInteractionLocked] = useState(false);
  const [subtitleSettingsOpen, setSubtitleSettingsOpen] = useState(false);
  const [chromeMenu, setChromeMenu] = useState<OverlayChromeMenu>(null);
  const [captionContentMode, setCaptionContentMode] = useState<CaptionContentMode>("bilingual");
  const bottomMenuOpen = chromeMenu === "plan" || chromeMenu === "language";
  const showChrome = interaction.layer === "controls" || interaction.layer === "settings" || isPinned || overlayExitConfirmOpen || bottomMenuOpen;
  const showZonedCaptionRail = displayMode === "zonedPair" && captionContentMode === "bilingual";
  const captionRailLines = useMemo(
    () => selectOverlayCaptionRailLines(combinedHistoryLines, captionLineForDisplay),
    [captionLineForDisplay, combinedHistoryLines]
  );
  const hasCaptionHistory = false;
  const planLabel = translationProviderLabel(
    translationProvider,
    agentCapabilities?.defaults.translation_provider
  ).replace("通用模型", "自动");
  const translationPlanOptions = useMemo(
    () => TRANSLATION_PROVIDER_OPTIONS.filter((option) => option.id !== "mock").map((option) => {
      const providerId = option.providerId ?? agentCapabilities?.defaults.translation_provider;
      const capabilities = agentCapabilities;
      const provider = providerId && capabilities ? findAgentTranslationProvider(capabilities, providerId) : null;
      return {
        id: option.id,
        description: option.id === "server-default" ? "使用当前默认翻译方案" : provider?.reason || option.description,
        disabled: provider ? !provider.available : false,
        label: engineOptionLabel(option.label, option.id),
        selected: option.id === translationProvider
      };
    }),
    [agentCapabilities, translationProvider]
  );
  const subtitleVars = {
    "--subtitle-bg-opacity": subtitleStyle.backgroundOpacity,
    "--subtitle-blur": `${subtitleStyle.backgroundBlur}px`,
    "--caption-shadow-alpha": subtitleStyle.windowShadow,
    "--source-size": `${subtitleStyle.sourceScale}px`,
    "--target-size": `${subtitleStyle.targetScale}px`,
    "--source-color": subtitleStyle.sourceColor,
    "--target-color": subtitleStyle.targetColor
  } as CSSProperties;

  function dispatchOverlay(event: OverlayInteractionEvent) {
    setInteraction((current) => reduceOverlayInteraction(current, event));
  }

  useEffect(() => {
    displayBufferRef.current = displayBuffer;
  }, [displayBuffer]);

  useEffect(() => {
    const nextSelection = selectDisplayCaptionLines(displayBufferRef.current, overlayDisplayLines, Date.now());
    displayBufferRef.current = nextSelection.buffer;
    setDisplayBuffer(nextSelection.buffer);
  }, [overlayDisplayLines]);

  useEffect(() => {
    if (pendingLineCount === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      const nowMs = Date.now();
      const nextSelection = selectDisplayCaptionLines(displayBufferRef.current, overlayDisplayLines, nowMs);
      displayBufferRef.current = nextSelection.buffer;
      setDisplayBuffer(nextSelection.buffer);
      setDisplayNowMs(nowMs);
    }, 24);
    return () => window.clearTimeout(timer);
  }, [displayNowMs, overlayDisplayLines, pendingLineCount]);

  useEffect(() => {
    const nowMs = Date.now();
    const selectDisplayMs = displaySelectionResult.selectDisplayMs;
    const presentationMs = displayPresentationResult.presentationMs;
    const metricLogAgeMs = nowMs - overlayRenderMetricsLoggedAtRef.current;
    const shouldLog =
      ((selectDisplayMs >= 2 || presentationMs >= 2 || displaySelection.displayLag.max >= 16) && metricLogAgeMs >= 250) ||
      metricLogAgeMs >= 1000;
    if (!shouldLog) {
      return;
    }
    overlayRenderMetricsLoggedAtRef.current = nowMs;
    log.debug(overlayRenderMetricsEventName, {
      linesCount: lines.length,
      displayLagMax: displaySelection.displayLag.max,
      displayLagSourceMax: displaySelection.displayLag.sourceMax,
      displayLagTargetMax: displaySelection.displayLag.targetMax,
      displayLagTotal: displaySelection.displayLag.total,
      pendingLineCount,
      presentationMs: roundMetric(presentationMs),
      selectDisplayMs: roundMetric(selectDisplayMs),
      sessionId: snapshot.sessionId,
      windowLineCount: overlayDisplayLines.length
    });
  }, [
    displayPresentationResult.presentationMs,
    displaySelection.displayLag.max,
    displaySelection.displayLag.sourceMax,
    displaySelection.displayLag.targetMax,
    displaySelection.displayLag.total,
    pendingLineCount,
    displaySelectionResult.selectDisplayMs,
    lines.length,
    overlayDisplayLines.length,
    snapshot.sessionId
  ]);

  useEffect(() => {
    const remove = onOverlayWake(() => {
      dispatchOverlay({ type: "fallback.wake" });
    });
    return () => remove();
  }, []);

  useEffect(() => {
    const remove = onOverlaySettingsWake(() => {
      void openSubtitleSettings();
    });
    return () => remove();
  }, []);

  useEffect(() => {
    void setOverlayLayer(interaction.layer);
  }, [interaction.layer]);

  useEffect(() => {
    if (!isListening) {
      setSessionStartedAtMs(null);
      return;
    }

    const startedAt = Date.now();
    setSessionStartedAtMs((current) => current ?? startedAt);
    setSessionNowMs(startedAt);
    const timer = window.setInterval(() => setSessionNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [isListening]);

  const sessionDurationMs = selectSessionClockMs({
    isListening,
    lines,
    nowMs: sessionNowMs,
    startedAtMs: sessionStartedAtMs
  });

  async function toggleOverlayInteractionLock() {
    const nextLocked = !overlayInteractionLocked;
    setOverlayInteractionLocked(nextLocked);
    await setOverlayLocked(nextLocked);
    if (nextLocked) {
      dispatchOverlay({ type: "pointer.left", atMs: Date.now() });
    } else {
      dispatchOverlay({ type: "fallback.wake" });
    }
  }

  async function toggleSubtitleSettings() {
    const nextOpen = !subtitleSettingsOpen;
    setOverlayExitConfirmOpen(false);
    if (nextOpen) {
      await openSubtitleSettings();
      return;
    }

    setChromeMenu(null);
    setSubtitleSettingsOpen(false);
    dispatchOverlay({ type: "settings.closed" });
    await setSubtitleStyleWindowVisible(false);
  }

  async function openSubtitleSettings() {
    setOverlayExitConfirmOpen(false);
    setChromeMenu(null);
    setSubtitleSettingsOpen(true);
    dispatchOverlay({ type: "settings.opened" });
    await setSubtitleStyleWindowVisible(true);
  }

  function toggleChromeMenu(nextMenu: Exclude<OverlayChromeMenu, null>) {
    setOverlayExitConfirmOpen(false);
    setSubtitleSettingsOpen(false);
    void setSubtitleStyleWindowVisible(false);
    setChromeMenu((currentMenu) => {
      const shouldClose = currentMenu === nextMenu;
      dispatchOverlay(shouldClose ? { type: "settings.closed" } : { type: "settings.opened" });
      return shouldClose ? null : nextMenu;
    });
  }

  function closeChromeMenu() {
    setChromeMenu((currentMenu) => {
      if (currentMenu) {
        dispatchOverlay({ type: "settings.closed" });
      }
      return null;
    });
  }

  function selectOverlayDisplayMode(nextDisplayMode: SubtitleDisplayMode) {
    updateSubtitleStyle({ displayMode: nextDisplayMode });
    closeChromeMenu();
  }

  function selectOverlayTranslationProvider(nextProvider: TranslationProviderSelection) {
    onTranslationProviderSelect(nextProvider);
    closeChromeMenu();
  }

  function selectOverlayLanguageDirection(nextDirectionId: LanguageDirectionId) {
    onLanguageDirectionSelect(nextDirectionId);
    closeChromeMenu();
  }

  async function toggleOverlayCapture() {
    if (isListening) {
      onStop();
      return;
    }
    onSourceStart(snapshot.sourceId);
  }

  async function minimizeOverlay() {
    setOverlayExitConfirmOpen(false);
    closeChromeMenu();
    setSubtitleSettingsOpen(false);
    await setSubtitleStyleWindowVisible(false);
    await setOverlayVisible(false);
  }

  async function requestOverlayClose() {
    closeChromeMenu();
    setSubtitleSettingsOpen(false);
    await setSubtitleStyleWindowVisible(false);
    if (snapshot.state === "listening" || snapshot.state === "requesting") {
      setOverlayExitConfirmOpen(true);
      if (!isPinned) {
        dispatchOverlay({ type: "settings.opened" });
      }
      return;
    }
    await setOverlayVisible(false);
  }

  function cancelOverlayExit() {
    setOverlayExitConfirmOpen(false);
    if (!isPinned) {
      dispatchOverlay({ type: "settings.closed" });
    }
  }

  async function confirmOverlayExit() {
    setOverlayExitConfirmOpen(false);
    closeChromeMenu();
    setSubtitleSettingsOpen(false);
    await setSubtitleStyleWindowVisible(false);
    if (snapshot.state === "listening" || snapshot.state === "requesting") {
      onStop();
    }
    await setOverlayVisible(false);
  }

  async function selectMicrophoneCapture() {
    onSourceStart("microphone");
  }

  async function selectSystemCapture() {
    onSourceStart("windows-system");
  }

  return (
    <main className={`overlayShell pointer-${interaction.pointerMode}`}>
      <section
        className={`overlayStage layer-${interaction.layer}`}
        tabIndex={0}
        aria-label="EchoSync 实时双语字幕悬浮窗"
        onMouseEnter={() => {
          const atMs = Date.now();
          dispatchOverlay({ type: "pointer.entered", atMs });
          window.setTimeout(
            () => dispatchOverlay({ type: "hover.timer.elapsed", atMs: Date.now() }),
            interaction.hoverIntentDelayMs + 20
          );
        }}
        onMouseLeave={() => {
          const atMs = Date.now();
          dispatchOverlay({ type: "pointer.left", atMs });
          window.setTimeout(
            () => dispatchOverlay({ type: "collapse.timer.elapsed", atMs: Date.now() }),
            interaction.collapseDelayMs + 40
          );
        }}
      >
        <section
          className={`floatingCaption captionWindow ${showChrome ? "withChrome" : ""} ${hasCaptionHistory ? "hasHistory" : ""} ${bottomMenuOpen ? "hasBottomMenu" : ""} ${overlayExitConfirmOpen ? "hasExitConfirm" : ""} mode-${displayMode} outline-${subtitleStyle.outlineStyle}`}
          style={subtitleVars}
        >
          {showChrome ? (
            <div className="captionTopChrome">
              <OverlayToolbar
                displayMode={displayMode}
                activeMenu={chromeMenu}
                isPinned={isPinned}
                isSettingsOpen={subtitleSettingsOpen}
                isInteractionLocked={overlayInteractionLocked}
                onDisplayModeChange={selectOverlayDisplayMode}
                onInteractionLockToggle={() => void toggleOverlayInteractionLock()}
                onMenuToggle={toggleChromeMenu}
                onPinToggle={() => {
                  const nextPinned = !isPinned;
                  dispatchOverlay(nextPinned ? { type: "pin.enabled" } : { type: "pin.disabled" });
                  void setOverlayPinned(nextPinned);
                }}
                onMinimize={() => void minimizeOverlay()}
                onSettingsToggle={() => void toggleSubtitleSettings()}
                onClose={() => void requestOverlayClose()}
              />
            </div>
          ) : null}
          {showZonedCaptionRail ? (
            <ZonedCaptionRail lines={zonedCaptionLines} subtitleStyle={subtitleStyle} />
          ) : (
            <OverlayCaptionHistory
              contentMode={captionContentMode}
              lines={captionRailLines}
              subtitleStyle={subtitleStyle}
            />
          )}
          {bottomMenuOpen ? (
            <OverlayBottomMenuDock
              activeMenu={chromeMenu}
              languageDirection={languageDirection}
              onLanguageDirectionSelect={selectOverlayLanguageDirection}
              onPlanSelect={selectOverlayTranslationProvider}
              planOptions={translationPlanOptions}
            />
          ) : null}
          <div className="overlayMeta">
            <span className={`liveDot state-${snapshot.state}`} />
            <span>{isListening ? "正在同传" : "实时字幕"}</span>
            <span>{displayActiveLine ? `${formatTime(displayActiveLine.startMs)}-${formatTime(displayActiveLine.endMs)}` : "等待时间帧"}</span>
            <span>{sourceLabel(snapshot.sourceId)}</span>
          </div>
          {showChrome ? (
            <div className="captionBottomChrome">
              <OverlaySessionBar
                captionContentMode={captionContentMode}
                activeMenu={chromeMenu}
                durationMs={sessionDurationMs}
                isListening={isListening}
                languageDirection={languageDirection}
                onCaptureToggle={() => void toggleOverlayCapture()}
                onContentModeChange={setCaptionContentMode}
                onMenuToggle={toggleChromeMenu}
                onMicrophoneSelect={() => void selectMicrophoneCapture()}
                onSystemSelect={() => void selectSystemCapture()}
                planLabel={planLabel}
                snapshot={snapshot}
              />
            </div>
          ) : null}
          {overlayExitConfirmOpen ? (
            <OverlayExitConfirmDialog
              onCancel={cancelOverlayExit}
              onConfirm={() => void confirmOverlayExit()}
            />
          ) : null}
          <OverlayResizeHandles
            onResizeEnd={() => dispatchOverlay({ type: "drag.ended" })}
            onResizeStart={() => dispatchOverlay({ type: "drag.started" })}
          />
        </section>
      </section>
    </main>
  );
}
