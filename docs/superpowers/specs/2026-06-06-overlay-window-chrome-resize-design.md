# EchoSync 字幕弹窗 Chrome、阴影与鼠标动态调整设计

## 调研范围

本规范基于 Context7 检索到的 Electron 官方文档与 Electron 官网最新文档核对透明悬浮窗的实现边界，目标是修正字幕弹窗当前的三个问题：

- 聚焦态工具栏不像贴在窗口上的 chrome，而像散落的控件。
- 失焦态没有稳定窗口阴影，视觉层次不足。
- “阴影调整”没有作用，因为当前设置只控制文字阴影或背景模糊，没有控制字幕窗口阴影。
- 用户需要通过鼠标动态调整字幕窗口大小，但不能引入系统透明窗口边框和矩形阴影。

## 官方文档结论

### 透明窗口不能依赖系统原生 resize

Electron 官方透明窗口示例使用：

```ts
new BrowserWindow({
  resizable: false,
  frame: false,
  transparent: true
})
```

官方限制明确指出：透明窗口不可 resize，设置 `resizable: true` 在某些平台可能导致透明窗口失效；macOS 透明窗口也不会显示原生窗口阴影。

因此 EchoSync overlay 必须保持：

```ts
resizable: false
hasShadow: false
transparent: true
frame: false
```

窗口阴影必须是 CSS 内容阴影，而不是系统 `hasShadow`。

### 鼠标拖拽区必须和按钮/resize 手柄隔离

Electron 的自定义无边框窗口需要使用 `app-region: drag` 标记可拖拽区域。官方同时强调，drag 区域会忽略 pointer events；按钮、输入、resize handles 必须标记为 `app-region: no-drag`。

因此字幕窗内部应拆成：

- `captionDragSurface`：用于移动窗口。
- `overlayToolbar` / `overlaySessionBar`：不可拖拽，可点击。
- `resizeHandle-*`：不可拖拽，专门处理鼠标 resize。

### 动态调整应由主进程 setBounds 完成

Electron `BrowserWindow.setBounds(bounds)` 可以同时移动和缩放窗口；未传入的属性沿用当前值。`getBounds()` 可读取当前窗口矩形。

因此自定义 resize 的数据流应为：

```text
renderer pointerdown
  -> 记录起始 mouse position + overlay bounds
renderer pointermove
  -> 计算下一帧 width / height / x / y
  -> window.echosyncDesktop.resizeOverlay(boundsPatch)
main ipc
  -> clamp 到当前 display workArea
  -> overlayWindow.setBounds(nextBounds, false)
  -> 返回实际 bounds
renderer
  -> 同步 resize ghost / 本地状态
```

## 产品结构

字幕弹窗应是一个透明 OS 窗口内的内容窗口：

```text
Transparent BrowserWindow
└─ captionWindow
   ├─ topChrome       工具栏，贴上边
   ├─ historyArea     上一句或历史滚动
   ├─ activeCaption   当前英文上 / 中文下
   ├─ bottomChrome    会话控制栏，贴下边
   └─ resizeHandles   鼠标动态调整
```

字幕窗的几何和字幕文本渲染必须解耦：

- `captionWindow` 只负责圆角、背景、边框、CSS 窗口阴影、拖拽和 resize 命中区。
- `captionTrack` 负责字幕 segment 的平滑上滚，使用 `transform`，不改变窗口高度。
- `captionSegment` 负责原文/译文逐句对照，内部可以软换行，但不能撑大 BrowserWindow。
- 字符级 typewriter、局部修订、修订高亮衰减只发生在 `captionSegment` 内部，不触发窗口 resize、圆角变化或 chrome 重排。
- 工具栏出现/隐藏只能改变 chrome 可见性，不能改变字幕窗口圆角、外阴影和内容轨道基准高度。

### Default 失焦态

- 显示轻背景、弱边框、可调窗口阴影。
- 不显示工具栏和 resize handles。
- 鼠标穿透仍按当前交互状态控制。
- 内容为历史上一句 + 当前双语字幕。
- 字幕文本按 visual buffer 的 `visibleText` 渲染；后端 snapshot 变长时不能整段跳出，也不能撑高窗口。

### Focus / Controls 聚焦态

- 顶部 chrome 显示设置、锁定、Pin、召回、隐藏等工具。
- 底部 chrome 显示暂停/停止、时间、音频源、同传状态和显示模式。
- 四角或右下角显示 resize affordance。
- resize handles 使用 `app-region: no-drag`，避免和窗口拖拽冲突。
- chrome 应贴住窗口上边和下边，作为同一个圆角窗口内的系统层；不能出现独立圆角工具组外框或额外父层阴影。

### Pinned 驻留态

- 保留完整 top / middle / bottom 结构。
- 历史区域高度更大，可滚动。
- 支持边缘和角落 resize。

