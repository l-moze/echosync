# 复盘时间线静音折叠 UI 设计

## 背景

实时同传和会后复盘面对的是两条不同时间线。

实时链路需要低延迟：系统可以在静音时停止发送音频正文，并用 `audio.final` 表达 ASR flush。复盘链路需要可追溯：录音必须保留原始音频、暂停、停顿和完整 raw 时间线，否则 SRT、点击跳转和原始音频都会失真。

当前代码已经有部分底层能力：

- `realtime-audio-client` 和 WASAPI sidecar 会记录 `activityRanges`。
- `review-timeline.ts` 可以把 raw 时间线映射为 `active_audio` / `long_silence` spans。
- `SessionRecord.timeline` 保存 `rawDurationMs`、`contentDurationMs`、`reviewDurationMs`。
- 复盘播放时可以从 review 时间映射回 raw 时间，并在压缩静音段自动跳过。

但当前前端表达不够好：复盘页只显示普通进度条和一条“已压缩 X 静音”的临时文本，用户看不到哪些区间是内容、哪些区间被折叠，也没有明确的“压缩静音 / 原始时间线”切换。这个能力在产品上仍是隐藏实现，不是可理解的 UI。

## 产品定位

静音折叠只属于会后复盘，不属于实时字幕主链路。

目标不是删除静音，而是提供一条更适合学习/看课的 review 时间线：

- 用户播放复盘时，不被视频暂停、无人声空段、长时间等待拖慢。
- 用户仍可回到原始时间线，确认字幕、录音和导出时间戳。
- 用户能清楚知道系统跳过了什么，而不是感觉播放器“突然乱跳”。

## 三条时间线

| 时间线 | 字段 | 含义 | UI 使用 |
| --- | --- | --- | --- |
| 原始时间线 | `rawDurationMs` | 从开始到停止的真实录制时长，包含静音、暂停和空段。 | 原始音频 seek、SRT 导出、诊断。 |
| 内容时间线 | `contentDurationMs` | 有效音频活动区间合计。 | 统计“真正听了多少内容”。 |
| 复盘时间线 | `reviewDurationMs` | 播放器使用的压缩时间线。 | 默认进度条、会话列表时长、摘要 prompt。 |

默认策略：

- `windows-system` / `file` / 视频 / 网课：压缩超过约 `2.5s` 的长静音为约 `500ms`。
- `microphone` / `mixed` / 会议：默认保留完整时间线，但可以提供”跳过长静音”开关。
- SRT 导出永远使用原始 segment `startMs/endMs`，不使用压缩时间线。
- Markdown/TXT 导出可以在元数据中同时展示复盘时长和原始录制时长。

## 核心交互

### 1. 复盘播放器必须可解释

播放器不应只是一条普通 range。它需要是一条分段时间线：

```text
[内容][压缩静音][内容][短停顿并入内容][压缩静音][内容]
```

视觉规则：

- `active_audio`：实色主轨，表示有语音/字幕内容。
- `long_silence`：细纹、淡色或断裂轨道，表示被压缩的静音。
- 当前播放点进入 `long_silence` 的 compact gap 时，显示“已压缩 00:04 静音”。
- hover 到静音段时，tooltip 显示“原始静音 00:05，复盘保留 00:00.5”。
- hover 到内容段时，tooltip 显示原始时间和复盘时间，例如“原始 01:12-01:34 / 复盘 00:48-01:10”。

### 2. 默认模式按场景选择

在记录详情页顶部提供轻量模式提示和切换：

| 场景 | 默认 | 用户可切换 |
| --- | --- | --- |
| 视频 / 网课 / 文件 | 压缩静音 | 可切到原始时间线 |
| 会议 / 麦克风 | 原始时间线 | 可打开跳过长静音 |

文案要避免技术词：

- 开启态：`压缩长静音`
- 关闭态：`保留原始停顿`
- 当前提示：`复盘已压缩 02:13 静音，原始录制 18:40`

### 3. 播放行为

默认复盘播放使用 `reviewMs` 作为 UI 进度。

当用户拖动进度条：

