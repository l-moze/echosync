# 会话记录、复盘交互与翻译可靠性设计

## 背景

本设计承接以下既有规范：

- `docs/superpowers/specs/2026-06-06-home-launcher-engine-settings-design.md`
- `docs/superpowers/specs/2026-06-06-caption-display-buffer-design.md`
- `docs/caption-chain-audit.md`
- `doc/architecture-mvp.md`

当前实时字幕已经进入“可用但体验不稳定”的阶段。用户反馈集中在四类问题：

1. 翻译到句号或分段后有时不继续返回。
2. 字幕窗口仍有重叠和卡顿，停止播放时错误文本不应出现在字幕面板。
3. 会话复盘只能处理本次进程内草稿，不能保存、重命名、摘要和回到首页会议记录。
4. 复盘页点击文本跳转到时间段、高亮和自然滚动没有形成可靠闭环。

这不是单纯 UI 问题。它同时涉及 Agent 翻译生命周期、时间戳契约、Electron 主进程持久化、Renderer 复盘状态机和日志可观测性。

## 本地证据

### Electron 仓库日志

`apps/desktop/desktop-electron.err.log` 出现重复窗口生命周期错误：

```text
Error occurred in handler for 'caption:event': TypeError: Object has been destroyed
Error occurred in handler for 'audio:start': TypeError: Object has been destroyed
Error occurred in handler for 'audio:stop': TypeError: Object has been destroyed
Error occurred in handler for 'overlay:visible': TypeError: Object has been destroyed
```

判断：窗口重叠、卡顿、退出后仍有事件进入，至少有一部分来自 destroyed `BrowserWindow/webContents` 仍被 IPC 广播命中。主进程必须把窗口生命周期和事件广播完全解耦。

### Electron userData 日志

真实日志位置：

```text
C:\Users\24787\AppData\Roaming\EchoSync\logs\main.log
C:\Users\24787\AppData\Roaming\EchoSync\logs\main.old.log
```

现象：

- 日志包含大量 `transcript.partial`、`translation.partial`、`segment.commit`。
- `agentToRendererMs` 多数在 0-10ms 量级，说明 Agent 到 Renderer 的 IPC 传输不是当前主要慢点。
- 日志没有可检索到 `translation_checkpoint_started / first_token / finished`，导致无法从桌面日志直接判断“句号后不返回”到底卡在 DeepSeek、翻译调度、caption publish，还是前端显示层。
- 多个 `segment.commit` 的 `startMs` 相同，例如本地日志中多段 commit 都出现 `startMs: 6320`，但 `endMs` 持续增长到 100s 以后。这会让复盘页的点击跳转和播放高亮天然不准，因为多个段在时间轴上重叠。

### 当前代码状态

- `apps/desktop/src/shared/session-records.ts` 只有 `SessionRecordListItem`、搜索和 Markdown 序列化。
- `apps/desktop/src/renderer/main.tsx` 里的 `recentSessionRecords` 是 mock 数据。
- `apps/desktop/src/shared/session-archive.ts` 只有 `SessionArchiveDraft`，音频是 `Blob objectUrl`，应用退出后不可恢复。
- `selectPlaybackSegmentId(lines, currentMs)` 依赖 `startMs/endMs` 区间；后端时间戳重叠时高亮会错。
- `apps/agent/src/echosync_agent/services/asr/transcript_assembler.py` 的 committed segment 使用 `first.start_ms` 和 `last.end_ms`，当 provider 上游时间戳是累计窗口或 assembler 没重置 first，就会放大时间段重叠。

## 产品目标

1. 翻译在标点、停顿、会话停止时必须有明确 flush 语义：要么返回最终译文，要么记录可诊断原因，不能静默消失。
2. 停止播放是正常结束，不是错误。停止后的 provider 异常、超时、取消错误都不进入字幕文本和普通错误浮层。
3. 会话记录必须持久化，并和首页“会议记录”入口连通。
4. 复盘页是独立产品面：可以重命名、查看元数据、摘要、音频回放、文本高亮、点击跳转、导出。
5. 字幕窗口和复盘页都不因每个 token 或每个 segment 修改窗口尺寸，避免重叠和卡顿。

## 非目标

- 不在本设计里重做实时字幕动画细节，动画规则仍以 caption display buffer 设计为准。
- 不引入云同步账号体系。
- 不要求词级时间戳。第一阶段只保证 segment 级时间戳正确。
- 不把 provider、WebSocket frame、原始调试 payload 暴露在普通会议记录详情页。

## 核心状态机

### 实时会话

```text
starting
  -> recording
  -> stopping(user_stop)
  -> finalizing
  -> saved

starting / recording
  -> failed(error)
```

规则：

