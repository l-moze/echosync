# 实时字幕状态驱动与视觉合成设计

## 背景

EchoSync 当前字幕链路已经有 `transcript.partial`、`translation.partial`、`translation.patch`、`segment.commit` 事件，但前端显示仍存在两个相反问题：

- 直接渲染模型 token 时，中文译文会一字一刷。
- 为了避免一字一刷而在 store 层 `return lines` 时，短 token 会被丢掉，后续显示变成一波一波。
- 如果后端一次返回较长 snapshot，前端会整段跳出；如果后端返回单字 token，前端又会硬刷单字。
- 同一句话被 ASR 或翻译修订时，前端缺少局部 diff 和视觉衰减，只能表现为整行跳动。
- segment commit 后过快进入历史区，导致字符还没稳定就向上滚。

根因是数据状态和视觉节奏没有解耦。后端推送频率、ASR partial 修订频率、翻译首 token 频率、前端阅读动画频率不应该绑定在一起。正确边界是：

- 后端负责维护 `segment_id + rev + status` 的最新真实状态。
- Store 层负责即时保存最新 desired text，不能丢短 token。
- Display Buffer 层负责把 desired text 平滑合成为 visible text，独立控制 diff、打字机队列、修订衰减和滚动节奏。

## 目标

- 前端永远保存最新真实文本，不能丢弃短 token 或短源文。
- 前端收到 `transcript.partial` / `translation.partial` 后立即更新 desired 状态。
- 可见字幕从左到右平滑追赶 desired 状态，即使后端一次返回多个字符也不整段跳出。
- 同一个 `segment_id` 在 final 前持续更新同一块字幕，不因 partial 创建多行。
- 修订只影响不稳定尾部或 patch 范围，不整句清空重打。
- 原文和译文共享同一个 segment 生命周期，逐句对照模式下不互相错位。
- 分段、滚动和打字机解耦，commit 后有短暂驻留，不立即上滚。
- 字幕窗口高度稳定，文字更新不改变 BrowserWindow 或 captionWindow 几何。
- 语义合帧、弱边界 checkpoint、句末 commit 由 Agent 控制。
- 修订和提交仍以 `segment_id + rev` 为准，导出和历史记录使用真实字幕状态，不使用动画状态。

## 非目标

- 不在第一步强制大改 Agent 事件协议；现有 `transcript.partial`、`translation.partial`、`translation.patch`、`segment.commit` 可以先映射到新的 visual model。
- 不在本阶段实现词级置信度 UI。
- 不用 CSS 动画掩盖数据协议问题；动画只服务已经明确的 segment 状态。
- 不让后端控制前端显示速度；后端发状态，前端管渲染节奏。

## 架构

```text
Agent events
  -> TranscriptAssembler
       合并 ASR token / word delta
       源文 partial 实时输出
       同一语义段复用 segment_id
       弱标点/时间/长度形成 stable checkpoint
       句末标点或流结束形成 locked commit
  -> CascadedInterpretationEngine
       stable checkpoint 尽快翻译
       翻译按当前 segment full_text 修订，不按碎片 chunk 独立翻译
       committed checkpoint 保留最新终稿
  -> caption-store
       即时保存最新 desired source/target/state/rev
       不因为短源文或短译文丢弃事件
  -> caption-display-buffer
       输入 desired CaptionLine[]
       维护 visible CaptionLineVisual[]
       对同一 segment 做 LCP / patch diff
       用 typewriter queue 从左到右追赶
       管理 segment settling / history 滚动
  -> OverlayWindow
       渲染 fixed caption track，不由文本内容撑高窗口

Dashboard / Export / Archive
  -> 继续使用 desired CaptionLine[]
```

### desired 与 visible 的边界

`desired` 是数据真实状态，必须即时更新；`visible` 是用户看到的状态，可以为了阅读体验滞后几十到几百毫秒。

```ts
type CaptionLine = {
  id: string;
  rev: number;
  state: "interim" | "stable" | "revised" | "locked";
  sourceText: string;
  targetText: string;
  startMs: number;
  endMs: number;
};

type CaptionLineVisual = {
  id: string;
  desiredRev: number;
  phase: "active" | "settling" | "history";
  source: VisualTextLane;
  target: VisualTextLane;
  createdAtMs: number;
  settledAtMs: number | null;
};

type VisualTextLane = {
  desiredText: string;
  visibleText: string;
  stablePrefixLength: number;
  queue: RenderToken[];
  revisedRanges: VisualRange[];
};
```

## 显示策略

### 字幕模式

- `bilingual`：默认模式，源文在上、译文在下，双行纵向堆叠，不做左右分区。英语课程/演讲场景下，英文源文稳定锚定在上方，中文译文允许慢半拍出现。
- `source`：只显示原文主字幕，用于用户想核对 ASR 识别内容时。
- `translation`：只显示中文翻译字幕，用于沉浸式观看课程、演讲或会议时。
- 双语模式允许“翻译字幕优先”配置，但默认关闭，避免译文流式更新时把源文位置挤来挤去。
- 译文尚未返回时不显示“正在翻译...”占位；前端只显示已经收到的源文或译文 snapshot。

