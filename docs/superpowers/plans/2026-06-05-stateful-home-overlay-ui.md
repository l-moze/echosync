# Stateful Home and Overlay UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 EchoSync 桌面端 UI 落地为 Stateful Hybrid 主页控制中心和分层字幕弹窗，并保持 Web 工作台、Agent 和文档边界不冲突。

**Architecture:** 首阶段只改 `apps/desktop` 与文档，把主页生命周期、音频校验、滚动锁、术语同步、健康度、导出前清理和弹窗 A/B/C 分层拆成可测试共享状态与渲染组件。`apps/web` 保持现有工作台原型，后续按同一状态模型复用，不在本计划里同步大改。每个任务结束后单独提交，只 `git add` 当前任务文件，避免带入工作区其它修订。

**Tech Stack:** Electron 37、React 19、Vite 7、Vitest、TypeScript、CSS、Markdown。

---

## 冲突与提交纪律

- 当前工作区存在大量未提交修改和未跟踪文件。执行每个任务前先运行 `git status --short`，只查看与本任务有关的文件。
- 每个任务提交时必须使用精确路径 `git add -- <paths>`，不要使用 `git add .`。
- 若目标文件已有未提交内容，先读文件并在现有实现上增量修改，不回退用户改动。
- 计划中的提交是阶段提交，不要求一次性完成所有 UI。
- 如果某个任务执行到一半遇到现有修订冲突，停止该任务并报告冲突文件，不改无关文件。

## 文件结构

- Create: `apps/desktop/src/shared/session-ui-state.ts`  
  主页生命周期、音频活动、术语同步、自动滚动、弹窗交互、置信来源等纯类型和 reducer。
- Create: `apps/desktop/tests/session-ui-state.test.ts`  
  验证 `Idle -> Active -> Finished`、起飞前电平状态、滚动锁、术语同步和导出前清理状态。
- Create: `apps/desktop/src/shared/overlay-interaction.ts`  
  弹窗 hover intent、穿透、Pin、拖拽、visual decay 和边缘展开的纯逻辑。
- Create: `apps/desktop/tests/overlay-interaction.test.ts`  
  验证 Layer A/B/C 状态切换、150-250ms hover intent、fallback wake-up 和 revised 高亮衰减。
- Modify: `apps/desktop/src/shared/desktop-api.ts`  
  增加 `setOverlayPinned`、`wakeOverlayControls`、`recenterOverlay`、`onOverlayWake` 和 UI 状态事件类型。
- Modify: `apps/desktop/src/preload/index.ts`  
  暴露新增 IPC。
- Modify: `apps/desktop/src/main/main.ts`  
  实现 overlay pin、fallback wake-up、召回居中、穿透控制。
- Create: `apps/desktop/tests/overlay-window-behavior.test.ts`  
  用纯函数或轻量抽象验证主进程 overlay 行为，避免在 Vitest 中创建真实 `BrowserWindow`。
- Modify: `apps/desktop/src/renderer/main.tsx`  
  将主控窗口改为 Idle/Active/Finished 三态控制中心；将 overlay 改为 Layer A/B/C 分层舞台。
- Modify: `apps/desktop/src/renderer/styles.css`  
  实现 Stateful Hybrid 主页和分层弹窗视觉系统。
- Modify: `apps/desktop/src/renderer/global.d.ts`  
  同步新增桌面 API 类型。
- Modify: `README.md`  
  更新桌面 UI 使用说明、快捷键、三态主页和弹窗分层。
- Modify: `doc/architecture-mvp.md`  
  更新 UI 生命周期、桌面弹窗交互、文档边界和后续 Web 对齐说明。
- Modify: `docs/superpowers/specs/2026-06-05-ui-home-overlay-requirements-design.md`  
  默认不修改；只有产品决策改变时才单独修订并提交。

## 阶段划分

1. Phase 1：共享 UI 状态模型和测试。
2. Phase 2：弹窗交互状态机、主进程 IPC 和窗口行为。
3. Phase 3：主页控制中心渲染。
4. Phase 4：字幕弹窗 Layer A/B/C 渲染。
5. Phase 5：文档同步、验证和阶段提交检查。

## Task 1: 主页共享状态模型