1. UI 拿到 `reviewMs`。
2. 用 `reviewToRawMs(timeline, reviewMs)` 转成真实 `audio.currentTime`。
3. 音频按 raw 时间 seek。
4. 字幕高亮用 raw 时间找对应 segment。
5. UI 进度再用 `rawToReviewMs(timeline, rawMs)` 回填，避免跳动。

当原始音频播放进入被压缩的长静音：

1. 先保留 compact gap 的短暂停留，给用户一个“跳过了静音”的感知。
2. 到达 compact gap 末尾后自动 seek 到 `long_silence.rawEndMs`。
3. 刷新字幕高亮和滚动位置。

不能直接瞬移。直接瞬移会让用户以为音频丢失或播放器卡顿。

### 4. 文本区联动

字幕列表仍按原始 segment 时间戳排序。

播放时：

- 使用 raw 时间选择 active segment。
- active segment 高亮并自然滚动到可见区域。
- 如果当前 raw 时间处于 long silence，没有对应字幕，则保留上一条高亮，并显示静音提示，不要清空文本区。

点击字幕段时：

- 跳到该段 `startMs` 的 raw 时间。
- 如果当前 UI 是压缩模式，进度条显示 `rawToReviewMs(timeline, startMs)`。
- 如果点击的是靠近长静音后的第一段，不能先滚到静音段再跳，应直接进入内容段。

### 5. 异常状态处理

- 当 `timeline` 缺失或 `compressionEnabled: false` 时，UI 回退到普通进度条，不显示分段轨道。
- 当 `spans` 为空数组时，视为全程内容，不显示静音折叠控制。
- 当 `rawDurationMs` 与实际音频时长不匹配超过阈值（如 500ms）时，记录 diagnostics warning，UI 优先使用音频实际时长。

## 复盘页布局

### 顶部信息

记录标题下方展示三项紧凑指标：

- `复盘时长`：默认主指标，来自 `reviewDurationMs`。
- `原始录制`：来自 `rawDurationMs`。
- `有效内容`：来自 `contentDurationMs`。

只有当 `timeline` 缺失时，才退回只显示普通 `durationMs`。

### 播放器区域

播放器区域应包含：

- 播放 / 暂停按钮。
- 分段时间线条。
- 当前时间：`review current / review total`。
- 时间线模式 toggle：`压缩长静音` / `保留原始停顿`。
- 当前跳过提示：`已压缩 00:05 静音`。

不要把“压缩静音”只做成状态文本。它必须和时间线视觉绑定。

### 摘要和元数据

摘要区域可以显示：

- `复盘时长` 用于摘要 prompt 和列表展示。
- `原始录制` 用于诊断和导出说明。
- `有效内容` 用于学习效率感知。

这些指标不要挤在诊断折叠里。它们是用户能理解复盘为什么变短的产品信息。

## 数据契约

`SessionRecord.timeline`：

```ts
type SessionRecordTimeline = {
  rawDurationMs: number;
  contentDurationMs: number;
  reviewDurationMs: number;
  sourceType: "meeting" | "video" | "course" | "file" | "microphone";
  compressionEnabled: boolean;
  spans: Array<{
    kind: "content" | "silence";
    rawStartMs: number;
    rawEndMs: number;
    reviewStartMs: number;
    reviewEndMs: number;
  }>;
};
```

`ReviewTimeline` 内部使用：

```ts
type TimelineSpan =
  | { type: "active_audio"; rawStartMs: number; rawEndMs: number; reviewStartMs: number; reviewEndMs: number }
  | { type: "long_silence"; rawStartMs: number; rawEndMs: number; reviewStartMs: number; reviewEndMs: number; compactMs: number };
```

转换规则：

- 存储层用 `kind: "content" | "silence"`，避免暴露内部算法命名。
- UI 层转成 `active_audio` / `long_silence`，便于分段渲染。
- `rawDurationMs` 是 truth source；压缩只影响 review UI，不修改 segment 时间戳。

## 当前实现缺口

