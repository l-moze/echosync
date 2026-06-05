import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import { DESKTOP_AUDIO_SOURCES, type DesktopAudioSource, type DesktopAudioSourceId } from "../shared/audio-source-catalog";
import { applyRealtimeEvent, type CaptionLine } from "../shared/caption-store";
import type { DesktopCaptureSnapshot } from "../shared/desktop-api";
import type { RealtimeEvent } from "../shared/realtime-events";
import {
  createInitialSessionUiState,
  reduceSessionUiState,
  type SessionSummary,
  type SessionUiEvent
} from "../shared/session-ui-state";
import { resolveDesktopWindowRole } from "./window-role";

import "./styles.css";

const demoEvents: RealtimeEvent[] = [
  {
    type: "translation.partial",
    session_id: "sess_desktop",
    segment_id: "seg_live_1",
    rev: 1,
    source_lang: "en",
    target_lang: "zh-CN",
    source_text: "We need a low latency caption overlay for every meeting.",
    target_text: "我们需要一个适用于每场会议的低延迟字幕浮窗。",
    status: "partial",
    stability: 0.66,
    start_ms: 0,
    end_ms: 2600
  },
  {
    type: "translation.patch",
    session_id: "sess_desktop",
    segment_id: "seg_live_1",
    rev: 2,
    base_rev: 1,
    target_lang: "zh-CN",
    operations: [{ op: "replace", from_char: 21, to_char: 25, text: "悬浮字幕窗" }],
    reason: "terminology",
    stability: 0.88
  },
  {
    type: "segment.commit",
    session_id: "sess_desktop",
    segment_id: "seg_live_1",
    rev: 2,
    start_ms: 0,
    end_ms: 2600,
    source_lang: "en",
    target_lang: "zh-CN",
    source_text: "We need a low latency caption overlay for every meeting.",
    target_text: "我们需要一个适用于每场会议的低延迟悬浮字幕窗。",
    final: true
  },
  {
    type: "translation.partial",
    session_id: "sess_desktop",
    segment_id: "seg_live_2",
    rev: 1,
    source_lang: "en",
    target_lang: "zh-CN",
    source_text: "System audio capture should stay outside the AI pipeline.",
    target_text: "系统音频采集应该保持在 AI 管道之外。",
    status: "stable",
    stability: 0.91,
    start_ms: 2700,
    end_ms: 5200
  }
];

const initialLines: CaptionLine[] = [
  {
    id: "seg_seed_1",
    rev: 1,
    state: "locked",
    sourceText: "Today we are watching a live keynote.",
    targetText: "今天我们正在观看一场直播主题演讲。",
    stability: 1,
    startMs: 0,
    endMs: 1800,
    patchCount: 0
  },
  {
    id: "seg_seed_2",
    rev: 1,
    state: "stable",
    sourceText: "The assistant keeps subtitles above any Windows app.",
    targetText: "助手会把字幕保持在任意 Windows 应用上方。",
    stability: 0.9,
    startMs: 1900,
    endMs: 3900,
    patchCount: 0
  }
];