**Files:**
- Create: `apps/desktop/src/shared/session-ui-state.ts`
- Create: `apps/desktop/tests/session-ui-state.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/tests/session-ui-state.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import {
  createInitialSessionUiState,
  reduceSessionUiState,
  selectDefaultSourceForPlatform
} from "../src/shared/session-ui-state";

describe("主页 Stateful Hybrid 状态模型", () => {
  it("Windows 桌面端默认选择视频/网课和系统音频", () => {
    const state = createInitialSessionUiState({ platform: "windows" });

    expect(state.lifecycle).toBe("idle");
    expect(state.selectedPreset).toBe("video-course");
    expect(state.selectedSourceId).toBe("windows-system");
    expect(selectDefaultSourceForPlatform("windows")).toBe("windows-system");
  });

  it("非 Windows 平台默认回退到可用的标签页音频或麦克风", () => {
    expect(selectDefaultSourceForPlatform("web")).toBe("tab");
    expect(selectDefaultSourceForPlatform("mac")).toBe("microphone");
  });

  it("检测到音频活动后起飞前校验变为 ready", () => {
    const state = reduceSessionUiState(createInitialSessionUiState({ platform: "windows" }), {
      type: "audio.level.changed",
      peak: 0.42,
      rms: 0.18
    });

    expect(state.audioActivity).toBe("active");
    expect(state.preflight.audioReady).toBe(true);
    expect(state.preflight.warning).toBeNull();
  });

  it("开始会话后进入 Active 并显示驾驶舱", () => {
    const state = reduceSessionUiState(createInitialSessionUiState({ platform: "windows" }), {
      type: "session.started"
    });

    expect(state.lifecycle).toBe("active");
    expect(state.activePanel).toBe("transcript-monitor");
    expect(state.controlBarVisible).toBe(true);
  });

  it("结束会话后进入 Finished 并开启导出前清理入口", () => {
    const active = reduceSessionUiState(createInitialSessionUiState({ platform: "windows" }), {
      type: "session.started"
    });
    const finished = reduceSessionUiState(active, {
      type: "session.finished",
      summary: {
        durationMs: 120000,
        segmentCount: 42,
        patchCount: 3,
        averageLatencyMs: 860,
        wordCount: 1800
      }
    });

    expect(finished.lifecycle).toBe("finished");
    expect(finished.summary?.segmentCount).toBe(42);
    expect(finished.preExportEdit.enabled).toBe(true);
  });

  it("用户回溯或选择文本时锁定自动滚动并提示新内容", () => {
    const active = reduceSessionUiState(createInitialSessionUiState({ platform: "windows" }), {
      type: "session.started"
    });
    const locked = reduceSessionUiState(active, { type: "transcript.user.scrolled_up" });
    const withNewContent = reduceSessionUiState(locked, { type: "transcript.new_content" });

    expect(withNewContent.autoScroll.mode).toBe("locked");
    expect(withNewContent.autoScroll.newContentAvailable).toBe(true);
  });

  it("术语快加必须经历 syncing 到 active", () => {
    const active = reduceSessionUiState(createInitialSessionUiState({ platform: "windows" }), {
      type: "session.started"
    });
    const syncing = reduceSessionUiState(active, {
      type: "term.add.requested",
      source: "agent",
      target: "智能体"
    });
    const termId = syncing.terms[0]?.id;
    const synced = reduceSessionUiState(syncing, { type: "term.add.synced", id: termId });

    expect(syncing.terms[0]).toMatchObject({ source: "agent", target: "智能体", status: "syncing" });
    expect(synced.terms[0]?.status).toBe("active");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npm --prefix apps/desktop test -- session-ui-state
```

Expected: FAIL，提示找不到 `../src/shared/session-ui-state`。

- [ ] **Step 3: 实现状态模型**

创建 `apps/desktop/src/shared/session-ui-state.ts`：