| 模块 | 当前状态 | 缺口 |
| --- | --- | --- |
| 算法 | `review-timeline.ts` 已支持 spans 和映射。 | 需要补 UI 的视觉分段和用户可控模式。 |
| 记录模型 | `SessionRecord.timeline` 已能保存三条时间线。 | 记录详情缺少三项指标的清晰展示。 |
| 播放器 | 进度条使用 `reviewDurationMs`，能显示压缩提示。 | range 轨道看不出静音段，用户不知道为什么跳。 |
| 字幕联动 | 播放高亮和点击跳转已有基础。 | 静音段应保留上一条高亮并展示跳过提示。 |
| 导出 | Markdown 和摘要可用复盘时长，SRT 保留原始时间戳。 | 导出弹窗/说明未提示“字幕时间戳为原始时间线”。 |
| 设置 | 场景默认策略存在于代码判断。 | 没有显式 toggle 和持久偏好。 |

## 前端落地组件

建议新增或整理为以下组件：

- `RecordTimelinePlayer`
  负责播放按钮、时间显示、模式 toggle 和进度交互。

- `ReviewTimelineRail`
  负责渲染 `active_audio` / `long_silence` 分段轨道、hover tooltip、拖动定位。

- `ReviewTimelineStats`
  负责展示复盘时长、原始录制、有效内容。

- `SkippedSilenceNotice`
  负责显示当前 compact gap 的跳过提示。

- `useReviewPlaybackTimeline`
  封装 `reviewMs <-> rawMs` 映射、自动跳过、active segment 选择，避免 `main.tsx` 继续膨胀。
  
  ```ts
  function useReviewPlaybackTimeline(
    timeline: SessionRecordTimeline, 
    segments: SessionRecordSegment[]
  ) {
    return {
      reviewMs: number;
      rawMs: number;
      activeSegment: SessionRecordSegment | null;
      currentSpan: TimelineSpan | null;
      isInSilence: boolean;
      seekToReviewMs: (ms: number) => void;
      seekToSegment: (segmentId: string) => void;
      toggleCompressionMode: () => void;
    };
  }
  ```

## MVP 实施顺序

### P0：让能力可见

1. 把普通 range 替换为分段时间线。
2. 记录详情页展示复盘时长、原始录制、有效内容。
3. 播放进入压缩静音时显示“已压缩 X 静音”。
4. 导出 SRT 时提示“使用原始时间戳”。

验收：

- 一段 10 秒录音，中间 5 秒无人声，视频模式下复盘进度条能看出中间被压缩。
- 拖动到压缩静音段，tooltip 能解释 raw/review 映射。
- 播放跨过压缩静音时，字幕高亮不消失。

### P1：允许用户控制

1. 增加 `压缩长静音 / 保留原始停顿` toggle。
2. 视频/网课默认开启，会议默认关闭。
3. 用户在当前记录中的选择即时生效，不改变原始录音。
4. 偏好设置可保存默认策略。

验收：

- 同一条记录切换模式后，进度条总时长和 spans 立即变化。
- 切回原始时间线后不自动跳过静音。
- 重新打开记录，保留用户上次选择或默认策略。

### P2：增强复盘效率

1. 支持“只看内容段”列表导航。
2. 支持键盘快捷键跳到上一段/下一段内容。
3. 摘要和关键词可以跳转到对应内容区间。

## 测试要求

单元测试：

- `review-timeline.test.ts` 覆盖压缩、保留、映射、短静音、空 activity。
- `session-records.test.ts` 覆盖 review duration 展示、Markdown 双时长、SRT 原始时间戳。

渲染合同测试：

- 记录详情源码必须包含分段轨道渲染，不再只依赖普通 range。
- UI 必须出现 `复盘时长`、`原始录制`、`有效内容`。
- UI 必须出现 `压缩长静音` 或 `保留原始停顿` 控制。
- SRT 导出说明必须包含原始时间线语义。

人工测试：

1. 播放一个视频，中间暂停 5-10 秒后继续说话。
2. 停止同传进入复盘。
3. 确认复盘时长短于原始录制，且时间线显示压缩静音段。
4. 播放跨过静音段，字幕高亮稳定，提示显示已压缩静音。
5. 切到保留原始停顿，播放不再自动跳过长静音。

## 不做

- 不修改实时 ASR 的静音门控策略。
- 不把静音折叠用于实时字幕输出。
- 不压缩 SRT 或原始音频时间戳。
- 不删除原始录音里的静音，除非后续明确做“导出精简音频”功能。