function App() {
  const role = resolveDesktopWindowRole(window.location.hash);
  const [lines, setLines] = useState<CaptionLine[]>(initialLines);
  const [eventIndex, setEventIndex] = useState(0);
  const [sourceId, setSourceId] = useState<DesktopAudioSourceId>("windows-system");
  const [overlayLocked, setOverlayLocked] = useState(false);
  const [sessionUi, setSessionUi] = useState(() => createInitialSessionUiState({ platform: "windows" }));
  const [snapshot, setSnapshot] = useState<DesktopCaptureSnapshot>({
    sourceId: "windows-system",
    state: "idle",
    message: "等待选择音频源。"
  });

  useEffect(() => {
    const removeCaptionListener = window.echosyncDesktop?.onRealtimeEvent((event) => {
      setLines((current) => applyRealtimeEvent(current, event));
    });
    const removeCaptureListener = window.echosyncDesktop?.onCaptureState((nextSnapshot) => {
      setSnapshot(nextSnapshot);
      setSourceId(nextSnapshot.sourceId);
    });
    return () => {
      removeCaptionListener?.();
      removeCaptureListener?.();
    };
  }, []);

  const activeLine = useMemo(() => [...lines].reverse().find((line) => line.state !== "locked") ?? lines.at(-1), [lines]);
  const currentSource = DESKTOP_AUDIO_SOURCES.find((source) => source.id === sourceId) ?? DESKTOP_AUDIO_SOURCES[1];

  function dispatchSessionUi(event: SessionUiEvent) {
    setSessionUi((current) => reduceSessionUiState(current, event));
  }

  useEffect(() => {
    if (sessionUi.lifecycle !== "idle") {
      return;
    }

    const timer = window.setInterval(() => {
      dispatchSessionUi({
        type: "audio.level.changed",
        peak: sourceId === "windows-system" ? 0.38 : 0.18,
        rms: sourceId === "windows-system" ? 0.12 : 0.05
      });
    }, 1200);

    return () => window.clearInterval(timer);
  }, [sessionUi.lifecycle, sourceId]);

  async function startCapture(nextSourceId = sourceId) {
    const nextSnapshot = await window.echosyncDesktop?.startCapture(nextSourceId);
    if (nextSnapshot) {
      setSnapshot(nextSnapshot);
      dispatchSessionUi({ type: "session.started" });
      await window.echosyncDesktop?.setOverlayVisible(true);
    }
  }

  async function stopCapture() {
    const nextSnapshot = await window.echosyncDesktop?.stopCapture();
    if (nextSnapshot) {
      setSnapshot(nextSnapshot);
      const summary: SessionSummary = {
        durationMs: Math.max(...lines.map((line) => line.endMs), 0),
        segmentCount: lines.length,
        patchCount: lines.reduce((sum, line) => sum + line.patchCount, 0),
        averageLatencyMs: 920,
        wordCount: lines.reduce((sum, line) => sum + line.targetText.length, 0)
      };
      dispatchSessionUi({ type: "session.finished", summary });
    }
  }

  async function pushDemoEvent() {
    const event = demoEvents[eventIndex % demoEvents.length];
    setEventIndex((current) => current + 1);
    await window.echosyncDesktop?.sendRealtimeEvent(event);
  }

  async function toggleOverlayLocked() {
    const next = !overlayLocked;
    setOverlayLocked(next);
    await window.echosyncDesktop?.setOverlayLocked(next);
  }

  if (role === "overlay") {
    return <OverlayWindow activeLine={activeLine} snapshot={snapshot} />;
  }

  return (
    <main className="controlShell">
      <header className="titleBar">
        <div className="brand">
          <span className="brandDot" />
          <strong>EchoSync</strong>
        </div>
        <div className="centerPill">{snapshot.state === "listening" ? "同传中" : "免费 1 小时"}</div>
        <div className="windowActions">
          <button title="显示字幕窗" onClick={() => window.echosyncDesktop?.setOverlayVisible(true)}>
            实时字幕
          </button>
          <button title="推进模拟字幕事件" onClick={() => void pushDemoEvent()}>
            模拟
          </button>
          <button title="最小化" onClick={() => window.echosyncDesktop?.minimize()}>
            -
          </button>
          <button title="最大化/还原" onClick={() => window.echosyncDesktop?.toggleMaximize()}>
            ⛶
          </button>
          <button title="关闭" onClick={() => window.echosyncDesktop?.close()}>
            ×
          </button>
        </div>
      </header>

      <section className="homeShell">
        <ControlCenter
          activeLine={activeLine}
          currentSource={currentSource}
          lines={lines}
          onShowOverlay={() => window.echosyncDesktop?.setOverlayVisible(true)}
          onSourceSelect={(nextSourceId) => setSourceId(nextSourceId)}
          onStart={() => void startCapture()}
          onStop={() => void stopCapture()}
          overlayLocked={overlayLocked}
          sessionUi={sessionUi}
          sourceId={sourceId}
          toggleOverlayLocked={() => void toggleOverlayLocked()}
        />
      </section>
    </main>
  );
}

function ControlCenter({
  activeLine,
  currentSource,
  lines,
  onShowOverlay,
  onSourceSelect,
  onStart,
  onStop,
  overlayLocked,
  sessionUi,
  sourceId,
  toggleOverlayLocked
}: {
  activeLine?: CaptionLine;
  currentSource: DesktopAudioSource;
  lines: CaptionLine[];
  onShowOverlay: () => void;
  onSourceSelect: (sourceId: DesktopAudioSourceId) => void;
  onStart: () => void;
  onStop: () => void;
  overlayLocked: boolean;
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
  sourceId: DesktopAudioSourceId;
  toggleOverlayLocked: () => void;
}) {
  return (
    <section className={`controlCenter lifecycle-${sessionUi.lifecycle}`}>
      {sessionUi.lifecycle === "idle" ? (
        <IdleDashboard
          currentSource={currentSource}
          onShowOverlay={onShowOverlay}
          onSourceSelect={onSourceSelect}
          onStart={onStart}
          sessionUi={sessionUi}
          sourceId={sourceId}
        />
      ) : null}
      {sessionUi.lifecycle === "active" ? (
        <ActiveDashboard
          activeLine={activeLine}
          lines={lines}
          onStop={onStop}
          overlayLocked={overlayLocked}
          sessionUi={sessionUi}
          sourceId={sourceId}
          toggleOverlayLocked={toggleOverlayLocked}
        />
      ) : null}
      {sessionUi.lifecycle === "finished" ? <FinishedDashboard lines={lines} onStart={onStart} sessionUi={sessionUi} /> : null}
    </section>
  );
}