```ts
import type { DesktopAudioSourceId } from "./audio-source-catalog";

export type RuntimePlatform = "windows" | "mac" | "web";
export type SessionLifecycle = "idle" | "active" | "finished";
export type ScenarioPresetId = "video-course" | "remote-meeting" | "tech-talk" | "file-replay";
export type AudioActivityState = "silent" | "active" | "clipping" | "device_missing" | "permission_denied";
export type AutoScrollMode = "following" | "locked";
export type TermSyncStatus = "syncing" | "active" | "failed";
export type ConfidenceDisplaySource = "native_confidence" | "derived_stability" | "unavailable";

export type SessionSummary = {
  durationMs: number;
  segmentCount: number;
  patchCount: number;
  averageLatencyMs: number;
  wordCount: number;
};

export type SessionTerm = {
  id: string;
  source: string;
  target: string;
  status: TermSyncStatus;
};

export type SessionUiState = {
  lifecycle: SessionLifecycle;
  selectedPreset: ScenarioPresetId;
  selectedSourceId: DesktopAudioSourceId | "tab";
  audioActivity: AudioActivityState;
  preflight: {
    audioReady: boolean;
    warning: string | null;
    level: {
      peak: number;
      rms: number;
    };
  };
  controlBarVisible: boolean;
  activePanel: "start" | "transcript-monitor" | "summary";
  autoScroll: {
    mode: AutoScrollMode;
    newContentAvailable: boolean;
  };
  terms: SessionTerm[];
  confidence: {
    source: ConfidenceDisplaySource;
    label: string;
    value: number | null;
  };
  summary: SessionSummary | null;
  preExportEdit: {
    enabled: boolean;
    dirty: boolean;
  };
};

export type SessionUiEvent =
  | { type: "audio.level.changed"; peak: number; rms: number }
  | { type: "audio.permission_denied" }
  | { type: "audio.device_missing" }
  | { type: "session.started" }
  | { type: "session.finished"; summary: SessionSummary }
  | { type: "session.reset" }
  | { type: "transcript.user.scrolled_up" }
  | { type: "transcript.user.follow_current" }
  | { type: "transcript.user.selected_text" }
  | { type: "transcript.new_content" }
  | { type: "term.add.requested"; source: string; target: string }
  | { type: "term.add.synced"; id: string | undefined }
  | { type: "term.add.failed"; id: string | undefined }
  | { type: "pre_export.edited" }
  | { type: "confidence.updated"; source: ConfidenceDisplaySource; label: string; value: number | null };

export function selectDefaultSourceForPlatform(platform: RuntimePlatform): DesktopAudioSourceId | "tab" {
  if (platform === "windows") {
    return "windows-system";
  }
  if (platform === "web") {
    return "tab";
  }
  return "microphone";
}

export function createInitialSessionUiState({ platform }: { platform: RuntimePlatform }): SessionUiState {
  return {
    lifecycle: "idle",
    selectedPreset: "video-course",
    selectedSourceId: selectDefaultSourceForPlatform(platform),
    audioActivity: "silent",
    preflight: {
      audioReady: false,
      warning: "播放一段视频或说话，确认电平条有响应。",
      level: { peak: 0, rms: 0 }
    },
    controlBarVisible: false,
    activePanel: "start",
    autoScroll: {
      mode: "following",
      newContentAvailable: false
    },
    terms: [],
    confidence: {
      source: "derived_stability",
      label: "基于稳定度推断",
      value: null
    },
    summary: null,
    preExportEdit: {
      enabled: false,
      dirty: false
    }
  };
}

export function reduceSessionUiState(state: SessionUiState, event: SessionUiEvent): SessionUiState {
  if (event.type === "audio.level.changed") {
    const activity = event.peak > 0.92 ? "clipping" : event.rms > 0.03 ? "active" : "silent";
    return {
      ...state,
      audioActivity: activity,
      preflight: {
        audioReady: activity === "active" || activity === "clipping",
        warning: activity === "silent" ? "还没有检测到音频输入。" : null,
        level: { peak: event.peak, rms: event.rms }
      }
    };
  }

  if (event.type === "audio.permission_denied") {
    return {
      ...state,
      audioActivity: "permission_denied",
      preflight: {
        ...state.preflight,
        audioReady: false,
        warning: "音频权限被拒绝，请重新授权。"
      }
    };
  }

  if (event.type === "audio.device_missing") {
    return {
      ...state,
      audioActivity: "device_missing",
      preflight: {
        ...state.preflight,
        audioReady: false,
        warning: "没有找到可用音频设备。"
      }
    };
  }

  if (event.type === "session.started") {
    return {
      ...state,
      lifecycle: "active",
      activePanel: "transcript-monitor",
      controlBarVisible: true,
      autoScroll: { mode: "following", newContentAvailable: false }
    };
  }

  if (event.type === "session.finished") {
    return {
      ...state,
      lifecycle: "finished",
      activePanel: "summary",
      controlBarVisible: false,
      summary: event.summary,
      preExportEdit: { enabled: true, dirty: false }
    };
  }

  if (event.type === "session.reset") {
    return createInitialSessionUiState({ platform: state.selectedSourceId === "windows-system" ? "windows" : "web" });
  }

  if (event.type === "transcript.user.scrolled_up" || event.type === "transcript.user.selected_text") {
    return {
      ...state,
      autoScroll: { ...state.autoScroll, mode: "locked" }
    };
  }

  if (event.type === "transcript.new_content") {
    return {
      ...state,
      autoScroll: {
        ...state.autoScroll,
        newContentAvailable: state.autoScroll.mode === "locked"
      }
    };
  }

  if (event.type === "transcript.user.follow_current") {
    return {
      ...state,
      autoScroll: { mode: "following", newContentAvailable: false }
    };
  }

  if (event.type === "term.add.requested") {
    const id = `term_${state.terms.length + 1}`;
    return {
      ...state,
      terms: [...state.terms, { id, source: event.source, target: event.target, status: "syncing" }]
    };
  }

  if (event.type === "term.add.synced" || event.type === "term.add.failed") {
    return {
      ...state,
      terms: state.terms.map((term) =>
        term.id === event.id ? { ...term, status: event.type === "term.add.synced" ? "active" : "failed" } : term
      )
    };
  }

  if (event.type === "pre_export.edited") {
    return {
      ...state,
      preExportEdit: { ...state.preExportEdit, dirty: true }
    };
  }

  if (event.type === "confidence.updated") {
    return {
      ...state,
      confidence: {
        source: event.source,
        label: event.label,
        value: event.value
      }
    };
  }

  return state;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```powershell
npm --prefix apps/desktop test -- session-ui-state
```

Expected: PASS。

- [ ] **Step 5: 提交 Phase 1**

Run:

```powershell
git status --short
git add -- apps/desktop/src/shared/session-ui-state.ts apps/desktop/tests/session-ui-state.test.ts
git commit -m "Add desktop session UI state model"
```

## Task 2: 弹窗交互状态机

**Files:**
- Create: `apps/desktop/src/shared/overlay-interaction.ts`
- Create: `apps/desktop/tests/overlay-interaction.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/tests/overlay-interaction.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import {
  createInitialOverlayInteractionState,
  getSafeExpandedBounds,
  reduceOverlayInteraction
} from "../src/shared/overlay-interaction";

