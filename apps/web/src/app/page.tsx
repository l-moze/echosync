"use client";

import { useMemo, useState, type CSSProperties } from "react";

import {
  applyRealtimeEvent,
  demoEvents,
  glossaryTerms,
  initialCaptionLines,
  modeDescriptions,
  modeLabels,
  noteCards,
  sessionMetrics,
  type AudioSource,
  type CaptureState,
  type WorkstationMode
} from "@/lib/demo-session";
import type { CaptionLineModel } from "@/lib/protocol";

const audioSourceLabels: Record<AudioSource, string> = {
  mic: "麦克风",
  tab: "标签页音频",
  file: "文件"
};

const sourceOptions: AudioSource[] = ["tab", "mic", "file"];
const modeOptions: WorkstationMode[] = ["workstation", "theater", "reading", "compact"];

export default function Home() {
  const [mode, setMode] = useState<WorkstationMode>("workstation");
  const [audioSource, setAudioSource] = useState<AudioSource>("tab");
  const [captureState, setCaptureState] = useState<CaptureState>("listening");
  const [fontScale, setFontScale] = useState(1);
  const [showSource, setShowSource] = useState(true);
  const [translatedAudioEnabled, setTranslatedAudioEnabled] = useState(false);
  const [lines, setLines] = useState<CaptionLineModel[]>(initialCaptionLines);
  const [eventIndex, setEventIndex] = useState(0);

  const activeLine = useMemo(
    () => [...lines].reverse().find((line) => line.state !== "locked") ?? lines.at(-1),
    [lines]
  );

  const statusText = captureState === "listening" ? "正在听译" : "等待音频";

  function toggleCapture() {
    setCaptureState((current) => (current === "listening" ? "idle" : "listening"));
  }

  function playNextEvent() {
    const event = demoEvents[eventIndex % demoEvents.length];
    setLines((current) => applyRealtimeEvent(current, event, Date.now()));
    setEventIndex((current) => current + 1);
  }

  return (
    <main className={`workspace mode-${mode}`}>
      <SessionBar
        audioSource={audioSource}
        captureState={captureState}
        fontScale={fontScale}
        mode={mode}
        showSource={showSource}
        translatedAudioEnabled={translatedAudioEnabled}
        onAudioSourceChange={setAudioSource}
        onCaptureToggle={toggleCapture}
        onFontScaleChange={setFontScale}
        onModeChange={setMode}
        onShowSourceChange={setShowSource}
        onTranslatedAudioToggle={() => setTranslatedAudioEnabled((value) => !value)}
      />

      <section className="shell" aria-label="同传工作区">
        <aside className="sessionRail">
          <PanelTitle title="会话" subtitle="LiveKit / 级联模拟" />
          <button className="primaryAction" onClick={toggleCapture}>
            {captureState === "listening" ? "暂停听译" : "开始听译"}
          </button>
          <button className="secondaryAction" onClick={playNextEvent}>
            推进模拟事件
          </button>
          <div className="sourceGrid" aria-label="输入源">
            {sourceOptions.map((source) => (
              <button
                className={audioSource === source ? "selected" : ""}
                key={source}
                onClick={() => setAudioSource(source)}
              >
                {audioSourceLabels[source]}
              </button>
            ))}
          </div>
          <div className="metricStack">
            {sessionMetrics.map((metric) => (
              <div className={`metric tone-${metric.tone ?? "muted"}`} key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        </aside>

        <SubtitleStage
          activeLine={activeLine}
          fontScale={fontScale}
          lines={lines}
          mode={mode}
          showSource={showSource}
        />

        <ContextRail lines={lines} mode={mode} />
      </section>

      <HistoryTimeline lines={lines} />
      <CompactOverlay activeLine={activeLine} mode={mode} />

      <div aria-live="polite" className="srOnly" role="status">
        {statusText}，当前模式：{modeLabels[mode]}。
      </div>
    </main>
  );
}

function SessionBar({
  audioSource,
  captureState,
  fontScale,
  mode,
  showSource,
  translatedAudioEnabled,
  onAudioSourceChange,
  onCaptureToggle,
  onFontScaleChange,
  onModeChange,
  onShowSourceChange,
  onTranslatedAudioToggle
}: {
  audioSource: AudioSource;
  captureState: CaptureState;
  fontScale: number;
  mode: WorkstationMode;
  showSource: boolean;
  translatedAudioEnabled: boolean;
  onAudioSourceChange: (source: AudioSource) => void;
  onCaptureToggle: () => void;
  onFontScaleChange: (scale: number) => void;
  onModeChange: (mode: WorkstationMode) => void;
  onShowSourceChange: (visible: boolean) => void;
  onTranslatedAudioToggle: () => void;
}) {
  return (
    <header className="sessionBar">
      <div className="brandBlock">
        <span className="brandMark">ES</span>
        <div>
          <p>EchoSync</p>
          <h1>AI 同声传译工作台</h1>
        </div>
      </div>

      <ModeSwitcher mode={mode} onModeChange={onModeChange} />

      <div className="topControls">
        <label>
          输入
          <select value={audioSource} onChange={(event) => onAudioSourceChange(event.target.value as AudioSource)}>
            {sourceOptions.map((source) => (
              <option key={source} value={source}>
                {audioSourceLabels[source]}
              </option>
            ))}
          </select>
        </label>
        <label>
          字号
          <input
            max="1.25"
            min="0.85"
            step="0.05"
            type="range"
            value={fontScale}
            onChange={(event) => onFontScaleChange(Number(event.target.value))}
          />
        </label>
        <button className={showSource ? "selected" : ""} onClick={() => onShowSourceChange(!showSource)}>
          双语
        </button>
        <button className={translatedAudioEnabled ? "selected" : ""} onClick={onTranslatedAudioToggle}>
          译音
        </button>
        <button className="listenButton" onClick={onCaptureToggle}>
          {captureState === "listening" ? "停止" : "开始"}
        </button>
      </div>
    </header>
  );
}

function ModeSwitcher({
  mode,
  onModeChange
}: {
  mode: WorkstationMode;
  onModeChange: (mode: WorkstationMode) => void;
}) {
  return (
    <nav className="modeSwitcher" aria-label="显示模式">
      {modeOptions.map((option) => (
        <button
          className={mode === option ? "selected" : ""}
          key={option}
          title={modeDescriptions[option]}
          onClick={() => onModeChange(option)}
        >
          {modeLabels[option]}
        </button>
      ))}
    </nav>
  );
}

function SubtitleStage({
  activeLine,
  fontScale,
  lines,
  mode,
  showSource
}: {
  activeLine?: CaptionLineModel;
  fontScale: number;
  lines: CaptionLineModel[];
  mode: WorkstationMode;
  showSource: boolean;
}) {
  const visibleLines = mode === "reading" ? lines : lines.slice(-3);

  return (
    <section className="subtitleStage" style={{ "--caption-scale": fontScale } as CSSProperties}>
      <div className="stageHeader">
        <PanelTitle title="实时字幕" subtitle={activeLine ? `${Math.round((activeLine.confidence ?? 0) * 100)}% 稳定度` : "等待音频"} />
        <div className="waveform" aria-hidden="true">
          {Array.from({ length: 18 }).map((_, index) => (
            <span key={index} style={{ "--bar": `${24 + ((index * 17) % 46)}%` } as CSSProperties} />
          ))}
        </div>
      </div>
      <div className="captionStack">
        {visibleLines.map((line) => (
          <CaptionLine key={line.id} line={line} showSource={showSource} />
        ))}
      </div>
    </section>
  );
}

function CaptionLine({ line, showSource }: { line: CaptionLineModel; showSource: boolean }) {
  const latestPatch = line.patches.at(-1);

  return (
    <article className={`captionLine state-${line.state}`}>
      {showSource ? <p className="sourceText">{line.sourceText}</p> : null}
      <p className="targetText">{line.targetText}</p>
      <div className="lineMeta">
        <span>{captionStateLabel(line.state)}</span>
        <span>{formatTime(line.startedAtMs)} - {formatTime(line.endedAtMs ?? line.startedAtMs)}</span>
        {latestPatch ? (
          <span className="patchChip">
            修订：{latestPatch.prev || "插入"} → {latestPatch.next || "删除"}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function ContextRail({ lines, mode }: { lines: CaptionLineModel[]; mode: WorkstationMode }) {
  return (
    <aside className="contextRail" data-mode={mode}>
      <PanelTitle title="上下文" subtitle="源文 / 术语 / 笔记" />
      <section className="railSection">
        <h2>源文流</h2>
        {lines.slice(-3).map((line) => (
          <p className="sourceSnippet" key={line.id}>
            {line.sourceText}
          </p>
        ))}
      </section>
      <section className="railSection">
        <h2>术语表</h2>
        <div className="termList">
          {glossaryTerms.map((term) => (
            <div className="termItem" key={term.source}>
              <strong>{term.source}</strong>
              <span>{term.target}</span>
              <p>{term.note}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="railSection">
        <h2>笔记</h2>
        {noteCards.map((note) => (
          <article className="noteCard" key={note.id}>
            <span>{formatTime(note.atMs)}</span>
            <strong>{note.title}</strong>
            <p>{note.body}</p>
          </article>
        ))}
      </section>
    </aside>
  );
}

function HistoryTimeline({ lines }: { lines: CaptionLineModel[] }) {
  return (
    <section className="historyTimeline" aria-label="历史时间线">
      {lines.map((line) => (
        <button className={`timelineItem state-${line.state}`} key={line.id}>
          <span>{formatTime(line.startedAtMs)}</span>
          <strong>{line.targetText}</strong>
        </button>
      ))}
    </section>
  );
}

function CompactOverlay({
  activeLine,
  mode
}: {
  activeLine?: CaptionLineModel;
  mode: WorkstationMode;
}) {
  if (mode !== "compact" || !activeLine) {
    return null;
  }

  return (
    <aside className="compactOverlay">
      <span>{captionStateLabel(activeLine.state)}</span>
      <strong>{activeLine.targetText}</strong>
    </aside>
  );
}

function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="panelTitle">
      <p>{subtitle}</p>
      <h2>{title}</h2>
    </div>
  );
}

function captionStateLabel(state: CaptionLineModel["state"]) {
  const labels: Record<CaptionLineModel["state"], string> = {
    interim: "识别中",
    stable: "已稳定",
    revised: "已修订",
    locked: "已锁定"
  };
  return labels[state];
}

function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const tenths = Math.floor((ms % 1000) / 100);
  return `${seconds}.${tenths}s`;
}
