# EchoSync Desktop 导航与加载反馈 UX 设计

## 背景

当前桌面端主窗口已经具备 `Idle -> Active -> Finished` 的会话状态流，但导航和等待反馈还停留在功能堆叠阶段：

- 顶栏右侧出现“首页”文字按钮，和窗口控制、字幕窗入口混在一起，层级不清。
- Finished 复盘页的导出动作区混入“返回首页”，破坏了“导出/清理/继续使用”的任务语义。
- 点击“开始同传”后，如果音频采集、Agent 连接或字幕窗打开较慢，用户缺少明确等待反馈，容易误判为无响应。

本设计只处理主窗口导航、复盘页动作区、启动/预热加载反馈。不重做主页整体信息架构，不改字幕弹窗分层，不改后端实时链路。

## 设计目标

1. **导航归导航，任务归任务。** 返回首页属于窗口/页面导航，应放在顶栏左侧的小返回控件，不应出现在导出按钮组里。
2. **慢启动必须有可解释状态。** 启动同传时展示阻塞式等待反馈，说明当前处于音频准备、Agent 连接还是字幕窗打开阶段。
3. **危险返回必须二次确认。** Active 会话中返回首页会停止同传；Finished 中如果导出前编辑未保存，返回首页会丢弃编辑。这两类操作需要确认弹窗。
4. **保持生产力工具克制感。** 参考讯飞同传一类桌面工具的导航习惯：左上返回、中央状态、右上系统动作；等待态使用小型居中弹窗或遮罩，不做大面积营销化空状态。

## 非目标

- 不重新设计 Idle 首页卡片和场景预设。
- 不改变 `SessionUiState` 的三段生命周期定义。
- 不把 Finished 页变成完整富文本编辑器。
- 不实现新安装器、托盘、自动更新或新的全局快捷键。

## 方案对比

### 方案 A：保留文字按钮，只调整位置

把“首页/返回首页”从右侧移到左侧，仍使用文字按钮。实现最小，但看起来仍像内部调试入口，和成熟桌面工具的导航形态不一致。

### 方案 B：左上返回小图标 + 任务区纯化 + 启动等待遮罩

顶栏左侧使用返回箭头图标；页面标题跟随生命周期变化；右侧只保留字幕窗入口和窗口控制。Finished 的动作区只保留清理、复制导出、开始新会话。启动慢时显示居中等待弹窗。

这是推荐方案。它改动范围小，但能直接修复用户感知最强的交互粗糙点。

### 方案 C：全流程向导弹窗

把开始同传、会话运行、复盘导出都收进向导式弹窗。视觉更统一，但会削弱“主页是会话控制中心”的定位，也会增加状态嵌套。

## 推荐设计

采用方案 B。

主窗口成为三层结构：

```text
┌────────────────────────────────────────────────────────────┐
│  ←  会话驾驶舱                 免费 1 小时      字幕窗  - □ × │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Idle / Active / Finished 对应的主内容                     │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

当进入启动或预热状态时，在主内容上方显示等待遮罩：

```text
┌────────────────────────────────────────────────────────────┐
│  EchoSync                    免费 1 小时      字幕窗  - □ × │
├────────────────────────────────────────────────────────────┤
│                                                            │
│                       ┌──────────────┐                     │
│                       │   动态音频条  │                     │
│                       │ 正在连接 Agent │                     │
│                       │  取消启动     │                     │
│                       └──────────────┘                     │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## 组件设计

### `AppTitleBar`

职责：承载窗口级导航和系统动作，不承载业务流程按钮。

属性：

```ts
type AppTitleBarProps = {
  pageTitle: string;
  canNavigateBack: boolean;
  statusLabel: string;
  onBack: () => void;
  onShowOverlay: () => void;
};
```

行为：

- Idle：不显示返回箭头，标题为 `EchoSync` 或 `实时同传控制中心`。
- Active：显示返回箭头，标题为 `会话驾驶舱`。
- Finished：显示返回箭头，标题为 `会话复盘`。
- 右侧保留 `实时字幕`、最小化、最大化/还原、关闭。
- 顶栏右侧不得出现 `首页`、`返回首页` 这类文字按钮。

视觉：

