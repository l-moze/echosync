# EchoSync 工作台 UI 与 Agent 同步推进 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `doc/UI设计调研.md` 实现一个可交互的 Next 15 同传工作台 MVP，并让 Agent 输出契约支持前端展示的字幕、修订和端到端译文音频预留。

**Architecture:** 前端拆成数据模型、模拟事件流和工作台组件，首屏直接是三栏工作台，并支持剧场、阅读、紧凑四种模式。Agent 保持级联小接口，同时补齐统一 `InterpretationEngine`、`TranslatedAudioSink` 和标准事件管道，保证 ASR、翻译、TTS、端到端模型都能替换。

**Tech Stack:** Next 15 App Router、React 19、TypeScript、CSS Modules/全局 CSS、Python 3.11+、pytest。

---

## 文件结构

- `apps/web/src/lib/protocol.ts`：扩展前端协议，补充字幕状态、patch、提交、译文音频和统一事件类型。
- `apps/web/src/lib/demo-session.ts`：前端模拟会话数据和事件应用逻辑，不把状态逻辑塞进页面组件。
- `apps/web/src/app/page.tsx`：实现工作台交互壳，负责模式切换、音频源切换、字幕字号和模拟事件播放。
- `apps/web/src/app/globals.css`：实现 UI 视觉系统、四种布局模式、字幕状态、响应式和 reduced motion。
- `apps/agent/src/echosync_agent/domain/events.py`：补齐 `ModelMode`、`ModelCapability`、`ModelProfile`、`TranslatedAudioChunk` 和 `InterpretationEvent`。
- `apps/agent/src/echosync_agent/interfaces/interpretation_engine.py`：新增统一听译引擎接口。
- `apps/agent/src/echosync_agent/interfaces/translated_audio_sink.py`：新增译文音频输出边界。
- `apps/agent/src/echosync_agent/pipeline/engine_pipeline.py`：新增统一事件输出管道。
- `apps/agent/src/echosync_agent/services/engine/cascaded_engine.py`：把现有 ASR→翻译→修正链路包装为统一引擎。
- `apps/agent/tests/test_interpretation_engine_contracts.py`：验证端到端模型可共用输出管道。
- `doc/architecture-mvp.md`、`README.md`：同步说明当前 UI 与 Agent 边界。

## 任务

### Task 1: Agent 统一模型事件契约

**Files:**
- Modify: `apps/agent/src/echosync_agent/domain/events.py`
- Modify: `apps/agent/src/echosync_agent/domain/__init__.py`
- Create: `apps/agent/src/echosync_agent/interfaces/interpretation_engine.py`
- Create: `apps/agent/src/echosync_agent/interfaces/translated_audio_sink.py`
- Modify: `apps/agent/src/echosync_agent/interfaces/__init__.py`
- Create: `apps/agent/tests/test_interpretation_engine_contracts.py`

- [ ] **Step 1: 写失败测试**

在 `apps/agent/tests/test_interpretation_engine_contracts.py` 中验证端到端引擎可以输出译文字幕、译文音频和提交事件。

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest apps/agent/tests/test_interpretation_engine_contracts.py -q`

Expected: 因 `InterpretationEngine`、`TranslatedAudioChunk` 或 `EngineDrivenInterpretationPipeline` 尚未定义而失败。

- [ ] **Step 3: 写最小领域和接口实现**

在领域层新增模型能力、模型形态、译文音频块和统一事件类型；在接口层新增统一引擎和译文音频 sink。

- [ ] **Step 4: 运行测试确认仍可能因管道缺失失败**

Run: `python -m pytest apps/agent/tests/test_interpretation_engine_contracts.py -q`

Expected: 如果管道还没实现，应失败在 `EngineDrivenInterpretationPipeline` 导入或行为。

### Task 2: Agent 统一输出管道

**Files:**
- Create: `apps/agent/src/echosync_agent/pipeline/engine_pipeline.py`
- Modify: `apps/agent/src/echosync_agent/pipeline/__init__.py`
- Create: `apps/agent/src/echosync_agent/services/engine/__init__.py`
- Create: `apps/agent/src/echosync_agent/services/engine/cascaded_engine.py`
- Modify: `apps/agent/src/echosync_agent/pipeline/realtime_pipeline.py`

- [ ] **Step 1: 实现 `EngineDrivenInterpretationPipeline`**

根据事件类型分发到 `SubtitleSink` 或 `TranslatedAudioSink`。

- [ ] **Step 2: 实现 `CascadedInterpretationEngine`**

把现有 `Transcriber`、`Translator`、`CorrectionEngine` 组合为统一引擎，并输出 `TranslationSegment`、`SubtitlePatch`、`SegmentCommit`。

- [ ] **Step 3: 保持 `RealtimeInterpretationPipeline` 兼容**

让旧构造函数内部创建 `CascadedInterpretationEngine` 和 `EngineDrivenInterpretationPipeline`，避免现有测试和调用方破坏。

- [ ] **Step 4: 运行 Agent 测试**

Run: `python -m pytest apps/agent/tests -q`

Expected: 所有测试通过。

### Task 3: 前端协议与模拟事件状态

**Files:**
- Modify: `apps/web/src/lib/protocol.ts`
- Create: `apps/web/src/lib/demo-session.ts`

- [ ] **Step 1: 扩展协议类型**

新增 `CaptionState`、`CaptionLineModel`、`SubtitleCommitEvent`、`TranslatedAudioEvent`、`RealtimeEvent`，并保持现有 `translation.partial` 和 `translation.patch` 命名。

- [ ] **Step 2: 创建模拟会话数据**

提供工作台需要的字幕行、术语、笔记、指标、patch 示例和模式数据。

- [ ] **Step 3: 创建纯函数 `applyRealtimeEvent`**

用统一事件更新字幕行，供页面和未来 WebSocket/LiveKit 数据通道复用。

- [ ] **Step 4: 运行 Web 类型检查**

Run: `npm run typecheck`

Expected: 通过。

### Task 4: 实现工作台 UI

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: 页面拆为小组件**

在 `page.tsx` 内实现 `SessionBar`、`ModeSwitcher`、`SubtitleStage`、`CaptionLine`、`ContextRail`、`HistoryTimeline`、`CompactOverlay`。

- [ ] **Step 2: 实现四种模式**

支持 `workstation`、`theater`、`reading`、`compact`，模式切换只影响布局和显示密度，不改变底层字幕事件。

- [ ] **Step 3: 实现字幕状态视觉**

`interim` 弱强调，`stable` 强强调，`revised` 局部修订提示，`locked` 显示锁定状态。

- [ ] **Step 4: 实现可访问性和响应式**

加入 `role="status"` 会话状态区，移动端折叠侧栏，遵守 `prefers-reduced-motion`。

- [ ] **Step 5: 运行 Web 类型检查**

Run: `npm run typecheck`

Expected: 通过。

### Task 5: 文档同步与全量验证

**Files:**
- Modify: `README.md`
- Modify: `doc/architecture-mvp.md`

- [ ] **Step 1: 文档同步**

补充本轮工作台 UI、模拟事件流、Agent 统一模型边界说明。

- [ ] **Step 2: 运行验证**

Run:

```powershell
python -m pytest apps/agent/tests
python -m compileall apps/agent/src
cd apps/web; npm run typecheck; npm run build
git diff --check
```

Expected: Agent 测试、编译、Web typecheck、Next build、diff check 均通过。若 build 因非 NTFS 或 dev server 占用失败，应切到 `D:\code\echosync` 并停止 dev server 后重跑。
