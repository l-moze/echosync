# 实时字幕舒适显示缓冲设计

## 背景

EchoSync 当前字幕链路已经有 `transcript.partial`、`translation.partial`、`translation.patch`、`segment.commit` 事件，但前端显示仍存在两个相反问题：

- 直接渲染模型 token 时，中文译文会一字一刷。
- 为了避免一字一刷而在 store 层 `return lines` 时，短 token 会被丢掉，后续显示变成一波一波。

根因是语义合帧的职责放错了位置：前端 store/display buffer 如果继续按字符数和时间 hold 文本，就会让“已经收到的事件”晚于真实 stream 显示。正确边界是后端负责发射可读译文 checkpoint，前端负责保存和即时渲染收到的最新 snapshot。

## 目标

- 前端永远保存最新真实文本，不能丢弃短 token 或短源文。
- 前端收到 `transcript.partial` / `translation.partial` 后立即更新当前字幕行。
- 语义合帧、弱边界 checkpoint、句末 commit 由 Agent 控制。
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
       源文 partial 实时输出
       弱标点/时间/长度形成 stable checkpoint
       句末标点或流结束形成 locked commit
  -> CascadedInterpretationEngine
       stable checkpoint 尽快翻译
       committed checkpoint 保留最新终稿
  -> caption-store
       保存最新 desired source/target/state/rev
       不因为短源文或短译文丢弃事件
  -> caption-display-buffer
       输入 desired CaptionLine[]
       输出 visible CaptionLine[]
       不做语义 hold/chunk，只保留元数据并透传 snapshot
  -> OverlayWindow
       只渲染 visible lines

Dashboard / Export / Archive
  -> 继续使用 desired CaptionLine[]
```

## 显示策略

### 字幕模式

- `bilingual`：默认模式，源文在上、译文在下，双行纵向堆叠，不做左右分区。英语课程/演讲场景下，英文源文稳定锚定在上方，中文译文允许慢半拍出现。
- `source`：只显示原文主字幕，用于用户想核对 ASR 识别内容时。
- `translation`：只显示中文翻译字幕，用于沉浸式观看课程、演讲或会议时。
- 双语模式允许“翻译字幕优先”配置，但默认关闭，避免译文流式更新时把源文位置挤来挤去。
- 译文尚未返回时不显示“正在翻译...”占位；前端只显示已经收到的源文或译文 snapshot。

### Store 层

- `transcript.partial` 只更新源文，不清空已有译文。
- `translation.partial` 只要有目标译文就更新 desired target；目标为空时只更新已有行源文。
- `transcript.partial` 即使只有 1 个字也创建/更新当前源文行，保证前端不比接收流更慢。
- 空源文事件不创建新行，避免无意义空字幕。
- 旧 `rev` 仍丢弃，避免慢翻译回滚。

### Agent 断句层

- ASR 供应商的 token / word delta 不能直接变成可翻译段。
- 上游 `COMMITTED` 只表示该小块 ASR 已最终，不等同于 EchoSync 字幕段要锁定。
- 英文默认不在单词级 checkpoint；至少需要短语级内容，或遇到逗号/冒号等弱边界。
- 真正 `locked` 优先由句末标点、最大字符数、或强制长段边界触发。

### 翻译发射层

- LLM 可以内部 token streaming，但 `DeepSeekTranslator.stream_translate()` 只在可读译文片段、标点、rewrite 或 final 时发给字幕层。
- 默认译文发射策略为首包至少 4 个可见字符，后续增量至少 2 个可见字符；1 字 delta 继续合帧，2 字短语可以快速刷新。
- stable checkpoint 的译文可以比源文慢半拍；源文行继续实时更新，不等待翻译。
- weak boundary stable 必须进入翻译队列，不能被后续 committed 覆盖。
- committed 总是翻译最新终稿，并发送 `segment.commit` 锁定。

### Display Buffer 层

- 不再按 grapheme 或时间做二次语义缓冲。
- 输入 desired `CaptionLine[]`，输出同一批 visible `CaptionLine[]`。
- 只保留 `firstSeenAtMs`、`lastVisibleAtMs` 等元数据，供后续视觉衰减和动效使用。
- `pendingLineIds` 恒为空；前端不能通过 pending 状态人为拖慢已经收到的字幕。

### 时间戳与顺序

- 当前字幕选择按前端 `receivedAtMs` / 接收顺序，不依赖音频时间戳。
- `start_ms` / `end_ms` 继续用于 SRT、历史回放和导出，不用于判断哪一行是“当前正在说”。
- 这避免 ASR provider 返回累计窗口时间戳时，旧音频时间把新字幕卡住。

## 测试要求

- 单字源文事件进入 store 后必须立即形成当前行。
- 单字译文事件进入 store 后必须保留并立即透传给 display buffer。
- display buffer 不做 hold；收到什么 snapshot 就显示什么 snapshot。
- stable checkpoint 与 committed checkpoint 在后端翻译调度中分轨，前者不能被后者覆盖。
- committed 行必须立即显示最终文本。