- 返回箭头是 36px 图标按钮，使用 `<` 或后续替换为线性 icon。
- 返回按钮 hover 只改变底色和图标颜色，不使用大面积蓝色主按钮。
- 页面标题位于左侧返回箭头后方，字体 15-16px，避免和主内容 H1 抢层级。

### `LeaveSessionDialog`

职责：处理返回首页导致的状态丢弃或会话停止。

触发场景：

| 当前状态 | 条件 | 弹窗标题 | 主操作 |
| --- | --- | --- | --- |
| Active | 正在同传 | `停止同传并返回首页？` | `停止并返回` |
| Startup | 正在启动或预热 | `取消启动并返回首页？` | `取消启动` |
| Finished | `preExportEdit.dirty === true` | `放弃导出前编辑？` | `放弃并返回` |
| Finished | 无未保存编辑 | 不弹窗，直接返回 | 不适用 |

弹窗规则：

- 弹窗为居中 modal，背景半透明遮罩。
- 默认焦点落在安全动作：`继续同传`、`继续等待`、`继续编辑`。
- `Esc` 执行安全动作，只关闭弹窗。
- 主操作使用低饱和危险色或深色描边，不使用和“开始同传”相同的主蓝按钮。

### `SessionStartupOverlay`

职责：解释启动慢、预热慢、连接慢的等待状态。

启动阶段：

```ts
type StartupPhase =
  | "idle"
  | "preparing_audio"
  | "connecting_agent"
  | "opening_overlay"
  | "recovering"
  | "failed";
```

展示文案：

| 阶段 | 主文案 | 辅助文案 |
| --- | --- | --- |
| `preparing_audio` | `正在准备音频输入...` | `请保持视频或会议正在播放。` |
| `connecting_agent` | `正在连接 Agent...` | `首次启动可能需要模型预热。` |
| `opening_overlay` | `正在打开字幕弹窗...` | `字幕窗会置顶显示在当前应用上方。` |
| `recovering` | `正在恢复连接...` | `网络或模型响应较慢，系统正在重试。` |
| `failed` | `启动失败` | 显示具体错误消息。 |

时间规则：

- 0-300ms：不显示遮罩，避免快速启动时闪烁。
- 300ms 后：显示居中等待弹窗。
- 3s 后：显示辅助文案 `首次启动可能需要模型预热。`
- 8s 后：显示 `取消启动` 次级按钮，并提示检查 Agent 服务。
- 失败时：等待弹窗切换为错误弹窗，提供 `返回首页` 和 `重试`。

视觉：

- 使用 180-220px 宽的小卡片，居中显示。
- loading 图形使用 5-7 根竖向音频条，和产品的音频语义一致。
- 背景遮罩只压暗主内容，不改变窗口顶栏和窗口控制按钮。

### `FinishedDashboard`

职责：会后复盘、导出前编辑、复制导出。

调整：

- 移除动作区里的 `返回首页` 按钮。
- 保留动作顺序：
  - `快速清理`
  - `复制 Markdown`
  - `复制 SRT`
  - `开始新会话`
- 返回首页统一走顶栏左侧返回箭头。
- 如果复制导出耗时，使用 `exportStatus` 或 `GlobalToaster` 显示 `正在复制...`、`Markdown 已复制`、`SRT 已复制`。

### `GlobalToaster`

职责：承载非阻塞反馈，不打断主流程。

适用场景：

- `Markdown 已复制`
- `SRT 已复制`
- `字幕窗已打开`
- `Agent 连接恢复中`
- `术语已生效`

不适用场景：

- 停止会话并返回首页。
- 放弃导出前编辑。
- 启动失败。

这些必须用 modal 或明确错误状态。

## 状态设计

当前 `SessionLifecycle = "idle" | "active" | "finished"` 保持不变。新增两个 UI 子状态，不把它们塞进主生命周期。

```ts
type NavigationConfirmReason =
  | "active_session"
  | "startup_cancel"
  | "dirty_export"
  | null;

type StartupUiState = {
  phase: StartupPhase;
  startedAtMs: number | null;
  message: string;
  detail: string | null;
  canCancel: boolean;
};
```

推荐挂载位置：

- `startup` 可以放在 `SessionUiState`。
- `navigationConfirmReason` 可以作为 `App` 局部状态，因为它只影响当前窗口交互，不需要跨进程同步。