## 设置模型

`SubtitleStyleState` 需要新增真正的窗口阴影字段：

```ts
windowShadow: number; // 0-1
```

建议默认值：

```ts
windowShadow: 0.72
```

CSS 变量：

```css
--caption-shadow-alpha: 0.72;
```

应用到字幕内容窗口：

```css
box-shadow:
  0 24px 72px rgba(0, 0, 0, calc(var(--caption-shadow-alpha) * 0.56)),
  0 8px 24px rgba(0, 0, 0, calc(var(--caption-shadow-alpha) * 0.32)),
  inset 0 1px 0 rgba(255, 255, 255, 0.08);
```

`outlineStyle=shadow` 继续只表示文字阴影，不能再被理解成窗口阴影。

## 尺寸策略

新增 overlay size state：

```ts
type OverlayWindowSize = {
  width: number;
  heightByLayer: {
    default: number;
    controls: number;
    settings: number;
    pinned: number;
  };
};
```

最小值：

```text
default  min 720 x 120
controls min 760 x 260
pinned   min 760 x 420
```

最大值按当前 display workArea clamp：

```text
width <= workArea.width - 48
height <= workArea.height - 48
```

用户 resize 后：

- width 在所有 layer 共享。
- height 按当前 layer 保存。
- layer 切换时使用用户保存值和最小高度取最大值。
- 字幕 token 更新、翻译修订、segment settling、history 上滚都不得写入 overlay size state。
- overlay size 只由用户 resize、layer 切换和主进程 workArea clamp 变更。

## 圆角稳定策略

用户目标是稳定圆角窗口，而不是直角窗口。圆角抖动的正确修复不是取消圆角，而是让圆角只有一个 owner。

- `.captionWindow` / `.floatingCaption` 统一拥有 `border-radius`。
- 默认、hover、controls、settings、pinned 状态使用同一个 radius token。
- `transition` 禁止包含 `border-radius`。
- 内部 top chrome、bottom chrome、toolbar、session bar 不声明外层 `border-radius`，只在父窗口圆角内被 `overflow: hidden` 裁切。
- resize handles 是透明命中区，应放在窗口内部边缘，避免为了扩大命中区把圆角外侧撑出矩形父层。
- BrowserWindow 透明父层必须紧贴 captionWindow；如需可点击 resize，不能在窗口外留下可见或可交互的淡色矩形。

## 实现入口

### 主进程

- `overlay-window-state.ts`
  - 增加 `OverlayWindowBounds` / `OverlayWindowSizeState`。
  - 增加 `selectOverlayWindowLayout(layer, userSize)`。
  - 增加 clamp helper。

- `main.ts`
  - 增加 IPC：`overlay:resize`。
  - 使用 `overlayWindow.getBounds()` + renderer 传入的 delta / next bounds。
  - 调用 `overlayWindow.setBounds(nextBounds, false)`。
  - 不打开 `resizable: true`。

### preload / shared API

- `DesktopApi`
  - 增加 `resizeOverlay(boundsPatch)`。
  - 可选增加 `getOverlayBounds()` 方便 renderer 初始化手柄状态。

### renderer

- `OverlayWindow`
  - 使用 `captionWindow` 包住 top chrome、history、active caption、bottom chrome。
  - 增加 `OverlayResizeHandles`。
  - 在 pointermove 中做节流，最多每 animation frame 发送一次 resize 请求。

### CSS

- `.captionWindow` 负责背景、边框、窗口阴影。
- `.overlayToolbar` 固定在 top chrome。
- `.overlaySessionBar` 固定在 bottom chrome。
- `.resizeHandle` 只在 controls/pinned/settings 显示。
- 所有按钮和 handles 必须 `-webkit-app-region: no-drag`。

## 验收标准

1. Electron overlay 仍为透明、无边框、无系统阴影、不可原生 resize。
2. 失焦默认态有可调 CSS 窗口阴影。
3. 设置面板“窗口阴影”滑块能实时改变字幕窗阴影强度。
4. 聚焦态工具栏在窗口上边，控制条在窗口下边，二者和字幕内容是同一个视觉窗口。
5. 鼠标拖拽 resize 能改变 overlay BrowserWindow 尺寸，不出现系统 resize 边框。
6. resize 后切换 default / controls / pinned 不丢失用户调过的宽度。
7. resize 不会把窗口移出当前屏幕 workArea。
8. 鼠标穿透开启时不显示 resize handles，不拦截底层应用点击。

## 参考来源

- Electron Custom Window Styles: https://www.electronjs.org/docs/latest/tutorial/custom-window-styles
- Electron Custom Window Interactions: https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions
- Electron BrowserWindow API: https://www.electronjs.org/docs/latest/api/browser-window
