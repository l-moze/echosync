# EchoSync App 图标序列帧动效设计规范

## 目标

这份文档定义 EchoSync Desktop 中 app 图标序列帧动画的使用边界、素材规格和生成清单，供后续素材生成智能体直接按目录产出 PNG/WebP 序列帧。

核心判断：

1. app 图标序列帧用于品牌状态反馈，不替代 Windows 主图标、任务栏图标和安装器图标。
2. 动画只服务确定性状态变化：启动、连接、预热、开始同传、等待音频、保存成功。
3. 实时字幕正文是阅读区域，不能被序列帧动画干扰。
4. 普通界面保持产品化表达，动画不能把首页带回工程控制台感。

## 当前资源盘点

已有资源：

```text
apps/desktop/resources/icons/app.png
apps/desktop/resources/sequences/app-icon/frame_01.png
apps/desktop/resources/sequences/app-icon/frame_02.png
...
apps/desktop/resources/sequences/app-icon/frame_12.png
```

已确认规格：

| 资源 | 尺寸 | 用途判断 |
|---|---:|---|
| `apps/desktop/resources/icons/app.png` | `1034 x 1034` | 静态 app 图标源图，后续派生 `.ico`。 |
| `apps/desktop/resources/sequences/app-icon/frame_01.png` - `frame_12.png` | `512 x 512` | 当前 app 图标序列帧源素材，可作为后续分场景动效参考。 |

目录语义：

| 目录 | 职责 |
|---|---|
| `apps/desktop/resources/icons/` | Electron 主进程、安装器、任务栏、托盘可读取的源图标。 |
| `apps/desktop/resources/sequences/` | 高分辨率序列帧源素材，不直接打进渲染层首屏包。 |
| `apps/desktop/src/renderer/assets/icons/` | 渲染层需要打包的小尺寸图标派生物。 |
| `apps/desktop/src/renderer/assets/sequences/` | 渲染层需要按需加载的低码率序列帧派生物。 |

## 动效原则

### 应该做

- 用 app 图标动效表达“正在准备”“正在连接”“已开始”“等待声音”“已保存”。
- 使用短时单次播放动画强化状态完成感。
- 使用低频、低幅度循环播放表达等待态。
- 在 `prefers-reduced-motion: reduce` 下退化为静态 app 图标。
- 动画结束时停在可独立成立的静态 app 图标帧。

### 不应该做

- 不在实时字幕文字更新时播放 app 图标序列帧。
- 不把动画铺满会议记录阅读区。
- 不用闪烁、强缩放、强旋转表达错误。
- 不高频替换 Windows 任务栏主图标。
- 不在设置页用动画做装饰。
- 不让动画和“开始同传”主按钮争夺视觉重心。

## 使用点优先级

| 优先级 | 使用点 | 现有代码位置 | 动画类型 | 目的 |
|---|---|---|---|---|
| P0 | 启动同传遮罩 | `SessionStartupOverlay` | 单次播放 + 慢启动低频循环 | 点击开始后解释系统正在准备，减少无响应感。 |
| P0 | 连接同传服务 / 模型预热 | `SessionStartupOverlay` 的 `connecting_agent` / `recovering` 阶段 | 循环播放 | 表达连接和预热进行中。界面文案仍用“同传服务”，不出现模型术语。 |
| P1 | 首页品牌状态反馈 | `AppTitleBar` 的 `.brandDot`、首页状态摘要 | 短单次播放 | 从“需要检查”到“已就绪”时给轻量确认。 |
| P1 | 点击“开始同传”后的启动反馈 | 首页 `开始同传` 操作后进入 startup | 单次播放 | 给用户明确的按下反馈，随后进入等待遮罩。 |
| P1 | 字幕窗等待音频输入 | `OverlayWindow`，`snapshot.state !== "listening"` 且无有效字幕 | 极弱循环或静态帧 | 提示字幕窗已打开，但当前没有声音输入。 |
| P2 | 会议记录保存 / 导出成功 | `SessionRecordsWindow`、导出动作反馈 | 单次播放 | 轻量确认保存或导出完成。 |
| P2 | 托盘运行状态 | 后续 tray 实现 | 低帧率循环或状态静态帧 | 后台同传运行中提示。需谨慎，避免系统托盘闪烁。 |
| P3 | 首次启动品牌露出 | 应用启动或首次进入首页 | 单次播放 | 用于开场品牌动效，但不能拖慢进入首页。 |

## 场景规格

### 1. 启动同传动效：`app-icon-boot`

用途：应用首次启动、首次进入首页、点击开始后 300ms 以上才出现的启动遮罩。

建议目录：

```text
apps/desktop/resources/sequences/app-icon-boot/
  frame_0001.png
  frame_0002.png
  ...
  frame_0012.png
  manifest.json
```

规格：