function IdleDashboard({
  currentSource,
  onShowOverlay,
  onSourceSelect,
  onStart,
  sessionUi,
  sourceId
}: {
  currentSource: DesktopAudioSource;
  onShowOverlay: () => void;
  onSourceSelect: (sourceId: DesktopAudioSourceId) => void;
  onStart: () => void;
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
  sourceId: DesktopAudioSourceId;
}) {
  return (
    <div className="dashboardGrid">
      <section className="heroStart">
        <p className="eyebrow">默认开箱</p>
        <h1>给当前视频挂上实时双语字幕</h1>
        <p>默认使用 {currentSource.label}，先确认电平条有响应，再开始同传。</p>
        <div className="sourceTabs horizontal">
          {DESKTOP_AUDIO_SOURCES.map((source) => (
            <button className={source.id === sourceId ? "selected" : ""} key={source.id} onClick={() => onSourceSelect(source.id)}>
              {source.label}
            </button>
          ))}
        </div>
        <div className="presetGrid">
          {["视频/网课", "远程会议", "技术分享", "文件回放"].map((label, index) => (
            <button className={index === 0 ? "presetCard selected" : "presetCard"} key={label}>
              <strong>{label}</strong>
              <span>{index === 0 ? "低风险开箱体验" : "专业场景预设"}</span>
            </button>
          ))}
        </div>
        <div className="startActions">
          <button className="primary" onClick={onStart}>开始同传</button>
          <button onClick={onShowOverlay}>打开字幕弹窗预览</button>
        </div>
        <PreflightAudioVisualizer sessionUi={sessionUi} />
      </section>
      <aside className="dashboardPanel">
        <h2>准备就绪检查</h2>
        <HealthMetric label="输入源" value={currentSource.label} />
        <HealthMetric label="音频活动" value={sessionUi.audioActivity} />
        <HealthMetric label="字幕窗" value="可打开" />
        <HealthMetric label="Provider" value="级联模拟" />
      </aside>
    </div>
  );
}

function ActiveDashboard({
  activeLine,
  lines,
  onStop,
  overlayLocked,
  sessionUi,
  sourceId,
  toggleOverlayLocked
}: {
  activeLine?: CaptionLine;
  lines: CaptionLine[];
  onStop: () => void;
  overlayLocked: boolean;
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
  sourceId: DesktopAudioSourceId;
  toggleOverlayLocked: () => void;
}) {
  return (
    <div className="dashboardGrid">
      <section className="dashboardPanel">
        <div className="activeToolbar">
          <span className="centerPill">同传中</span>
          <button onClick={onStop}>停止并复盘</button>
          <button className={overlayLocked ? "selected" : ""} onClick={toggleOverlayLocked}>
            {overlayLocked ? "穿透中" : "允许交互"}
          </button>
        </div>
        <TranscriptMonitor activeLine={activeLine} lines={lines} sessionUi={sessionUi} />
      </section>
      <aside className="dashboardPanel">
        <h2>会话驾驶舱</h2>
        <HealthPanel lines={lines} sessionUi={sessionUi} sourceId={sourceId} />
        <TermQuickAddMock sessionUi={sessionUi} />
      </aside>
    </div>
  );
}

function FinishedDashboard({
  lines,
  onStart,
  sessionUi
}: {
  lines: CaptionLine[];
  onStart: () => void;
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
}) {
  return (
    <div className="dashboardGrid">
      <section className="summaryPanel">
        <p className="eyebrow">本次复盘</p>
        <h1>同传已结束，可以清理后导出</h1>
        <SessionSummaryPanel lines={lines} sessionUi={sessionUi} />
        <div className="startActions">
          <button className="primary">快速清理</button>
          <button>导出 Markdown</button>
          <button>导出 SRT</button>
          <button onClick={onStart}>开始新会话</button>
        </div>
      </section>
      <RecentSessionsPanel />
    </div>
  );
}