### Segment 生命周期

EchoSync 的实时字幕核心必须从 append-only 文本流升级为 segment-based provisional caption engine。

```text
loading -> interim -> interim -> stable -> revised -> locked
```

规则：

- 同一句话没有 locked 前，永远更新同一个 `segment_id`。
- `transcript.partial` 和 `translation.partial` 都是“当前 segment 的最新假设”，不是新增字幕行。
- `segment.commit` 才把 segment 送入 `settling`，随后延迟进入 history。
- 视觉换行不等于 final；软换行只解决可读性，不改变 segment 生命周期。

### 稳定区与可变区

后端长期目标应提供 `stable_text` / `unstable_text`；MVP 可由前端用轻量规则推断。

- 英文：final 前最后 3-5 个词视为 unstable，其余作为 stable prefix。
- 中文：final 前最后 6-10 个字符或最后一个标点后的尾部视为 unstable。
- final 后全文 stable。
- ASR 或翻译修订时，优先只替换 unstable 尾部。

后端不需要做字符级 diff。后端负责 ID-based overwrite；前端为了动画和局部替换可以做 LCP / token diff。

```ts
function longestCommonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i += 1;
  }
  return i;
}
```

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
- 短暂停顿 `< 800ms` 不切段。
- `800ms-1500ms` 停顿只有在存在标点、语义完整或长度压力时才切段。
- `> 1500ms` 静音可强制切段。
- 当前字幕超过 2-3 行时允许软换行或 soft checkpoint，但不等于 final。

### 翻译发射层

- LLM 可以内部 token streaming，但 `DeepSeekTranslator.stream_translate()` 只在可读译文片段、标点、rewrite 或 final 时发给字幕层。
- 默认译文发射策略为首包至少 4 个可见字符，后续增量至少 2 个可见字符；1 字 delta 继续合帧，2 字短语可以快速刷新。
- stable checkpoint 的译文可以比源文慢半拍；源文行继续实时更新，不等待翻译。
- weak boundary stable 必须进入翻译队列，不能被后续 committed 覆盖。
- committed 总是翻译最新终稿，并发送 `segment.commit` 锁定。
- 翻译应基于当前 segment 的 `source_full` 和上一次译文修订，不按 ASR chunk 独立翻译。
- ASR partial 可以 100-200ms 更新；翻译触发建议 debounce 300-600ms，final 时强制翻译一次。
- 翻译 prompt 需要携带 `previous_source`、`previous_target`、`current_source`，让模型修订当前译文而不是生成孤立片段。

### Display Buffer 层

Display Buffer 不做语义 hold，不丢短 token；但它必须做视觉合成。

- 输入 desired `CaptionLine[]`，输出 visual `CaptionLineVisual[]`。
- 同一个 `segment_id` 只更新，不新增。
- 对旧 visible text 和新 desired text 做 LCP diff。
- 公共前缀保留，旧尾部淡出或直接替换，新尾部进入 typewriter queue。
- source lane 和 target lane 使用独立队列，译文允许慢半拍。
- `pendingLineIds` 表示 visual 仍在追赶 desired，而不是数据层 hold。
- 修订高亮 1.5-2 秒后衰减为 stable 样式。

### 打字机队列

打字机是显示层效果，不等于数据层 append。

```ts
type RenderToken = {
  segmentId: string;
  lane: "source" | "target";
  value: string;
  op: "insert" | "replace-tail";
};
```

建议节奏：

- 英文：20-35ms / grapheme，按词边界可轻微加速。
- 中文：30-50ms / grapheme。
- 如果 backlog 很大，允许批量每帧吐 2-4 个 grapheme 追赶，但不要整段瞬移。
- final 或用户切到历史区时可以快速 flush 当前队列。

### 局部修订

收到同一个 segment 的新文本：

```text
old: 我正在册
new: 我正在测试
```

处理：

```text
common: 我正在
old_tail: 册
new_tail: 测试
```

MVP 规则：

1. 保留 common。
2. 如果 old tail 位于 unstable 区，直接替换或淡出。
3. new tail 进入 typewriter queue。
4. 如果 common 过短，说明发生大修订，允许整条 lane 快速 crossfade，但不要频繁使用。

### 稳定滚动

文字系统和滚动系统必须解耦：

- 文字系统负责逐字显示、修订、衰减。
- 滚动系统负责 segment track 平滑上移。

滚动触发条件：

- `segment.commit` 后进入 `settling`，驻留 500-1200ms。
- 新 active segment 创建且可视区不足。
- active segment 因换行超过可视区域。

禁止每个 token 调 `scrollToBottom()`。应使用固定高度轨道和 `transform: translateY(...)`。

### 时间戳与顺序

