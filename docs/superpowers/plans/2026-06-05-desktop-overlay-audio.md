# Windows 悬浮字幕与桌面音频地基 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 EchoSync 从 Web 工作台升级为具备 Windows 悬浮字幕窗和桌面音频源边界的桌面应用地基。

**Architecture:** 新增 `apps/desktop` Electron 应用，主进程负责窗口与 IPC，渲染层负责主控窗口和毛玻璃悬浮字幕窗，共享层定义音频源目录和字幕状态机。Agent 继续只消费 `AudioFrame`，音频采集实现被隔离在桌面适配器边界之外。

**Tech Stack:** Electron 37、React 19、Vite 7、Vitest、Python Agent DTO。

---

### Task 1: 桌面窗口与音频源契约

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tests/window-config.test.ts`
- Create: `apps/desktop/tests/audio-source-catalog.test.ts`
- Create: `apps/desktop/src/main/window-config.ts`
- Create: `apps/desktop/src/shared/audio-source-catalog.ts`

- [x] **Step 1: 写窗口配置失败测试**

验证悬浮字幕窗必须是透明、无边框、置顶、跳过任务栏，主控窗口保留任务栏入口。

- [x] **Step 2: 写音频源目录失败测试**

验证音频源包含麦克风、Windows 系统声音、混音、文件回放，并声明系统声音走 loopback 边界。

- [x] **Step 3: 实现最小窗口配置和音频源目录**

保持配置纯数据，便于单测，不把 Electron 实例创建混入测试目标。

- [x] **Step 4: 运行桌面端契约测试**

Run: `npm --prefix apps/desktop test`

### Task 2: Electron 主进程和预加载 API

**Files:**
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/tsconfig.main.json`
- Create: `apps/desktop/vite.config.ts`
- Create: `apps/desktop/vitest.config.ts`
- Create: `apps/desktop/src/main/main.ts`
- Create: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/shared/desktop-api.ts`
- Create: `apps/desktop/src/shared/realtime-events.ts`

- [x] **Step 1: 配置 TypeScript、Vite、Vitest**

渲染层用 Vite，主进程单独用 `tsc -p tsconfig.main.json` 输出到 `dist`。

- [x] **Step 2: 实现最小 IPC**

包括 `audio:list-sources`、`audio:start`、`audio:stop`、`caption:event`、`overlay:visible`、`overlay:locked`、窗口最小化和关闭。

- [x] **Step 3: 创建主控窗口和悬浮字幕窗**

悬浮窗使用 `setAlwaysOnTop(true, "screen-saver")` 和 `setVisibleOnAllWorkspaces`。

### Task 3: 字幕状态机和桌面 UI

**Files:**
- Create: `apps/desktop/tests/caption-store.test.ts`
- Create: `apps/desktop/src/shared/caption-store.ts`
- Create: `apps/desktop/src/renderer/index.html`
- Create: `apps/desktop/src/renderer/main.tsx`
- Create: `apps/desktop/src/renderer/styles.css`
- Create: `apps/desktop/src/renderer/global.d.ts`

- [x] **Step 1: 写字幕事件状态机测试**

验证 `translation.partial`、`translation.patch`、`segment.commit` 更新同一个字幕片段。

- [x] **Step 2: 实现状态机**

仅处理字幕 UI 需要的字段，避免复制整个 Agent 领域模型。

- [x] **Step 3: 实现主控窗口**

展示音频源、采集状态、字幕事件调试和悬浮窗锁定。

- [x] **Step 4: 实现悬浮字幕窗**

透明窗口内渲染毛玻璃字幕卡，聚焦实时译文和修正状态。

### Task 4: Agent 和文档同步

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `doc/architecture-mvp.md`
- Modify: `apps/agent/src/echosync_agent/domain/events.py`
- Modify: `apps/agent/src/echosync_agent/domain/__init__.py`
- Modify: `apps/agent/src/echosync_agent/interfaces/audio_source.py`

- [x] **Step 1: 增加根脚本**

新增 `dev:desktop`、`build:desktop`、`test:desktop`、`typecheck:desktop`。

- [x] **Step 2: 增加 Agent 音频来源元数据**

`AudioFrame` 增加 `source_kind` 和 `device_id` 默认字段，保持兼容。

- [x] **Step 3: 更新中文文档**

说明 Electron 桌面壳、Windows 系统声音 loopback 边界，以及 Web/桌面/Agent 的职责划分。

### Task 5: 验证

**Files:**
- No code files.

- [ ] **Step 1: 运行桌面端测试**

Run: `npm run test:desktop`

- [ ] **Step 2: 运行桌面端类型检查和构建**

Run: `npm run typecheck:desktop`

Run: `npm run build:desktop`

- [ ] **Step 3: 运行 Web 和 Agent 既有验证**

Run: `npm run typecheck:web`

Run: `npm --prefix apps/web run build`

Run: `python -m pytest apps/agent/tests`

Run: `python -m compileall apps/agent/src`

- [ ] **Step 4: 检查空白和改动状态**

Run: `git diff --check`

Run: `git status --short`