function PreflightAudioVisualizer({ sessionUi }: { sessionUi: ReturnType<typeof createInitialSessionUiState> }) {
  const width = `${Math.round(sessionUi.preflight.level.rms * 100)}%`;
  return (
    <div className="preflightMeter">
      <div className="meterTrack"><span className="meterFill" style={{ width }} /></div>
      <p>{sessionUi.preflight.warning ?? "音频输入正常，可以开始。"}</p>
    </div>
  );
}

function TranscriptMonitor({
  activeLine,
  lines,
  sessionUi
}: {
  activeLine?: CaptionLine;
  lines: CaptionLine[];
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
}) {
  return (
    <div className="transcriptMonitor">
      {lines.slice(-8).map((line) => (
        <article className={`transcriptItem ${line.state}`} key={line.id}>
          <span>{formatTime(line.startMs)} · {line.state.toUpperCase()}</span>
          <p className="sourceText">{line.sourceText}</p>
          <p className="targetText">{line.targetText}</p>
        </article>
      ))}
      {activeLine ? <p className="statusBox">当前片段：{activeLine.targetText}</p> : null}
      {sessionUi.autoScroll.newContentAvailable ? <button className="newContentButton">有新内容，回到当前</button> : null}
    </div>
  );
}

function HealthPanel({
  lines,
  sessionUi,
  sourceId
}: {
  lines: CaptionLine[];
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
  sourceId: DesktopAudioSourceId;
}) {
  const patchCount = lines.reduce((sum, line) => sum + line.patchCount, 0);
  return (
    <div className="healthGrid">
      <HealthMetric label="输入源" value={sourceLabel(sourceId)} />
      <HealthMetric label="首字幕" value="640 ms" />
      <HealthMetric label="稳定提交" value="1.8 s" />
      <HealthMetric label="Patch" value={`${patchCount} 次`} />
      <HealthMetric label="置信来源" value={sessionUi.confidence.label} />
    </div>
  );
}

function HealthMetric({ label, value }: { label: string; value: string }) {
  return <div className="healthMetric"><span>{label}</span><strong>{value}</strong></div>;
}

function TermQuickAddMock({ sessionUi }: { sessionUi: ReturnType<typeof createInitialSessionUiState> }) {
  return (
    <section className="termQuickAdd">
      <h3>术语快加</h3>
      <div className="statusBox">agent -&gt; 智能体 · {sessionUi.terms[0]?.status ?? "待注入"}</div>
      <p>新术语通常从后续片段开始生效。</p>
    </section>
  );
}

function SessionSummaryPanel({
  lines,
  sessionUi
}: {
  lines: CaptionLine[];
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
}) {
  return (
    <div className="summaryMetrics">
      <HealthMetric label="片段数" value={`${sessionUi.summary?.segmentCount ?? lines.length}`} />
      <HealthMetric label="修订次数" value={`${sessionUi.summary?.patchCount ?? 0}`} />
      <HealthMetric label="总字数" value={`${sessionUi.summary?.wordCount ?? 0}`} />
      <HealthMetric label="平均延迟" value={`${sessionUi.summary?.averageLatencyMs ?? 0} ms`} />
    </div>
  );
}

function RecentSessionsPanel() {
  return (
    <aside className="dashboardPanel">
      <h2>最近记录</h2>
      <article className="statusBox">技术分享 · 12 分钟 · 已生成双语转写</article>
      <article className="statusBox">网课回放 · 8 分钟 · 可导出 SRT</article>
    </aside>
  );
}

function OverlayWindow({ activeLine, snapshot }: { activeLine?: CaptionLine; snapshot: DesktopCaptureSnapshot }) {
  const isListening = snapshot.state === "listening";

  return (
    <main className="overlayShell">
      <section className="floatingCaption" tabIndex={0} aria-label="EchoSync 实时双语字幕悬浮窗">
        <div className="captionText">
          <p className="overlaySource">{activeLine?.sourceText ?? "Waiting for audio stream..."}</p>
          <h1>{activeLine?.targetText ?? "等待 Windows 系统声音或麦克风输入"}</h1>
        </div>
        <div className={isListening ? "focusMeter active" : "focusMeter"} aria-label={isListening ? "正在同传" : "实时字幕待命"}>
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="overlayMeta">
          <span className={`liveDot state-${snapshot.state}`} />
          <span>{isListening ? "正在同传" : "实时字幕"}</span>
          <span>{sourceLabel(snapshot.sourceId)}</span>
        </div>
      </section>
    </main>
  );
}

function sourceLabel(sourceId: DesktopAudioSourceId) {
  return DESKTOP_AUDIO_SOURCES.find((source: DesktopAudioSource) => source.id === sourceId)?.label ?? "未知来源";
}

function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

createRoot(document.getElementById("root")!).render(<App />);
