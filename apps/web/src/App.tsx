import { useMemo, useState } from "react";

import type { SubtitleEvent } from "@/lib/protocol";

const demoEvents: SubtitleEvent[] = [
  {
    type: "translation.partial",
    session_id: "sess_demo",
    segment_id: "seg_1",
    rev: 1,
    source_lang: "en",
    target_lang: "zh-CN",
    source_text: "Today we will talk about vector databases.",
    target_text: "今天我们来谈谈向量数据库。",
    status: "committed",
    stability: 0.96,
    start_ms: 0,
    end_ms: 2200
  },
  {
    type: "translation.partial",
    session_id: "sess_demo",
    segment_id: "seg_2",
    rev: 1,
    source_lang: "en",
    target_lang: "zh-CN",
    source_text: "CUDA kernels make the pipeline faster.",
    target_text: "CUDA 内核让这条管道更快。",
    status: "partial",
    stability: 0.74,
    start_ms: 2300,
    end_ms: 4300
  }
];

export function App() {
  const [audioSource, setAudioSource] = useState("tab");
  const committed = useMemo(
    () => demoEvents.filter((event) => event.status === "committed"),
    []
  );
  const active = demoEvents.find((event) => event.status !== "committed");

  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <p className="eyebrow">EchoSync</p>
          <h1>AI 同声传译工作台</h1>
        </div>
        <div className="transport" aria-label="音频来源">
          <button
            className={audioSource === "mic" ? "selected" : ""}
            onClick={() => setAudioSource("mic")}
          >
            麦克风
          </button>
          <button
            className={audioSource === "tab" ? "selected" : ""}
            onClick={() => setAudioSource("tab")}
          >
            标签页音频
          </button>
          <button
            className={audioSource === "file" ? "selected" : ""}
            onClick={() => setAudioSource("file")}
          >
            文件
          </button>
        </div>
      </header>

      <section className="console">
        <div className="subtitlePane">
          <p className="label">中文字幕</p>
          {committed.map((event) => (
            <p className="subtitle committed" key={event.segment_id}>
              {event.target_text}
            </p>
          ))}
          {active ? (
            <p className="subtitle partial" key={active.segment_id}>
              {active.target_text}
            </p>
          ) : null}
        </div>

        <aside className="sideRail">
          <div className="metric">
            <span>模式</span>
            <strong>Tech</strong>
          </div>
          <div className="metric">
            <span>目标语言</span>
            <strong>中文</strong>
          </div>
          <div className="metric">
            <span>稳定度</span>
            <strong>{active ? Math.round(active.stability * 100) : 100}%</strong>
          </div>
          <div className="glossary">
            <p>术语表</p>
            <span>CUDA</span>
            <span>vector database</span>
            <span>pipeline</span>
          </div>
        </aside>
      </section>
    </main>
  );
}
