# 实时字幕舒适显示缓冲设计

## 背景

EchoSync 当前字幕链路已经有 `transcript.partial`、`translation.partial`、`translation.patch`、`segment.commit` 事件，但前端显示仍存在两个相反问题：

- 直接渲染模型 token 时，中文译文会一字一刷。
- 为了避免一字一刷而在 store 层 `return lines` 时，短 token 会被丢掉，后续显示变成一波一波。

根因是 store 同时承担了两件事：保存最新字幕状态、决定屏幕何时显示。正确边界应拆开。

## 目标

- 前端永远保存最新真实文本，不能丢弃短 token。
- 屏幕显示由独立 display buffer 控制，按时间节拍输出可读短语。
- 渲染按 grapheme cluster 处理，避免拆坏中文、emoji、组合字符。
- 修订和提交仍以 `segment_id + rev` 为准，导出和历史记录使用真实字幕状态，不使用动画状态。

## 非目标

- 不改变 Agent 事件协议。
- 不在本阶段实现词级置信度 UI。
- 不用 CSS 动画假装解决数据问题。

## 架构

```text
Agent events
  -> TranscriptAssembler
       合并 ASR token / word delta
       只有标点、足够长度、或强制边界才形成 stable/locked
  -> caption-store
       保存最新 desired source/target/state/rev
       不再因为短 token 丢弃 translation.partial
  -> caption-display-buffer
       输入 desired CaptionLine[]
       输出 visible CaptionLine[]
       用 hold deadline + grapheme chunk 控制显示节奏
  -> OverlayWindow
       只渲染 visible lines

Dashboard / Export / Archive
  -> 继续使用 desired CaptionLine[]
```

## 显示策略

### 字幕模式

- `bilingual`：默认模式，翻译字幕作为主行显示，原文主字幕作为较小副行显示，双行纵向堆叠，不做左右分区。
- `source`：只显示原文主字幕，用于用户想核对 ASR 识别内容时。
- `translation`：只显示中文翻译字幕，用于沉浸式观看课程、演讲或会议时。
- 双语模式允许“翻译字幕优先”配置，但默认必须中文优先，避免英文抢占阅读注意力。

### Store 层

- `transcript.partial` 只更新源文，不清空已有译文。
- `translation.partial` 只要有目标译文就更新 desired target。
- 空目标的 source-only 事件仍不创建新行，避免字幕窗出现只有源文的短草稿。
- 旧 `rev` 仍丢弃，避免慢翻译回滚。

### Agent 断句层

- ASR 供应商的 token / word delta 不能直接变成可翻译段。
- 上游 `COMMITTED` 只表示该小块 ASR 已最终，不等同于 EchoSync 字幕段要锁定。
- 英文默认不在单词级 checkpoint；至少需要短语级内容，或遇到逗号/冒号等弱边界。
- 真正 `locked` 优先由句末标点、最大字符数、或强制长段边界触发。

### Display Buffer 层

- 首次译文过短时先暂不显示，默认 hold 140 ms。
- 达到 6 个 grapheme、遇到标点、锁定、或 hold 超时后显示。
- 已显示译文收到短增量时，默认 hold 80 ms。
- 每个 tick 最多追加 6 个可读 grapheme，标点不消耗预算并随文本一起显示，避免大段文本突然跳入。
- 如果 desired 不是 visible 的前缀，视为修订，立即显示新文本并交给样式层做短暂 revised 衰减。

### 字符算法

- 使用 `Intl.Segmenter` 的 `granularity: "grapheme"` 分割文本。
- 环境不支持 `Intl.Segmenter` 时退回 `Array.from()`，仍避免 UTF-16 surrogate pair 被拆坏。
- 后续修订 patch 可优先使用 prefix/suffix bounded diff；当前 display buffer 只需要识别 append 与 rewrite。

## 测试要求

- 单字译文事件进入 store 后必须保留为 desired 文本。
- display buffer 在 hold 时间内不显示单字初始译文。
- display buffer 在短语到达或 hold 超时后显示文本。
- display buffer 追加文本时按 grapheme chunk 前进，不能一次性把长译文全塞入。
- committed 行必须立即显示最终文本。