| 项 | 要求 |
|---|---|
| 动画类型 | 单次播放 |
| 帧数 | 12 帧 |
| 时长 | 600-900ms |
| 画布 | `512 x 512`，透明背景 |
| 风格 | 图标从安静状态轻微唤醒，亮度或声波元素逐步出现。 |
| 首帧 | 接近静态 app 图标，不突兀。 |
| 末帧 | 可停留为静态 app 图标。 |

禁忌：

- 不做大幅弹跳。
- 不做强烈光晕扩散。
- 不出现文字。

### 2. 连接同传服务动效：`app-icon-connect`

用途：连接本地同传服务、实时链路恢复、模型预热。

建议目录：

```text
apps/desktop/resources/sequences/app-icon-connect/
  frame_0001.png
  ...
  frame_0016.png
  manifest.json
```

规格：

| 项 | 要求 |
|---|---|
| 动画类型 | 循环播放 |
| 帧数 | 16 帧 |
| 时长 | 1200-1600ms / loop |
| 画布 | `512 x 512`，透明背景 |
| 风格 | 图标周围有极弱环形进度、呼吸光或点状连接反馈。 |
| 首尾 | 首帧和末帧必须无明显跳变。 |
| 强度 | 低强度，适合 3-8 秒等待。 |

禁忌：

- 不使用加载转圈大图标替代品牌图标。
- 不把动画做成网络拓扑或工程感强的连接图。

### 3. 开始同传成功动效：`app-icon-listening`

用途：音频采集已开始、字幕窗进入正在同传状态。

建议目录：

```text
apps/desktop/resources/sequences/app-icon-listening/
  frame_0001.png
  ...
  frame_0012.png
  manifest.json
```

规格：

| 项 | 要求 |
|---|---|
| 动画类型 | 单次播放，必要时低帧率循环 |
| 帧数 | 12 帧 |
| 时长 | 500-800ms |
| 画布 | `512 x 512`，透明背景 |
| 风格 | 轻微声波、字幕线或听音状态被点亮。 |
| 末帧 | 稳定在“正在听”的状态，但不能太亮。 |

使用规则：

- 首页可播放一次。
- 字幕窗里默认不循环播放，除非没有字幕且需要提示正在等待第一句。

### 4. 等待音频输入动效：`app-icon-waiting-audio`

用途：字幕窗已打开，但系统声音或麦克风没有有效输入。

建议目录：

```text
apps/desktop/resources/sequences/app-icon-waiting-audio/
  frame_0001.png
  ...
  frame_0012.png
  manifest.json
```

规格：

| 项 | 要求 |
|---|---|
| 动画类型 | 极弱循环 |
| 帧数 | 12 帧 |
| 时长 | 1600-2400ms / loop |
| 画布 | `512 x 512`，透明背景 |
| 风格 | 图标轻微呼吸或音频输入点缓慢浮现。 |
| 强度 | 比连接动效更弱，不能抢字幕窗文字。 |

使用规则：

- 只在字幕窗无字幕、无错误、非正在输出字幕时显示。
- 一旦有有效字幕，立即停止显示。

### 5. 保存或导出成功动效：`app-icon-success`

用途：会议记录保存、Markdown/SRT/DOCX 导出、复制完成。

建议目录：

```text
apps/desktop/resources/sequences/app-icon-success/
  frame_0001.png
  ...
  frame_0010.png
  manifest.json
```

规格：

| 项 | 要求 |
|---|---|
| 动画类型 | 单次播放 |
| 帧数 | 8-10 帧 |
| 时长 | 400-650ms |
| 画布 | `512 x 512`，透明背景 |
| 风格 | 轻微完成勾选、柔和收束或图标短促点亮。 |
| 末帧 | 回到静态 app 图标或成功静态帧。 |

禁忌：

- 不把成功态做成大面积绿色。
- 不遮挡会议记录正文。

### 6. 错误状态不做序列帧主动画

错误状态应以明确文案和可操作按钮为主。可以提供一张静态错误态图标，但不建议生成循环错误动画。

允许：

```text
apps/desktop/resources/icons/app-warning.png
apps/desktop/resources/icons/app-offline.png
```

禁用：

- 红色持续闪烁。
- 大幅抖动。
- 快速旋转。

## 资产命名规范

新生成序列帧统一使用四位零填充：

```text
frame_0001.png
frame_0002.png
frame_0003.png
```

不再新增 `frame_01.png` 这种短编号。当前 `app-icon/frame_01.png` 到 `frame_12.png` 保留为已有源素材，不作为新目录规范。

每个序列建议附带 `manifest.json`：

```json
{
  "name": "app-icon-connect",
  "type": "loop",
  "frameCount": 16,
  "fps": 12,
  "durationMs": 1333,
  "size": 512,
  "background": "transparent",
  "reducedMotionFrame": "frame_0001.png"
}
```

## 输出规格

### 源素材