- `user_stop` 后进入 `stopping`，Renderer 立即停止采集，Agent 收到 `audio.end(reason="user_stop")`。
- `stopping` 期间的 provider cancel/timeout 只能进入诊断日志，不能作为普通 `realtime.error` 展示。
- `finalizing` 负责 flush 翻译、生成最终 `segment.commit`、写入会话记录草稿。
- `saved` 后首页最近记录可见，Finished 页面可进入记录详情。

### 翻译 checkpoint

```text
source.partial
  -> source.stable_checkpoint
  -> translation.queued
  -> translation.streaming
  -> translation.finished
  -> segment.commit

source.committed
  -> translation.flush_required
  -> translation.finished | translation.empty_with_reason
  -> segment.commit
```

规则：

- 标点和 endpoint 只能触发 `flush_required`，不能跳过翻译。
- `simul_wait` 只允许等待 stable 半句；遇到 committed/final/user_stop flush 必须放行。
- 如果 provider 返回空译文，需要发出 `translation.empty_with_reason` 诊断，并保留源文，不在 UI 上假装成功。

## 后端职责

### Agent 实时链路

Agent 负责准确表达语音和翻译生命周期：

- 生成 `session_id`。
- 接收 `audio.start/audio.end`。
- 输出 `transcript.partial`、`translation.partial`、`translation.patch`、`segment.commit`、`realtime.done`。
- 区分用户停止和真实错误。
- 在 committed / user_stop / stream_end 时 flush 最后一个可翻译文本。

必须新增或收紧的日志：

```text
translation_checkpoint_queued session_id segment_id rev status reason audio_start_ms audio_end_ms source_chars
translation_checkpoint_started session_id segment_id rev status audio_start_ms audio_end_ms source_chars
translation_checkpoint_first_token session_id segment_id rev first_token_ms target_chars
translation_checkpoint_finished session_id segment_id rev final_ms delta_count source_chars target_chars
translation_checkpoint_empty session_id segment_id rev reason source_chars
translation_checkpoint_skipped session_id segment_id rev reason simul_reason
segment_timing_anomaly session_id segment_id start_ms end_ms previous_start_ms previous_end_ms reason
realtime_pipeline_exception_suppressed_after_user_stop session_id error
```

日志必须满足：

- 所有字幕事件和翻译日志都带 `session_id + segment_id + rev`。
- Desktop 的 `[caption-event] main_forwarded` 和 Agent 的 `translation_checkpoint_*` 可以离线 join。
- `echosync-log-summary` 要能统计 started/finished 不配对、finished 后无 caption publish、commit 时间戳重叠。

### 时间戳契约

Agent 必须保证 committed segments 形成可播放时间轴：

```text
segment[i].start_ms < segment[i].end_ms
segment[i].start_ms >= segment[i-1].start_ms
segment[i].end_ms > segment[i-1].end_ms
committed segment 不应长期共享同一个 start_ms
```

如果 ASR provider 只提供累计窗口时间，Agent 需要在 assembler 层生成局部时间轴：

- `segment_start_ms` 以当前 committed 段的首个有效音频边界为准。
- 每次 committed 后重置 current segment 的 `first`.
- 如果发现 `last.end_ms - first.start_ms` 异常大且已发生多个 commit，记录 `segment_timing_anomaly` 并使用上一段 `end_ms` 作为下一段 `start_ms` 的兜底。

### 会话记录生成

Agent 不直接拥有桌面本地文件系统；它输出可持久化的领域数据。Desktop main 负责落盘。

Agent 需要在 `realtime.done` 或 final commit 后提供：

```ts
type RealtimeSessionFinalPayload = {
  type: "realtime.done";
  session_id: string;
  reason: "user_stop" | "stream_end" | "client_disconnect";
  started_at_ms?: number;
  ended_at_ms?: number;
  segment_count?: number;
};
```

## Desktop Main 职责

Desktop main 是本地数据和窗口生命周期的 owner。

### 本地持久化

按 Electron 官方建议，记录写入 `app.getPath("userData")` 下的专用子目录：

```text
{userData}/echosync-data/sessions/
  {sessionId}/session.json
  {sessionId}/audio.webm
  {sessionId}/diagnostics.jsonl
```

不直接写在 `userData` 根目录，避免和 Chromium `Cache`、`GPUCache`、`Local Storage` 冲突。

### SessionRecord 数据模型