- 当前字幕选择按前端 `receivedAtMs` / 接收顺序，不依赖音频时间戳。
- `start_ms` / `end_ms` 继续用于 SRT、历史回放和导出，不用于判断哪一行是“当前正在说”。
- 这避免 ASR provider 返回累计窗口时间戳时，旧音频时间把新字幕卡住。

## 窗口稳定性要求

字幕窗口必须是固定几何的视觉舞台，文本更新不能改变窗口大小。

```css
.caption-window {
  height: var(--caption-window-height);
  overflow: hidden;
  position: relative;
}

.caption-track {
  will-change: transform;
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.caption-segment {
  min-height: var(--caption-segment-min-height);
  line-height: 1.28;
}
```

逐句对照模式下，每个 segment 至少预留原文一行 + 译文一行高度。长句可以在 segment 内软换行，但窗口本身不抖动。窗口圆角、阴影、工具栏显示不参与字幕文字更新动画。

## 事件协议演进

现有协议可以继续工作，但目标协议应逐步收敛到统一的 caption update。

```ts
type CaptionUpdateEvent = {
  type: "caption_update";
  segment_id: string;
  revision: number;
  state: "loading" | "interim" | "stable" | "final";
  source: {
    full_text: string;
    stable_text?: string;
    unstable_text?: string;
    language: string;
  };
  target?: {
    full_text: string;
    stable_text?: string;
    unstable_text?: string;
    language: string;
  };
  timing: {
    start_ms: number;
    end_ms: number;
  };
};
```

迁移策略：

- `transcript.partial` 映射为 `caption_update.source.full_text`。
- `translation.partial` 映射为同一 segment 的 `target.full_text`。
- `translation.patch` 映射为 target lane 的修订事件。
- `segment.commit` 映射为 `state="final"`。

## 实施顺序

### 第一阶段：状态契约收紧

- 确认同一句 partial 更新同一个 `segment_id`。
- 前端收到相同 `segment_id` 时只覆盖 desired 状态，不新增多行。
- `CaptionLine` 增加可推导 stable/unstable 的 helper，不污染导出数据。

验收：同一句话 partial 更新时，字幕窗口只有当前块更新，不新增多行。

### 第二阶段：前端 visual buffer

- `caption-display-buffer` 从 snapshot pass-through 升级为 visual compositor。
- 增加 `visibleSourceText` / `visibleTargetText`。
- 增加 source / target 独立 typewriter queue。
- Overlay 渲染 visible text，Dashboard / Export 继续使用 desired text。

验收：即使后端一次返回多个字符，前端也从左到右平滑生成。

### 第三阶段：diff 修订

- 对同一 segment 的 old visible 和 new desired 做 LCP diff。
- 保留公共前缀，替换 unstable 尾部。
- 修订范围高亮 1.5-2 秒后衰减。

验收：`我正在册` 可以自然修订为 `我正在测试`，不整句闪烁。

### 第四阶段：稳定滚动

- 字幕窗口固定高度。
- segment track 用 transform 上移。
- commit 后进入 settling，延迟 500-1200ms 进入 history。
- 禁止每字 scroll。

验收：字幕持续生成时窗口高度不变，上滚自然，不一跳一跳。

### 第五阶段：翻译修订

- 翻译基于当前 segment full text 和上一版译文。
- 翻译触发 debounce 300-600ms。
- final 时强制翻译一次。
- target lane 也进入 diff + typewriter 渲染。

验收：逐句对照模式下，原文和译文同步更新、不乱跳、不互相错位。

## 禁止事项

- 不要每次收到 ASR 文本就 append 新字幕。
- 不要把 ASR chunk 当作句子。
- 不要 partial 一来就 final。
- 不要每个字都 scrollToBottom。
- 不要用 `innerText = newText` 粗暴刷新整段字幕。
- 不要让后端控制前端显示速度。
- 不要让翻译按碎片 chunk 独立翻译。
- 不要让原文和译文使用不同的 segment 生命周期。

## 测试要求

- 单字源文事件进入 store 后必须立即形成 desired 当前行。
- 单字译文事件进入 store 后必须保留到 desired target。
- display buffer 不丢短 token，但 visible text 可按 typewriter 节奏追赶。
- 后端一次返回 `"测试字幕"` 时，visible 可按 `"测" -> "测试" -> "测试字" -> "测试字幕"` 追赶。
- 同一 segment 从 `"我正在册"` 修订为 `"我正在测试"` 时，公共前缀保留，尾部进入修订队列。
- `segment.commit` 后 line 先进入 settling，不立即滚入 history。
- source lane 和 target lane 共享 segment 生命周期，逐句对照不乱序。
- 窗口高度不因每次 token 更新而改变。
- stable checkpoint 与 committed checkpoint 在后端翻译调度中分轨，前者不能被后者覆盖。
- committed 行必须最终 flush 到可见文本，并在短暂驻留后进入历史。
