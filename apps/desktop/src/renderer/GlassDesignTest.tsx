import { useState } from "react";
import { GlassCard } from "./components/common/GlassCard";
import { GradientButton } from "./components/common/GradientButton";
import { SearchField } from "./components/common/SearchField";
import { WaveformProgress } from "./components/common/WaveformProgress";
import { TabBar } from "./components/common/TabBar";
import { RecordDetailHeader } from "./components/records/RecordDetailHeader";
import { RecordPlayer } from "./components/records/RecordPlayer";
import { TopBar } from "./components/records/TopBar";
import { TranscriptSegment } from "./components/records/TranscriptSegment";
import { SummaryPanel } from "./components/records/SummaryPanel";
import { TranscriptToolbar } from "./components/records/TranscriptToolbar";

import "./styles.css";
import "./styles/glass-design.css";

export function GlassDesignTest() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("bilingual");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(64000);
  const [title, setTitle] = useState("2026年06月11日_记录");
  const [activeSegment, setActiveSegment] = useState(0);

  const durationMs = 188000; // 3:08

  const segments = [
    {
      timestamp: "00:00 – 00:11",
      source: "is really to capture embodied human data from an egocentric view at an eye level.",
      translation: "捕捉具身人类数据，从第一人称视角、眼睛高度出发。"
    },
    {
      timestamp: "00:11 – 00:17",
      source: "So we want to capture our authentic experience through viral sensing.",
      translation: "所以我们希望通过体感 sensing 来捕捉真实体验。"
    },
    {
      timestamp: "00:17 – 00:24",
      source: "And then build the spatial understanding through that.",
      translation: "然后通过这些数据构建对空间的理解。"
    }
  ];

  return (
    <div style={{ padding: "40px", minHeight: "100vh", overflowY: "auto", height: "100vh" }}>
      <div style={{ position: "sticky", top: "0", background: "rgba(255,255,255,0.9)", backdropFilter: "blur(10px)", padding: "12px 0", marginBottom: "20px", zIndex: 10, borderBottom: "1px solid var(--glass-line)" }}>
        <button
          onClick={() => window.location.hash = ""}
          style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid var(--glass-line)", background: "#fff", cursor: "pointer" }}
        >
          ← 返回主应用
        </button>
      </div>
      <h1 style={{ marginBottom: "32px", color: "var(--text-strong)" }}>Glass Design System 组件测试</h1>

      {/* Test 9: TopBar */}
      <section style={{ marginBottom: "40px" }}>
        <h2 style={{ marginBottom: "16px" }}>9. TopBar（顶部导航栏）</h2>
        <TopBar
          onBack={() => alert("返回")}
          productName="EchoSync Review"
          pageTitle="双语复盘"
          statusTexts={["已自动保存 · 10:24", "⌘K 快捷操作"]}
        />
      </section>

      {/* Test 10: Transcript Segment */}
      <section style={{ marginBottom: "40px" }}>
        <h2 style={{ marginBottom: "16px" }}>10. TranscriptSegment（字幕卡片）</h2>
        <GlassCard>
          <div style={{ padding: "8px 16px" }}>
            {segments.map((seg, i) => (
              <TranscriptSegment
                key={i}
                timestamp={seg.timestamp}
                sourceText={seg.source}
                translationText={seg.translation}
                isActive={i === activeSegment}
                isMatch={searchQuery ? seg.source.toLowerCase().includes(searchQuery.toLowerCase()) : false}
                onPlay={() => {
                  setActiveSegment(i);
                  alert(`播放片段 ${i + 1}`);
                }}
                highlightQuery={searchQuery}
              />
            ))}
          </div>
        </GlassCard>
      </section>

      {/* Test 11: Transcript Toolbar */}
      <section style={{ marginBottom: "40px" }}>
        <h2 style={{ marginBottom: "16px" }}>11. TranscriptToolbar（字幕工具栏）</h2>
        <GlassCard>
          <TranscriptToolbar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            searchResultCount={searchQuery ? 2 : undefined}
            onPrevMatch={() => alert("上一个")}
            onNextMatch={() => alert("下一个")}
          />
          <div style={{ padding: "20px", color: "var(--muted)" }}>
            工具栏已展示
          </div>
        </GlassCard>
      </section>

      {/* Test 12: Summary Panel */}
      <section style={{ marginBottom: "40px" }}>
        <h2 style={{ marginBottom: "16px" }}>12. SummaryPanel（摘要面板）</h2>
        <div style={{ maxWidth: "370px" }}>
          <GlassCard>
            <SummaryPanel
              summary="本次对话主要探讨了通过眼镜等设备以第一人称视角采集具身人类数据，并将其转化为与机器人数据等价的体验。"
              tags={["第一人称视角", "具身数据", "机器人数据对齐", "眼镜设备", "空间理解"]}
              keywords={[
                { name: "人类数据", percentage: 28 },
                { name: "第一人称", percentage: 22 },
                { name: "机器人", percentage: 18 },
                { name: "体验", percentage: 14 },
                { name: "空间理解", percentage: 10 }
              ]}
              onCopy={() => alert("已复制摘要")}
            />
          </GlassCard>
        </div>
      </section>

      {/* Test 13: Complete Example */}
      <section style={{ marginBottom: "40px" }}>
        <h2 style={{ marginBottom: "16px" }}>13. 完整页面示例</h2>
        <div style={{ maxWidth: "1200px" }}>
          <TopBar
            onBack={() => alert("返回")}
            statusTexts={["已自动保存"]}
          />
          <RecordDetailHeader
            title={title}
            onTitleChange={setTitle}
            onExport={(format) => alert(`导出为 ${format || "markdown"}`)}
            metadata={{
              duration: "3分08秒",
              segmentCount: 58
            }}
          />
          <div style={{ marginTop: "18px" }}>
            <GlassCard>
              <TranscriptToolbar
                activeTab={activeTab}
                onTabChange={setActiveTab}
                searchValue={searchQuery}
                onSearchChange={setSearchQuery}
                searchResultCount={searchQuery ? 3 : undefined}
              />
              <div style={{ padding: "8px 16px", maxHeight: "400px", overflowY: "auto" }}>
                {segments.map((seg, i) => (
                  <TranscriptSegment
                    key={i}
                    timestamp={seg.timestamp}
                    sourceText={seg.source}
                    translationText={seg.translation}
                    isActive={i === activeSegment}
                    onPlay={() => setActiveSegment(i)}
                    highlightQuery={searchQuery}
                  />
                ))}
              </div>
            </GlassCard>
          </div>
        </div>
      </section>

      {/* Test 1-8: Previous tests */}
      <section style={{ marginBottom: "40px" }}>
        <h2 style={{ marginBottom: "16px" }}>1-8. 基础组件（已测试）</h2>
        <div style={{ display: "flex", gap: "12px", marginBottom: "20px" }}>
          <GradientButton onClick={() => alert("Clicked")}>渐变按钮</GradientButton>
          <button className="ghostBtn">Ghost 按钮</button>
        </div>
        <RecordPlayer
          isPlaying={isPlaying}
          currentMs={currentMs}
          durationMs={durationMs}
          onPlayPause={() => setIsPlaying(!isPlaying)}
          onSeek={setCurrentMs}
        />
      </section>
    </div>
  );
}