```ts
type SessionRecord = {
  id: string;
  title: string;
  createdAt: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  sourceLang: string;
  targetLang: string;
  audio?: {
    path: string;
    mimeType: string;
    sizeBytes: number;
  };
  summary: {
    status: "pending" | "ready" | "failed";
    text: string;
    keywords: string[];
    updatedAt?: string;
  };
  metadata: {
    segmentCount: number;
    sourceCharCount: number;
    targetCharCount: number;
    patchCount: number;
    averageCaptionLagMs?: number;
  };
  segments: SessionRecordSegment[];
  diagnostics?: {
    hasTimingAnomaly: boolean;
    hasTranslationGap: boolean;
    logPath?: string;
  };
  updatedAt: string;
};

type SessionRecordSegment = {
  id: string;
  startMs: number;
  endMs: number;
  sourceText: string;
  targetText: string;
  sourceEditedText?: string;
  targetEditedText?: string;
  revisionState: "draft" | "final" | "edited";
  patchCount: number;
};
```

### IPC 接口

Renderer 不直接读写文件。通过 preload 暴露：

```ts
sessionRecords.list(): Promise<SessionRecordListItem[]>
sessionRecords.get(id: string): Promise<SessionRecord>
sessionRecords.saveDraft(input: SessionRecordDraftInput): Promise<SessionRecord>
sessionRecords.rename(id: string, title: string): Promise<SessionRecord>
sessionRecords.updateSegment(id: string, segment: SessionRecordSegmentPatch): Promise<SessionRecord>
sessionRecords.updateSummary(id: string, summary: SessionRecord["summary"]): Promise<SessionRecord>
sessionRecords.delete(id: string): Promise<void>
sessionRecords.export(id: string, format: "markdown" | "srt" | "txt"): Promise<{ path?: string; text?: string }>
sessionRecords.getAudioUrl(id: string): Promise<string | null>
```

2026-06-06 当前实现状态：`session-record-store.ts` 已落地本地 `list/get/saveDraft/rename/delete/export/getAudioUrl` 持久化能力，并通过 preload 暴露同名 IPC 子集；`updateSegment`、`updateSummary` 仍随记录详情页编辑能力进入下一批实现。

### 窗口生命周期

主进程必须保证：

- `controlWindow`、`overlayWindow`、`subtitleStyleWindow` 销毁后从广播目标移除。
- `caption:event`、`audio:state`、`overlay:*` 广播前检查 `BrowserWindow.isDestroyed()` 和 `webContents.isDestroyed()`。
- 如果窗口被销毁，事件被丢弃并记录 debug，不再抛出 `Object has been destroyed`。
- Overlay 尺寸和样式状态不由每条字幕事件触发窗口 resize；字幕内容只在窗口内滚动或 transform。

## Renderer 职责

### 首页

首页最近记录从 `sessionRecords.list()` 读取，不再使用 `recentSessionRecords` mock。

列表展示：

- 会议名称
- 结束时间
- 时长
- 摘要状态
- 查看 / 删除

首页不展示 provider、WebSocket、原始日志。

### Finished 页面

停止同传后，Renderer 做两件事：

1. 立刻进入本次复盘草稿，可播放本次录音。
2. 调用 `sessionRecords.saveDraft()` 持久化，保存成功后显示“已保存”。

如果持久化失败：

- 不能丢本次草稿。
- 显示非阻断提示。
- 允许用户导出 Markdown/TXT。

### 记录详情页

记录详情页是一个独立窗口或独立页面，不是设置页。

布局：

```text
顶部栏：
返回  可编辑标题  自动保存状态              字号  导出

主体：
左侧：双语 transcript
右侧：摘要与元数据

底部：
音频播放器 / 当前时间 / 总时长
```

右侧摘要与元数据展示：

- 开始时间
- 结束时间
- 时长
- 段数
- 字数
- 摘要
- 关键词
- 诊断摘要：仅在异常时显示，例如“部分片段时间戳异常，点击跳转可能不准”

### 文本点击跳转

点击任一 segment：

```text
audio.currentTime = segment.startMs / 1000
activeSegmentId = segment.id
scrollToSegment(segment.id, "center")
```

约束：

- 如果 `segment.startMs/endMs` 异常或重叠，前端可以用上一段 `endMs` 推导 fallback start，但必须显示诊断标记。
- 点击跳转只改变音频时间和 active segment，不修改文本内容。

### 播放高亮和自然滚动

播放中：

- 每个 `timeupdate` 根据 `currentTimeMs` 找 active segment。
- 如果用户最近 2 秒内没有手动滚动，自动把 active segment 平滑滚到视口中下方。
- 如果用户手动滚动，进入 auto-scroll lock，并显示轻提示“跟随播放”按钮。
- 不使用 sticky header 覆盖第一条 transcript；header 必须在 scroll viewport 外部，避免红框中的顶部文本被遮挡。

### 重命名

标题采用 inline edit：

- 点击标题进入编辑。
- Enter 保存，Esc 取消。
- 失焦自动保存。
- 空标题禁止保存，恢复旧标题。