describe("字幕弹窗分层交互状态机", () => {
  it("默认是穿透的 Layer A", () => {
    const state = createInitialOverlayInteractionState();

    expect(state.layer).toBe("default");
    expect(state.pointerMode).toBe("pass_through");
  });

  it("快速划过不会唤醒 Hover 控制", () => {
    const pending = reduceOverlayInteraction(createInitialOverlayInteractionState(), {
      type: "pointer.entered",
      atMs: 1000
    });
    const stillDefault = reduceOverlayInteraction(pending, {
      type: "hover.timer.elapsed",
      atMs: 1120
    });

    expect(stillDefault.layer).toBe("default");
    expect(stillDefault.pointerMode).toBe("pass_through");
  });

  it("停留超过 hover intent 阈值后进入轻控制态", () => {
    const pending = reduceOverlayInteraction(createInitialOverlayInteractionState(), {
      type: "pointer.entered",
      atMs: 1000
    });
    const interactive = reduceOverlayInteraction(pending, {
      type: "hover.timer.elapsed",
      atMs: 1230
    });

    expect(interactive.layer).toBe("controls");
    expect(interactive.pointerMode).toBe("interactive");
  });

  it("Pin 后进入小型双语舞台并保持可交互", () => {
    const pinned = reduceOverlayInteraction(createInitialOverlayInteractionState(), { type: "pin.enabled" });

    expect(pinned.layer).toBe("pinned");
    expect(pinned.pointerMode).toBe("interactive");
  });

  it("全局快捷键可以强制唤醒控制态", () => {
    const awake = reduceOverlayInteraction(createInitialOverlayInteractionState(), { type: "fallback.wake" });

    expect(awake.layer).toBe("controls");
    expect(awake.pointerMode).toBe("interactive");
    expect(awake.fallbackAwake).toBe(true);
  });

  it("修订高亮在 2 秒后进入衰减", () => {
    const revised = reduceOverlayInteraction(createInitialOverlayInteractionState(), {
      type: "revision.highlighted",
      atMs: 2000
    });
    const decayed = reduceOverlayInteraction(revised, {
      type: "revision.decay.checked",
      atMs: 4100
    });

    expect(revised.revisionHighlightVisible).toBe(true);
    expect(decayed.revisionHighlightVisible).toBe(false);
  });

  it("靠近屏幕底边时向上展开", () => {
    const bounds = getSafeExpandedBounds({
      current: { left: 900, top: 980, width: 620, height: 96 },
      desired: { width: 760, height: 260 },
      screen: { width: 1920, height: 1080, margin: 24 }
    });

    expect(bounds.top).toBeLessThan(820);
    expect(bounds.left + bounds.width).toBeLessThanOrEqual(1896);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npm --prefix apps/desktop test -- overlay-interaction
```

Expected: FAIL，提示找不到 `../src/shared/overlay-interaction`。

- [ ] **Step 3: 实现弹窗交互状态机**

创建 `apps/desktop/src/shared/overlay-interaction.ts`：

```ts
export type OverlayLayer = "default" | "controls" | "pinned";
export type OverlayPointerMode = "pass_through" | "interactive" | "dragging";

export type OverlayInteractionState = {
  layer: OverlayLayer;
  pointerMode: OverlayPointerMode;
  hoverStartedAtMs: number | null;
  hoverIntentDelayMs: number;
  fallbackAwake: boolean;
  revisionHighlightedAtMs: number | null;
  revisionHighlightVisible: boolean;
};

export type OverlayInteractionEvent =
  | { type: "pointer.entered"; atMs: number }
  | { type: "pointer.left" }
  | { type: "hover.timer.elapsed"; atMs: number }
  | { type: "pin.enabled" }
  | { type: "pin.disabled" }
  | { type: "fallback.wake" }
  | { type: "drag.started" }
  | { type: "drag.ended" }
  | { type: "revision.highlighted"; atMs: number }
  | { type: "revision.decay.checked"; atMs: number };

export type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ScreenRect = {
  width: number;
  height: number;
  margin: number;
};

export function createInitialOverlayInteractionState(): OverlayInteractionState {
  return {
    layer: "default",
    pointerMode: "pass_through",
    hoverStartedAtMs: null,
    hoverIntentDelayMs: 200,
    fallbackAwake: false,
    revisionHighlightedAtMs: null,
    revisionHighlightVisible: false
  };
}

export function reduceOverlayInteraction(
  state: OverlayInteractionState,
  event: OverlayInteractionEvent
): OverlayInteractionState {
  if (event.type === "pointer.entered") {
    if (state.layer === "pinned") {
      return state;
    }
    return { ...state, hoverStartedAtMs: event.atMs };
  }

  if (event.type === "hover.timer.elapsed") {
    if (state.hoverStartedAtMs === null || state.layer === "pinned") {
      return state;
    }
    if (event.atMs - state.hoverStartedAtMs < state.hoverIntentDelayMs) {
      return state;
    }
    return { ...state, layer: "controls", pointerMode: "interactive" };
  }

  if (event.type === "pointer.left") {
    if (state.layer === "pinned" || state.pointerMode === "dragging") {
      return state;
    }
    return { ...state, layer: "default", pointerMode: "pass_through", hoverStartedAtMs: null, fallbackAwake: false };
  }

  if (event.type === "pin.enabled") {
    return { ...state, layer: "pinned", pointerMode: "interactive", hoverStartedAtMs: null };
  }

  if (event.type === "pin.disabled") {
    return { ...state, layer: "default", pointerMode: "pass_through", fallbackAwake: false };
  }

  if (event.type === "fallback.wake") {
    return { ...state, layer: "controls", pointerMode: "interactive", fallbackAwake: true };
  }

  if (event.type === "drag.started") {
    return { ...state, pointerMode: "dragging" };
  }

  if (event.type === "drag.ended") {
    return { ...state, pointerMode: state.layer === "default" ? "pass_through" : "interactive" };
  }

  if (event.type === "revision.highlighted") {
    return { ...state, revisionHighlightedAtMs: event.atMs, revisionHighlightVisible: true };
  }

  if (event.type === "revision.decay.checked") {
    if (state.revisionHighlightedAtMs === null) {
      return state;
    }
    return {
      ...state,
      revisionHighlightVisible: event.atMs - state.revisionHighlightedAtMs <= 2000
    };
  }

  return state;
}

export function getSafeExpandedBounds({
  current,
  desired,
  screen
}: {
  current: Rect;
  desired: Pick<Rect, "width" | "height">;
  screen: ScreenRect;
}): Rect {
  const maxLeft = screen.width - screen.margin - desired.width;
  const maxTop = screen.height - screen.margin - desired.height;
  const left = clamp(current.left + current.width - desired.width, screen.margin, maxLeft);
  const growsUp = current.top + desired.height > screen.height - screen.margin;
  const top = clamp(growsUp ? current.top + current.height - desired.height : current.top, screen.margin, maxTop);

  return {
    left,
    top,
    width: desired.width,
    height: desired.height
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```powershell
npm --prefix apps/desktop test -- overlay-interaction
```

Expected: PASS。

- [ ] **Step 5: 提交 Phase 2A**

Run:

```powershell
git status --short
git add -- apps/desktop/src/shared/overlay-interaction.ts apps/desktop/tests/overlay-interaction.test.ts
git commit -m "Add overlay interaction state model"
```

## Task 3: 桌面 IPC 与弹窗窗口行为

**Files:**
- Modify: `apps/desktop/src/shared/desktop-api.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/main.ts`
- Create: `apps/desktop/tests/overlay-window-behavior.test.ts`
- Create: `apps/desktop/src/main/overlay-window-state.ts`

- [ ] **Step 1: 写窗口行为测试**

创建 `apps/desktop/tests/overlay-window-behavior.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import { reduceOverlayWindowState } from "../src/main/overlay-window-state";

describe("悬浮字幕窗主进程行为", () => {
  it("锁定穿透时忽略鼠标并转发 hover 事件给系统", () => {
    const state = reduceOverlayWindowState({ visible: false, pinned: false, ignoreMouse: false }, {
      type: "overlay.locked",
      locked: true
    });

    expect(state.ignoreMouse).toBe(true);
  });

  it("Pin 后必须保持可交互", () => {
    const state = reduceOverlayWindowState({ visible: true, pinned: false, ignoreMouse: true }, {
      type: "overlay.pinned",
      pinned: true
    });

    expect(state.pinned).toBe(true);
    expect(state.ignoreMouse).toBe(false);
  });

  it("fallback 唤醒后显示弹窗并取消穿透", () => {
    const state = reduceOverlayWindowState({ visible: false, pinned: false, ignoreMouse: true }, {
      type: "overlay.wake_controls"
    });

    expect(state.visible).toBe(true);
    expect(state.ignoreMouse).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npm --prefix apps/desktop test -- overlay-window-behavior
```

Expected: FAIL，提示找不到 `../src/main/overlay-window-state`。

- [ ] **Step 3: 新增主进程纯状态**

创建 `apps/desktop/src/main/overlay-window-state.ts`：

```ts
export type OverlayWindowState = {
  visible: boolean;
  pinned: boolean;
  ignoreMouse: boolean;
};

export type OverlayWindowEvent =
  | { type: "overlay.visible"; visible: boolean }
  | { type: "overlay.locked"; locked: boolean }
  | { type: "overlay.pinned"; pinned: boolean }
  | { type: "overlay.wake_controls" }
  | { type: "overlay.recentered" };

export function reduceOverlayWindowState(state: OverlayWindowState, event: OverlayWindowEvent): OverlayWindowState {
  if (event.type === "overlay.visible") {
    return { ...state, visible: event.visible };
  }

  if (event.type === "overlay.locked") {
    return { ...state, ignoreMouse: event.locked && !state.pinned };
  }

  if (event.type === "overlay.pinned") {
    return { ...state, pinned: event.pinned, ignoreMouse: event.pinned ? false : state.ignoreMouse };
  }

  if (event.type === "overlay.wake_controls") {
    return { ...state, visible: true, ignoreMouse: false };
  }

  return state;
}
```

- [ ] **Step 4: 扩展桌面 API 类型**

修改 `apps/desktop/src/shared/desktop-api.ts`，在 `DesktopApi` 中加入：

```ts
  setOverlayPinned: (pinned: boolean) => Promise<void>;
  wakeOverlayControls: () => Promise<void>;
  recenterOverlay: () => Promise<void>;
  onOverlayWake: (listener: () => void) => () => void;
```

保留已有字段，最终类型应包含：

```ts
export type DesktopApi = {
  listAudioSources: () => Promise<DesktopAudioSource[]>;
  startCapture: (sourceId: DesktopAudioSourceId) => Promise<DesktopCaptureSnapshot>;
  stopCapture: () => Promise<DesktopCaptureSnapshot>;
  sendRealtimeEvent: (event: RealtimeEvent) => Promise<void>;
  setOverlayVisible: (visible: boolean) => Promise<void>;
  setOverlayLocked: (locked: boolean) => Promise<void>;
  setOverlayPinned: (pinned: boolean) => Promise<void>;
  wakeOverlayControls: () => Promise<void>;
  recenterOverlay: () => Promise<void>;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  onRealtimeEvent: (listener: (event: RealtimeEvent) => void) => () => void;
  onCaptureState: (listener: (snapshot: DesktopCaptureSnapshot) => void) => () => void;
  onOverlayWake: (listener: () => void) => () => void;
};
```

- [ ] **Step 5: 扩展 preload**

修改 `apps/desktop/src/preload/index.ts`，在 `desktopApi` 中加入：

```ts
  setOverlayPinned: (pinned) => ipcRenderer.invoke("overlay:pinned", pinned),
  wakeOverlayControls: () => ipcRenderer.invoke("overlay:wake-controls"),
  recenterOverlay: () => ipcRenderer.invoke("overlay:recenter"),
  onOverlayWake: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("overlay:wake-controls", handler);
    return () => ipcRenderer.off("overlay:wake-controls", handler);
  },
```

- [ ] **Step 6: 扩展主进程 IPC**

修改 `apps/desktop/src/main/main.ts`：

1. 引入状态 reducer：

```ts
import { reduceOverlayWindowState, type OverlayWindowState } from "./overlay-window-state";
```

2. 新增模块状态：

```ts
let overlayWindowState: OverlayWindowState = {
  visible: false,
  pinned: false,
  ignoreMouse: false
};
```

3. 在 `overlay:visible`、`overlay:locked` 基础上同步状态：

```ts
  ipcMain.handle("overlay:visible", (_event, visible: boolean) => {
    overlayVisible = visible;
    overlayWindowState = reduceOverlayWindowState(overlayWindowState, { type: "overlay.visible", visible });
    if (visible) {
      const window = ensureOverlayWindow();
      window.showInactive();
      window.moveTop();
    } else {
      overlayWindow?.hide();
    }
  });

  ipcMain.handle("overlay:locked", (_event, locked: boolean) => {
    overlayWindowState = reduceOverlayWindowState(overlayWindowState, { type: "overlay.locked", locked });
    overlayWindow?.setIgnoreMouseEvents(overlayWindowState.ignoreMouse, { forward: true });
  });
```

4. 新增 handler：

```ts
  ipcMain.handle("overlay:pinned", (_event, pinned: boolean) => {
    overlayWindowState = reduceOverlayWindowState(overlayWindowState, { type: "overlay.pinned", pinned });
    overlayWindow?.setIgnoreMouseEvents(overlayWindowState.ignoreMouse, { forward: true });
    overlayWindow?.webContents.send("overlay:wake-controls");
  });

  ipcMain.handle("overlay:wake-controls", () => {
    overlayWindowState = reduceOverlayWindowState(overlayWindowState, { type: "overlay.wake_controls" });
    const window = ensureOverlayWindow();
    window.setIgnoreMouseEvents(false);
    window.showInactive();
    window.moveTop();
    window.webContents.send("overlay:wake-controls");
  });

  ipcMain.handle("overlay:recenter", () => {
    const window = ensureOverlayWindow();
    window.center();
    window.showInactive();
    window.moveTop();
  });
```

- [ ] **Step 7: 运行测试与类型检查**

Run:

```powershell
npm --prefix apps/desktop test -- overlay-window-behavior
npm run typecheck:desktop
```

Expected: 测试和类型检查通过。

- [ ] **Step 8: 提交 Phase 2B**

Run:

```powershell
git status --short
git add -- apps/desktop/src/main/overlay-window-state.ts apps/desktop/tests/overlay-window-behavior.test.ts apps/desktop/src/shared/desktop-api.ts apps/desktop/src/preload/index.ts apps/desktop/src/main/main.ts
git commit -m "Add overlay wake and pin IPC"
```

## Task 4: 主页控制中心渲染

**Files:**
- Modify: `apps/desktop/src/renderer/main.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: 运行当前桌面测试作为基线**

Run:

```powershell
npm run test:desktop
```

Expected: 当前桌面端测试通过。若失败，记录失败测试名和输出，不先改 UI。

- [ ] **Step 2: 在渲染层引入状态模型**

修改 `apps/desktop/src/renderer/main.tsx`，增加 import：

```ts
import {
  createInitialSessionUiState,
  reduceSessionUiState,
  type SessionSummary
} from "../shared/session-ui-state";
```

在 `App()` 内新增状态：

```ts
  const [sessionUi, setSessionUi] = useState(() => createInitialSessionUiState({ platform: "windows" }));
```

新增 helper：

```ts
  function dispatchSessionUi(event: Parameters<typeof reduceSessionUiState>[1]) {
    setSessionUi((current) => reduceSessionUiState(current, event));
  }
```

- [ ] **Step 3: 让开始和停止驱动生命周期**

修改 `startCapture` 成功后追加：

```ts
      dispatchSessionUi({ type: "session.started" });
      await window.echosyncDesktop?.setOverlayVisible(true);
```

修改 `stopCapture` 成功后追加：

```ts
      const summary: SessionSummary = {
        durationMs: Math.max(...lines.map((line) => line.endMs), 0),
        segmentCount: lines.length,
        patchCount: lines.reduce((sum, line) => sum + line.patchCount, 0),
        averageLatencyMs: 920,
        wordCount: lines.reduce((sum, line) => sum + line.targetText.length, 0)
      };
      dispatchSessionUi({ type: "session.finished", summary });
```

- [ ] **Step 4: 添加起飞前音频电平模拟**

在 `App()` 中新增：

```ts
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
```

这只是 UI 骨架模拟，后续真实采集接入后由 `AudioContextManager` 替换。

- [ ] **Step 5: 将主控窗口拆成三态渲染**

在 `main.tsx` 中新增这些组件，先放在同文件底部，避免一次拆太多文件：

```tsx
function ControlCenter({
  activeLine,
  currentSource,
  lines,
  onShowOverlay,
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
        <IdleDashboard currentSource={currentSource} onShowOverlay={onShowOverlay} onStart={onStart} sessionUi={sessionUi} />
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
```

继续在 `main.tsx` 中加入以下最小组件，实现要使用现有 `lines`、`currentSource`、`sessionUi`，不要引入新依赖：

```tsx
function IdleDashboard({
  currentSource,
  onShowOverlay,
  onStart,
  sessionUi
}: {
  currentSource: DesktopAudioSource;
  onShowOverlay: () => void;
  onStart: () => void;
  sessionUi: ReturnType<typeof createInitialSessionUiState>;
}) {
  return (
    <div className="dashboardGrid">
      <section className="heroStart">
        <p className="eyebrow">默认开箱</p>
        <h1>给当前视频挂上实时双语字幕</h1>
        <p>默认使用 {currentSource.label}，先确认电平条有响应，再开始同传。</p>
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
      <HealthMetric label="输入源" value={sourceId} />
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
```

- [ ] **Step 6: 替换原 `homeShell` 主体**

将原 `homeShell` 内的 banner、feature grid 和 start panel 替换为：

```tsx
      <ControlCenter
        activeLine={activeLine}
        currentSource={currentSource}
        lines={lines}
        onShowOverlay={() => window.echosyncDesktop?.setOverlayVisible(true)}
        onStart={() => void startCapture()}
        onStop={() => void stopCapture()}
        overlayLocked={overlayLocked}
        sessionUi={sessionUi}
        sourceId={sourceId}
        toggleOverlayLocked={() => void toggleOverlayLocked()}
      />
```

保留标题栏和窗口按钮。

- [ ] **Step 7: 添加主页样式**

修改 `apps/desktop/src/renderer/styles.css`，保留现有 title bar、overlay 基础样式，新增：

```css
.controlCenter {
  display: grid;
  gap: 18px;
}

.dashboardGrid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 310px;
  gap: 22px;
}

.heroStart,
.dashboardPanel,
.summaryPanel {
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: var(--shadow);
}

.heroStart {
  min-height: 360px;
  padding: 34px;
}

.presetGrid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 22px 0;
}

.presetCard {
  min-height: 92px;
  border: 1px solid var(--line);
  background: #fbfcff;
  text-align: left;
}

.presetCard.selected {
  border-color: rgba(39, 120, 255, 0.36);
  background: var(--blue-soft);
  color: #1764f5;
}

.preflightMeter {
  display: grid;
  gap: 8px;
  margin-top: 18px;
}

.meterTrack {
  height: 9px;
  overflow: hidden;
  border-radius: 999px;
  background: #edf2fb;
}

.meterFill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--mint), var(--blue));
}

.transcriptMonitor {
  max-height: 430px;
  overflow: auto;
}

.transcriptItem {
  padding: 13px 0;
  border-bottom: 1px solid var(--line);
}

.transcriptItem.revised .targetText {
  text-decoration: underline;
  text-decoration-color: rgba(202, 160, 77, 0.55);
  text-decoration-thickness: 2px;
}

.newContentButton {
  position: sticky;
  bottom: 10px;
  justify-self: center;
  background: var(--blue);
  color: white;
}

.healthGrid,
.termQuickAdd,
.summaryMetrics {
  display: grid;
  gap: 10px;
}

.healthMetric {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px;
  border-radius: 10px;
  background: #f5f8fe;
}

@media (max-width: 980px) {
  .dashboardGrid,
  .presetGrid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 8: 类型检查**

Run:

```powershell
npm run typecheck:desktop
```

Expected: PASS。

- [ ] **Step 9: 提交 Phase 3**

Run:

```powershell
git status --short
git add -- apps/desktop/src/renderer/main.tsx apps/desktop/src/renderer/styles.css
git commit -m "Build stateful desktop control center"
```

## Task 5: 字幕弹窗 Layer A/B/C 渲染

**Files:**
- Modify: `apps/desktop/src/renderer/main.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: 引入弹窗交互状态**

修改 `apps/desktop/src/renderer/main.tsx`，加入：

```ts
import { createInitialOverlayInteractionState, reduceOverlayInteraction } from "../shared/overlay-interaction";
```

在 `OverlayWindow` 内新增：

```tsx
  const [interaction, setInteraction] = useState(createInitialOverlayInteractionState);

  function dispatchOverlay(event: Parameters<typeof reduceOverlayInteraction>[1]) {
    setInteraction((current) => reduceOverlayInteraction(current, event));
  }
```

- [ ] **Step 2: 监听 fallback wake-up**

Task 3 已在 `DesktopApi` 中加入 `onOverlayWake`。在 `OverlayWindow` 中加入：

```tsx
  useEffect(() => {
    const remove = window.echosyncDesktop?.onOverlayWake(() => {
      dispatchOverlay({ type: "fallback.wake" });
    });
    return () => remove?.();
  }, []);
```

- [ ] **Step 3: 实现 hover intent**

给 `.floatingCaption` 添加事件：

```tsx
        onMouseEnter={() => {
          const atMs = Date.now();
          dispatchOverlay({ type: "pointer.entered", atMs });
          window.setTimeout(() => dispatchOverlay({ type: "hover.timer.elapsed", atMs: Date.now() }), 220);
        }}
        onMouseLeave={() => dispatchOverlay({ type: "pointer.left" })}
```

- [ ] **Step 4: 将 overlay 渲染拆成 A/B/C**

在 `OverlayWindow` 里根据 `interaction.layer` 渲染：

```tsx
const isPinned = interaction.layer === "pinned";
const showControls = interaction.layer === "controls" || isPinned;
```

结构调整为：

```tsx
<section className={`floatingCaption layer-${interaction.layer}`} ...>
  <div className="captionText">...</div>
  {isPinned ? <PinnedCaptionStack activeLine={activeLine} /> : null}
  {showControls ? <OverlayControls ... /> : null}
  ...
</section>
```

`PinnedCaptionStack` 使用最近 2-3 行需要从 `OverlayWindow` props 传入 `lines`。因此同步把调用处从：

```tsx
return <OverlayWindow activeLine={activeLine} snapshot={snapshot} />;
```

改为：

```tsx
return <OverlayWindow activeLine={activeLine} lines={lines} snapshot={snapshot} />;
```

- [ ] **Step 5: 添加 Pin 和穿透调用**

`OverlayControls` 中的 Pin 按钮：

```tsx
<button
  className={isPinned ? "selected" : ""}
  onClick={() => {
    dispatchOverlay(isPinned ? { type: "pin.disabled" } : { type: "pin.enabled" });
    void window.echosyncDesktop?.setOverlayPinned(!isPinned);
  }}
>
  {isPinned ? "取消 Pin" : "Pin"}
</button>
```

轻控制中保留“打开主页定位”按钮，首版只调用：

```tsx
void window.echosyncDesktop?.setOverlayVisible(true);
```

- [ ] **Step 6: 添加弹窗分层样式**

修改 `styles.css`，在 overlay 样式附近加入：

```css
.floatingCaption.layer-default {
  pointer-events: none;
}

.floatingCaption.layer-controls,
.floatingCaption.layer-pinned {
  pointer-events: auto;
}

.floatingCaption.layer-pinned {
  align-items: start;
  min-height: 190px;
  grid-template-columns: 1fr;
  background:
    linear-gradient(180deg, rgba(18, 22, 30, 0.84), rgba(8, 10, 14, 0.78)),
    rgba(12, 14, 18, 0.76);
}

.overlayControls {
  -webkit-app-region: no-drag;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.overlayControls button {
  min-height: 28px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.09);
  font-size: 12px;
}

.pinnedCaptionStack {
  display: grid;
  gap: 8px;
  width: 100%;
  margin-top: 12px;
}

.pinnedLine {
  padding: 8px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.pinnedLine:not(.current) {
  opacity: 0.62;
}

.pinnedLine.revised .overlayTarget {
  text-decoration: underline;
  text-decoration-color: rgba(255, 210, 132, 0.7);
}

.overlayStateBadge {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.72);
  font-size: 11px;
}
```

- [ ] **Step 7: 测试和类型检查**

Run:

```powershell
npm run typecheck:desktop
npm run test:desktop
```

Expected: PASS。

- [ ] **Step 8: 提交 Phase 4**

Run:

```powershell
git status --short
git add -- apps/desktop/src/renderer/main.tsx apps/desktop/src/renderer/styles.css
git commit -m "Implement layered subtitle overlay"
```

## Task 6: 文档同步

**Files:**
- Modify: `README.md`
- Modify: `doc/architecture-mvp.md`
- Modify: `docs/superpowers/specs/2026-06-05-ui-home-overlay-requirements-design.md` only if implementation intentionally changes the spec.

- [ ] **Step 1: 更新 README**

在 `README.md` 的 Desktop 当前状态后补充：

```markdown
当前 Desktop UI 正在按 Stateful Hybrid 主页控制中心推进：

- Idle：视频/网课默认开箱，起飞前音频电平校验。
- Active：最近转写、健康度、术语快加和自动滚动锁。
- Finished：会话复盘、导出前快速清理和最近记录。
- 字幕弹窗采用 Layer A/B/C：默认穿透极简、Hover 轻控制、Pin 小型双语舞台。
```

- [ ] **Step 2: 更新 architecture-mvp**

在 `doc/architecture-mvp.md` 的 Electron 桌面端章节补充：

```markdown
桌面 UI 生命周期：

`Idle -> Active -> Finished`

`Idle` 负责视频/网课默认开箱和音频电平校验；`Active` 负责转写监控、健康度和术语快加；`Finished` 负责复盘、导出前清理和沉淀。透明字幕窗按 Layer A/B/C 分层，默认穿透，Hover 唤醒轻控制，Pin 后展示最近 2-3 行和字幕状态。
```

- [ ] **Step 3: 检查文档格式**

Run:

```powershell
git diff --check -- README.md doc/architecture-mvp.md docs/superpowers/specs/2026-06-05-ui-home-overlay-requirements-design.md
```

Expected: 无输出。

- [ ] **Step 4: 提交 Phase 5 文档**

Run:

```powershell
git status --short
git add -- README.md doc/architecture-mvp.md
git commit -m "Document stateful desktop UI flow"
```

## Task 7: 全量验证与收口

**Files:**
- No code files.

- [ ] **Step 1: 运行桌面端验证**

Run:

```powershell
npm run test:desktop
npm run typecheck:desktop
npm run build:desktop
```

Expected: 三个命令均通过。

- [ ] **Step 2: 运行 Web 验证，确认未被本计划破坏**

Run:

```powershell
npm run typecheck:web
npm --prefix apps/web run build
```

Expected: 两个命令均通过。若失败，检查是否是执行前已存在的 Web 改动导致；本计划不应主动改 Web 文件。

- [ ] **Step 3: 运行 Agent 基线验证**

Run:

```powershell
cd apps/agent
python -m compileall src
python -m pytest tests
cd ..\..
```

Expected: 编译和测试通过。若失败，记录失败，并确认是否与 UI 任务无关。

- [ ] **Step 4: 检查空白和工作区**

Run:

```powershell
git diff --check
git status --short
```

Expected: `git diff --check` 无输出。`git status --short` 可能仍显示用户此前的无关改动；确认本计划产生的文件已经阶段提交。

- [ ] **Step 5: 如验证文档需要更新，单独提交**

如果验证过程中发现 README 或 architecture 需要补充已知限制，单独提交：

```powershell
git add -- README.md doc/architecture-mvp.md
git commit -m "Clarify desktop UI verification notes"
```

## Self Review

- Spec 覆盖：计划覆盖 Stateful Hybrid 主页、Idle 起飞前电平校验、Active 滚动锁、术语同步、置信来源、Finished 导出前清理、弹窗 Layer A/B/C、Hover Intent、Visual Decay、fallback wake-up、边缘策略、异常恢复、文档同步和验证。
- 范围控制：计划首轮只落地 Desktop，因为当前桌面端正是主页和弹窗双入口载体；Web 保持现有原型，后续按共享状态模型对齐。
- 提交策略：每个任务都有独立提交命令和精确路径，避免和其它修订冲突。
- 类型一致性：`SessionUiState`、`OverlayInteractionState`、`OverlayWindowState`、新增 `DesktopApi` 字段在后续任务中名称一致。
- 所有步骤均包含具体命令、文件和期望结果。