| 项 | 要求 |
|---|---|
| 格式 | PNG |
| 尺寸 | `512 x 512` |
| 背景 | 透明 |
| 色彩 | 与 `app.png` 品牌色一致，避免引入新的高饱和主色。 |
| 帧数 | 单次播放 8-12 帧，循环播放 12-16 帧，最多不超过 24 帧。 |
| 文件大小 | 单帧尽量低于 300KB。 |

### Renderer 派生素材

渲染层不应直接加载 `512 x 512 PNG` 全量序列帧。后续可派生：

```text
apps/desktop/src/renderer/assets/sequences/app-icon-connect-128/
  frame_0001.webp
  ...
```

建议：

| 项 | 要求 |
|---|---|
| 格式 | WebP 或压缩 PNG |
| 尺寸 | `96 x 96` 或 `128 x 128` |
| 加载方式 | 按需 lazy load |
| 首屏 | 不进入主窗口首屏包 |

### 托盘派生素材

托盘不使用高分辨率序列帧。需要时单独派生：

```text
apps/desktop/resources/tray/
  idle.ico
  listening.ico
  warning.ico
```

若后续确实需要托盘动画，只允许 2-4 帧低频切换，并且提供用户关闭选项。

## 推荐实现边界

后续代码实现时建议新增一个独立组件，不让动画逻辑散落在业务组件里：

```text
apps/desktop/src/renderer/components/AppIconSequence.tsx
```

组件职责：

- 接收 `sequenceName`、`mode`、`size`、`paused`。
- 内部处理帧预加载和 reduced motion。
- 单次播放结束后停在末帧。
- 循环播放按固定 fps 播放，不随 React 高频状态更新。

建议 API：

```ts
type AppIconSequenceProps = {
  name: "boot" | "connect" | "listening" | "waiting-audio" | "success";
  mode: "once" | "loop";
  size: number;
  paused?: boolean;
  className?: string;
};
```

实现顺序：

1. 先接入 `SessionStartupOverlay` 的 P0 场景。
2. 再替换首页 `.brandDot` 的轻量状态反馈。
3. 最后考虑字幕窗等待音频和会议记录导出成功。

不要一次性把所有场景都接入，避免把动效系统变成新的胶水层。

## 性能与可访问性约束

1. `512 x 512 PNG` 序列帧只作为源素材，不直接进入渲染层首屏包。
2. 渲染层使用低分辨率派生素材，并且只在对应状态出现时加载。
3. 循环动画默认 fps 控制在 8-12，不做 60fps 序列帧播放。
4. `prefers-reduced-motion: reduce` 下只显示 `reducedMotionFrame`。
5. 动画容器必须有固定宽高，避免图片加载造成布局跳动。
6. 动画不参与字幕文本布局，不触发字幕行重新排版。
7. 状态播报使用文案和 `aria-live`，屏幕阅读器不需要知道每一帧变化。

## 给素材生成智能体的任务清单

优先生成以下 5 组素材：

```text
P0 apps/desktop/resources/sequences/app-icon-boot/
P0 apps/desktop/resources/sequences/app-icon-connect/
P1 apps/desktop/resources/sequences/app-icon-listening/
P1 apps/desktop/resources/sequences/app-icon-waiting-audio/
P2 apps/desktop/resources/sequences/app-icon-success/
```

每组必须包含：

```text
frame_0001.png
frame_0002.png
...
manifest.json
```

生成要求：

- 使用当前 `apps/desktop/resources/icons/app.png` 作为品牌形态参考。
- 保持透明背景。
- 不生成文字。
- 不使用大面积渐变光污染。
- 不使用强烈抖动、弹跳、旋转。
- 循环序列首尾必须自然衔接。
- 单次播放序列末帧必须能静止停留。

## 验收清单

素材生成智能体交付后按以下清单验收：

1. 所有文件命名使用 `frame_0001.png` 四位零填充。
2. 每个序列目录都有 `manifest.json`。
3. PNG 都是透明背景。
4. 所有源帧尺寸均为 `512 x 512`。
5. 单次播放动画最后一帧可作为静态图标停留。
6. 循环动画首尾无明显跳变。
7. 单帧文件大小尽量低于 300KB。
8. 动画风格不影响实时字幕阅读。
9. 没有出现英文/中文文字、模型名、工程图标或加载转圈图形。
10. reduced motion 能落到 manifest 中指定的静态帧。

## 与现有文档的关系

本规范补充以下文档，不取代它们：

- `docs/superpowers/specs/2026-06-06-desktop-navigation-loading-ux-design.md`：定义启动遮罩和慢启动反馈。
- `docs/superpowers/specs/2026-06-06-home-launcher-engine-settings-design.md`：定义首页、设置、会议记录的产品边界。
- `doc/UI设计调研.md`：定义字幕工作台动效原则，强调实时字幕不做大幅位移。

后续实现时，以本规范定义的资产目录和禁用场景为准。