## 前后端接口边界

### 实时字幕事件仍保持轻量

实时事件不承担完整记录存储，只承载显示所需字段：

```ts
type CaptionEventBase = {
  session_id: string;
  segment_id: string;
  revision: number;
  timing: { start_ms: number; end_ms: number };
  published_at_ms?: number;
  metrics?: Record<string, number>;
};
```

### 会话记录 DTO 是复盘模型

会话记录 DTO 不复刻所有 realtime event。它只保存最终可读片段、必要的编辑状态、摘要和诊断摘要。

### 诊断信息单独保存

调试 payload 写入 `diagnostics.jsonl`，普通详情页只读聚合后的诊断摘要。

## P0 修复顺序

### P0.1 日志可观测性闭环

目标：能回答“句号后翻译不返回卡在哪里”。

改动：

- Agent 把 `translation_checkpoint_*` 提升到默认 info 日志。
- Desktop renderer/main 日志保留 `session_id/segment_id/rev/type/agentToRendererMs`。
- `echosync-log-summary` 支持 join 翻译请求与字幕发布。

验收：

- 任意一段 committed subtitle 可以在日志中找到 queued、started、first_token、finished、caption publish、renderer received。

### P0.2 停止不是错误

目标：用户停止播放后不显示 `RealtimeTranscriptionErrorDetail(...)`。

改动：

- Desktop `stop` 必须先标记 `stoppingSessionIds`，再发 `audio.end(reason="user_stop")`。
- Agent 对 `user_stop` 后的异常只记录 suppressed log。
- Renderer `shouldSurfaceRealtimeError()` 不只看 session id，还要识别 stop phase 和 known cancel/provider close patterns。

验收：

- 用户点击停止后进入 Finished/记录草稿，不出现错误字幕、不出现失败浮层。

### P0.3 时间戳契约

目标：复盘跳转和播放高亮可用。

改动：

- Agent assembler 修复 committed segment 多段共享 `start_ms`。
- 增加 timing anomaly 测试。
- Renderer 对历史记录加载时做 `normalizeRecordSegmentsTiming()`，仅作兜底，不替代后端修复。

验收：

- 真实日志里连续 `segment.commit` 不再长期共享同一个 startMs。
- 点击任一 transcript 段，音频跳转到合理位置。

### P0.4 会话记录持久化

目标：会话结束后记录可保存、重命名、回到首页。

改动：

- Main 新增 `session-record-store.ts`。
- Preload 暴露 `sessionRecords.*` IPC。
- Renderer 首页和会议记录窗口改为读取真实 records。
- Finished 保存当前 `SessionArchiveDraft` 为 `SessionRecord`。

验收：

- 重启应用后仍能看到上一场会议记录。
- 可重命名，首页同步更新。

### P0.5 复盘页交互

目标：复盘页像播放器时间线，而不是静态文本导出页。

改动：

- 记录详情页读取持久化记录。
- 播放时高亮 active segment。
- 用户未手动滚动时自然跟随；用户滚动后锁定跟随。
- 右侧摘要和元数据常驻。

验收：

- 播放音频时文本自然向下滚动聚焦当前段。
- 点击文本能跳转到对应时间段。

## 测试要求

### Agent

- `test_translation_checkpoint_logs_are_paired`
- `test_committed_flush_after_punctuation`
- `test_user_stop_suppresses_provider_error`
- `test_transcript_assembler_committed_timestamps_are_monotonic`
- `test_realtime_log_summary_detects_translation_gap`

### Desktop Main

- `session-record-store.test.ts`
- `window-ipc-destroyed-target.test.ts`
- `session-record-ipc.test.ts`

### Renderer

- `session-records.test.ts`
- `session-archive.test.ts`
- `record-review-playback.test.ts`
- `renderer-record-window-contract.test.ts`

### 真实场景验收

使用 30-60 秒真实视频或系统声音：

1. 开始同传，观察字幕持续输出。
2. 在句号后继续播放，确认下一句译文仍返回。
3. 停止播放，确认进入复盘，不显示错误文本。
4. 复盘页播放音频，文本自动高亮并自然滚动。
5. 点击任一段文本，音频跳到该段。
6. 重命名记录，关闭并重启应用，首页最近记录仍显示新名称。

## 与既有文档关系

- `home-launcher-engine-settings-design` 已定义“会议记录是独立产品面”。本文把该设计从信息架构推进到接口和持久化职责。
- `caption-display-buffer-design` 继续负责实时字幕视觉合成。本文只补复盘页和记录持久化，不改变实时打字机规则。
- `caption-chain-audit` 继续记录链路诊断和实测结论。本文把本轮日志发现转成可实现的 P0 修复顺序。