事件建议：

```ts
type SessionUiEvent =
  | { type: "startup.started"; phase: "preparing_audio" }
  | { type: "startup.phase.changed"; phase: StartupPhase; message?: string }
  | { type: "startup.failed"; message: string }
  | { type: "startup.completed" }
  | { type: "startup.cancelled" };
```

状态流：

```text
Idle
  -> startup.preparing_audio
  -> startup.connecting_agent
  -> startup.opening_overlay
  -> startup.completed
  -> Active

startup.failed
  -> failed modal
  -> Retry 或 Return Home

Active back
  -> LeaveSessionDialog(active_session)
  -> Stop capture
  -> Idle

Finished back
  -> if dirty: LeaveSessionDialog(dirty_export)
  -> Idle
```

## 交互细则

### 返回箭头

- Idle 不显示。
- Active 点击返回：不直接返回，必须弹确认。
- Startup 点击返回：弹确认或直接显示 `取消启动` modal。
- Finished 点击返回：
  - 未编辑：直接返回首页。
  - 已编辑：弹确认。

### 关闭窗口

关闭窗口仍是窗口级动作，不等同于返回首页。后续可以加“正在同传时关闭确认”，但不在本次范围内。

### 开始新会话

Finished 的 `开始新会话` 是业务动作，可以留在页面动作区。它语义不是返回首页，而是直接进入一次新的启动流程。

### 加载遮罩

- 遮罩存在时，主内容不可点击。
- 顶栏窗口控制仍可点击。
- `取消启动` 只在超过 8s 或用户点击返回时出现，避免刚启动就鼓励取消。

## 可访问性

- 返回箭头必须有 `aria-label="返回首页"`。
- loading 弹窗使用 `role="status"` 或 `aria-live="polite"`，只播报阶段变化，不播报动画。
- 确认弹窗使用 `role="dialog"`，带 `aria-modal="true"`。
- 动画受 `prefers-reduced-motion` 控制，音频条动画降级为静态图标。

## 验收标准

1. Active 和 Finished 顶栏左侧显示返回箭头，Idle 不显示返回箭头。
2. `.windowActions` 内不再出现 `首页` 文本按钮。
3. Finished 导出动作区不再出现 `返回首页`。
4. Active 点击返回不会直接丢弃会话，必须先出现确认弹窗。
5. Finished 且导出前编辑为 dirty 时，点击返回必须出现确认弹窗。
6. 点击 `开始同传` 后，如果启动超过 300ms，出现居中等待弹窗。
7. 启动超过 3s 后显示模型预热/连接较慢的辅助文案。
8. 启动失败时，等待弹窗切换为错误状态，提供重试和返回首页。

## 测试计划

### 状态模型测试

新增或扩展 `apps/desktop/tests/session-ui-state.test.ts`：

- `startup.started` 进入 `preparing_audio`。
- `startup.phase.changed` 可切换到 `connecting_agent` 和 `opening_overlay`。
- `startup.completed` 清空 startup 状态。
- `startup.failed` 记录错误消息。
- `startup.cancelled` 回到 idle startup 状态。

### UI 行为测试

当前项目没有 DOM 测试环境，先用以下方式覆盖：

- `npm --prefix apps/desktop run typecheck`
- `npm run test:desktop`
- `npm run build:desktop`
- 使用字符串扫描确认：
  - `windowActions` 不渲染 `首页`。
  - Finished 动作区不渲染 `返回首页`。

### 手动验证

启动 Electron 后验证：

1. Idle 首页无返回箭头。
2. 点击开始同传，Agent 慢启动时出现等待弹窗。
3. Active 顶栏左侧返回，点击后出现确认弹窗。
4. Finished 动作区只有导出和新会话动作。
5. 修改导出前文本后点击左上返回，出现放弃编辑确认弹窗。

## 实施顺序建议

1. 扩展 `SessionUiState` 的 startup 子状态和测试。
2. 重构顶栏为 `AppTitleBar`，加入返回箭头和页面标题。
3. 新增 `LeaveSessionDialog`。
4. 新增 `SessionStartupOverlay`。
5. 调整 `FinishedDashboard` 动作区。
6. 跑完整 desktop 测试、typecheck、build。
