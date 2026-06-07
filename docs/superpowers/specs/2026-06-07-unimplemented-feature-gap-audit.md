# EchoSync 文档功能缺口审计

## 背景

本审计对齐 `docs/superpowers/`、`docs/caption-chain-audit.md`、当前 Desktop 前端面板和 Python Agent 后端实现。目标不是重新设计，而是把“文档写了、前端有入口、后端还没闭环”的功能明确下来，后续按优先级实现。

审计口径：

- **Python Agent 后端**：`apps/agent/src/echosync_agent`，负责实时 ASR、翻译、TTS、capabilities、diagnostics 和 WebSocket/HTTP 服务。
- **Electron main 本地后端**：`apps/desktop/src/main`，负责本机文件、IPC、窗口和会话记录持久化。
- **Renderer 前端**：`apps/desktop/src/renderer` 与 `apps/desktop/src/shared`，负责面板、状态、回放和显示。

需要特别区分：会议记录/摘要并非完全空。当前 Electron main 已经实现本地记录存储和 OpenAI-compatible/DeepSeek 摘要生成；但 Python Agent 仍没有会议纪要/记录 API，片段编辑、诊断落盘、术语同步和隐私设置也没有形成完整闭环。

## 已实现或基本闭环

### 会话记录持久化

实现位置：

- `apps/desktop/src/main/session-record-store.ts`
- `apps/desktop/src/main/main.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/shared/desktop-api.ts`
- `apps/desktop/src/renderer/main.tsx`

当前能力：

- `sessionRecords.list/get/saveDraft/updateSummary/rename/delete/export/getAudioData/getAudioUrl`
- 按 `{userData}/echosync-data/sessions/{sessionId}/session.json` 保存记录。
- 保存音频文件并支持详情页读取音频数据或 file URL。
- 首页和会议记录窗口已经使用真实 `sessionRecords.list()`，不是纯 mock。
- 详情页支持查看、删除、重命名、导出 TXT/SRT/Markdown、播放音频、点击片段 seek、高亮当前片段。

缺口：

- 没有 `updateSegment`。
- 没有片段内联编辑和自动保存。
- 没有 `diagnostics.jsonl`。

### 会议摘要生成

实现位置：

- `apps/desktop/src/main/session-summary-generator.ts`
- `apps/desktop/src/main/session-summary-runner.ts`
- `apps/desktop/src/main/main.ts`

当前能力：

- 保存会议记录后后台调用摘要生成器。
- 支持 `ECHOSYNC_SESSION_SUMMARY_API_KEY` / `DEEPSEEK_API_KEY` 等环境变量。
- 输出摘要、关键词、行动项、主题、风险和术语建议。
- Renderer 详情页右侧已展示这些字段，并支持手动重新生成。

缺口：

- 这是 Electron main 本地后端能力，不是 Python Agent API。
- 没有 Agent 侧 `/v1/session-summary`、`/v1/minutes` 或类似接口。
- 摘要输入只来自最终记录片段；还没有和 Agent diagnostics、术语命中、翻译缺口等后端诊断自动合并。

### 实时字幕状态协议与基础遥测

实现位置：

- `apps/agent/src/echosync_agent/domain/events.py`
- `apps/agent/src/echosync_agent/services/subtitle/caption_update.py`
- `apps/agent/src/echosync_agent/services/engine/cascaded_engine.py`
- `apps/desktop/src/shared/realtime-events.ts`
- `apps/desktop/src/shared/realtime-telemetry.ts`

当前能力：

- `TranscriptSegment`、`TranslationSegment`、`SegmentCommit` 已带 `metrics`。
- `caption_update` 已带 source/target full/stable/unstable text 和可选 metrics。
- Agent 已有 `translation_checkpoint_queued/started/first_token/finished/skipped/dropped` 日志。
- Desktop telemetry 可读取 caption event 的基本 metrics。
- `caption_event_published` 已展开 DeepSeek cache/stream 与 glossary 指标，`realtime_log_summary` 已汇总这些字段的分布和 required/missing/repaired 总量。

缺口：

- `realtime_log_summary` 仍主要做计数和分布统计，没有真正 join `translation_checkpoint_*` 与 `caption_event_published`。
- 没有检测 started/finished 不配对、finished 后无 caption publish、commit 时间戳重叠。
- Desktop 没有把这些诊断自动写入某场会话的 `diagnostics.jsonl`。

### DeepSeek 实时翻译优化

实现位置：

- `apps/agent/src/echosync_agent/services/translation/deepseek_translator.py`
- `apps/agent/tests/test_deepseek_translator_contracts.py`
- `docs/superpowers/plans/2026-06-06-deepseek-realtime-prefix-optimization.md`

当前能力：

- 复用 OpenAI-compatible client。
- 关闭 thinking。
- 请求 stream usage，并记录 cache hit/miss tokens。
- 对 append-only current segment revision 使用 DeepSeek beta prefix completion。
- 对 source rewrite 回退到普通 `/v1` streaming。
- 2026-06-07 已收紧翻译 prompt，避免把字幕翻译压缩成摘要，尤其避免遗漏 tasks/methods/datasets/demonstrations/models 等末尾语义。
- 2026-06-07 已把当前段历史修订纳入修订 patch 比较，修复“当前段还未 committed 时无法产生 translation.patch”的问题。
- 2026-06-07 已把术语匹配调整为当前段优先，再用最近 committed prefix 补足，避免历史术语挤掉当前段术语。
- 2026-06-07 已增加 required glossary 的本地 source-copy repair：模型把 `LiveKit` 这类源术语原样带入中文译文时，后端直接替换为指定译名，不增加 LLM 请求。
- 2026-06-07 已增加修订慢路径超时保护：默认 `correction_timeout_ms=120`，超时只记录 `translation_revision_timeout`，不阻塞 commit。

缺口：

- prefix completion 仍是保守策略，不是“长连接状态会话”。DeepSeek Chat Completion 对 EchoSync 仍是无状态请求，provider-side context cache 只能靠稳定 prompt 提升命中率。
- DeepSeek cache/stream 与 glossary metrics 已贯穿到 `caption_update`、`caption_event_published` 和 `realtime_log_summary`；但尚未自动落盘到每场会话的 `diagnostics.jsonl`。
- required glossary 如果不是源词原样复制，而是被语义漏译或错译，当前只通过 `glossary_missing_required_terms` 记录，不会为了修复它在实时热路径追加第二次 LLM 请求。
- 完整 LLM structured revision manager 仍未落地；当前修订是本地 diff/patch 慢路径，已加超时保护。

### ASR provider 基础接入

实现位置：

- `apps/agent/src/echosync_agent/services/asr/funasr_transcriber.py`
- `apps/agent/src/echosync_agent/services/asr/voxtral_transcriber.py`
- `apps/agent/src/echosync_agent/services/asr/deepgram_transcriber.py`
- `apps/agent/src/echosync_agent/runtime/capabilities.py`
- `apps/agent/src/echosync_agent/runtime/settings.py`

当前能力：

- 支持 `mock/funasr/voxtral/deepgram`。
- Desktop 可按会话发送 ASR provider 与 latency mode。
- Agent 在 `audio.start` 后应用会话级 overrides。
- FunASR 已把小传输帧聚合为更合理的推理窗口。
- capabilities preflight 已把缺依赖、缺 key、mock 不能处理真实音频等情况暴露给前端。

缺口：

- Azure ASR 仍未接入。
- FunASR 默认仍是 `paraformer-zh-streaming`，更适合中文流式识别；英语源场景不应继续默认走这个模型。
- 没有 `FUNASR_PROFILE=sensevoice` 或 SenseVoice adapter。
- capabilities/preflight 没有对 `source_lang=en + paraformer-zh-streaming` 给出强提示或阻断。

## 文档有但实现缺口明显

### P0：片段编辑与自动保存

文档来源：

- `2026-06-06-session-record-review-translation-reliability-design.md`
- `2026-06-06-home-launcher-engine-settings-design.md`

文档要求：

- `sessionRecords.updateSegment(id, segment): Promise<SessionRecord>`
- `SessionRecordSegment.sourceEditedText/targetEditedText/revisionState`
- 记录详情页文本可编辑，修改后自动保存。

当前实现：

- 数据模型已有 `sourceEditedText`、`targetEditedText`、`revisionState`。
- Renderer 详情页只显示 `selectedRecordSegmentSourceText()` 和 `selectedRecordSegmentTargetText()`。
- `SessionRecordStore`、`DesktopApi`、preload、main IPC 均没有 `updateSegment`。

后端缺口：

- Electron main 增加 `updateSegment`，校验 segment id、保存 edited text、更新 metadata 和 `updatedAt`。
- preload/DesktopApi 暴露 IPC。
- Renderer 增加内联编辑、debounced autosave、失败恢复。

建议优先级：P0。它直接影响“会议记录不是只能看，能校对复盘”的产品闭环。

### P0：每会话诊断 JSONL 与诊断摘要

文档来源：

- `2026-06-06-session-record-review-translation-reliability-design.md`
- `docs/caption-chain-audit.md`

文档要求：

```text
{userData}/echosync-data/sessions/{sessionId}/diagnostics.jsonl
```

当前实现：

- `session-record-store.ts` 只保存 `session.json` 和 audio 文件。
- `SessionRecord.diagnostics` 只有聚合 flag：`hasTimingAnomaly`、`hasTranslationGap`、`logPath`。
- Agent 有 `realtime_log_summary.py`，但它不是 per-session 自动落盘链路。

后端缺口：

- Electron main 需要按 session 记录原始或压缩后的 caption diagnostics JSONL。
- Agent/desktop 日志需要可通过 `session_id + segment_id + rev` join。
- 保存记录时将 diagnostics 聚合结果写入 `SessionRecord.diagnostics`。
- 导出诊断报告入口要读取这份 JSONL，而不是只展示静态文案。

建议优先级：P0。没有这项，就无法稳定回答“翻译没返回卡在哪一段”。

### P0：`echosync-log-summary` join 检测

文档来源：

- `2026-06-06-session-record-review-translation-reliability-design.md`
- `2026-06-06-realtime-telemetry-chain-design.md`

文档要求：

- started/finished 不配对。
- finished 后没有 caption publish。
- commit timestamp overlap。
- join Agent `translation_checkpoint_*` 与 Desktop forwarded/received events。

当前实现：

- `realtime_log_summary.py` 统计 started/finished/skipped/dropped、latency 分布和 caption event 类型计数。
- 还没有以 `session_id + segment_id + rev` 为 key 的请求级 join。

后端缺口：

- 增加 checkpoint index。
- 增加 caption publish index。
- 输出 orphan started、orphan finished、finished_without_caption、commit_overlap。
- 测试补 `test_realtime_log_summary_detects_translation_gap`。

建议优先级：P0。它是诊断 JSONL 和翻译可靠性工作的工具基础。

### P0：FunASR 英文场景模型选择

文档来源：

- `2026-06-06-session-asr-switching-funasr-optimization.md`
- `2026-06-06-agent-capabilities-preflight-design.md`
- 用户提供的 FunASR model-selection 调研方向。

当前实现：

- `FUNASR_MODEL` 默认 `paraformer-zh-streaming`。
- `FunAsrConfig.source_lang` 默认 `zh`。
- 当前 adapter 按 Paraformer streaming cache 方式实现。

问题：

- `source_lang=en` 时继续使用中文 Paraformer streaming，识别质量和时间戳都可能不可靠。

后端缺口：

- 增加 FunASR profile 概念，例如 `FUNASR_PROFILE=paraformer_zh_streaming|sensevoice`.
- 增加 SenseVoice adapter 或 profile-specific recognize path。
- capabilities 对语言/模型不匹配给出 warning/block。
- Desktop preflight 在真实音频 English source + FunASR 中文模型时提示切换 Deepgram/Voxtral/SenseVoice。

建议优先级：P0。它会直接影响真实场景英文视频/会议的 ASR 质量。

## 前端面板已有但后端未闭环

### P1：术语快加同步

文档来源：

- `2026-06-05-ui-home-overlay-requirements-design.md`
- `docs/caption-chain-audit.md`

文档要求：

- Active 面板支持 `source -> target` 术语快加。
- 状态经历注入中、已生效、失败/重试。
- 新术语通常从后续片段开始影响翻译。
- Agent 管道注入术语。

当前实现：

- Renderer `TermQuickAdd` 只 dispatch 本地 `term.add.requested`。
- 700ms 后用 `setTimeout` 模拟 `term.add.synced`。
- Agent 术语表从 CSV 加载，运行时由 `Glossary.match_terms()` 注入翻译 prompt。

后端缺口：

- Electron main 或 Agent 增加 glossary CRUD API。
- 写入 `apps/agent/terms/*.csv` 或用户数据目录的 glossary store。
- 运行中的 pipeline 支持 live reload 或 session-level glossary override。
- Renderer TermQuickAdd 通过 IPC/API 真实同步，而不是本地 timer。

建议优先级：P1。当前 UI 给了“已生效”的感觉，但实际没有影响后端翻译。

### P1：记录与隐私设置

文档来源：

- `2026-06-06-home-launcher-engine-settings-design.md`

文档要求：

- 是否保存原始音频。
- 是否保存双语记录。
- 自动清理周期。

当前实现：

- Renderer 偏好设置已有“记录与隐私”分区。
- 目前只是静态行：`保存原始音频=本次会话后询问`、`保存双语记录=开启`、`自动清理=关闭`。
- `saveDraft()` 总是按传入 audio 保存，缺少用户偏好控制。

后端缺口：

- Electron main 增加本地 preferences store。
- `SessionRecordStore.saveDraft()` 按设置决定是否保存 audio/record。
- 自动清理 scheduler 或启动时 cleanup。
- Renderer 设置项需要可修改并持久化。

建议优先级：P1。涉及用户隐私，不能长期停留在文案。

### P1：性能诊断导出

文档来源：

- `2026-06-06-home-launcher-engine-settings-design.md`
- `2026-06-06-session-record-review-translation-reliability-design.md`

文档要求：

- 高级 / 性能诊断能查看延迟统计、导出诊断报告、开启详细日志。
- 会议记录详情默认折叠诊断信息。

当前实现：

- 高级设置里有“性能诊断：按需导出诊断报告”的展示。
- 记录详情里有折叠的诊断摘要。
- 没有导出诊断报告 IPC。
- 没有详细日志开关。

后端缺口：

- 依赖 P0 diagnostics JSONL。
- 增加 `diagnostics.export(recordId/sessionId)` IPC。
- 增加 detailed logging preference，并作用到 Agent/Desktop 日志级别或采集范围。

建议优先级：P1。

### P1：文件回放与混音入口

文档来源：

- `2026-06-06-agent-capabilities-preflight-design.md`
- `docs/caption-chain-audit.md`
- `2026-06-05-ui-home-overlay-requirements-design.md`

当前实现：

- `DESKTOP_AUDIO_SOURCES` 包含 `mixed` 和 `file`。
- `validateRealtimePreflight()` 直接阻止：混音和文件回放入口尚未完整接入。
- Agent 侧已有 ffmpeg 文件音频源能力，但 Desktop 没有完整文件选择/解码/推流产品链路。

后端缺口：

- 文件回放：Desktop 文件选择、读取/解码、送 Agent realtime 或调用 Agent media source。
- 混音：Windows WASAPI/native mixer 或明确后端采集适配。
- preflight 从硬阻断改为能力驱动。

建议优先级：P1/P2。若当前重点是真实视频/会议，先做文件回放可用于稳定测试；混音可后置。

## 仍处于后续阶段的能力

### AudioWorklet 迁移

文档来源：

- `docs/caption-chain-audit.md`
- `2026-06-06-realtime-telemetry-chain-design.md`

当前实现：

- `apps/desktop/src/renderer/realtime-audio-client.ts` 仍使用 `createScriptProcessor()`。

缺口：

- `AudioWorkletProcessor`。
- off-main-thread downmix/resample/PCM16 编码。
- 迁移后的 jitter 指标对比。

建议优先级：P2。当前不一定是最大固定延迟，但会影响 p95/p99。

### LocalAgreement 与完整 LLM revision manager

文档来源：

- `2026-06-06-realtime-translation-streaming-design.md`
- `2026-06-06-realtime-local-agreement-phase2.md`

当前实现：

- 已有 stable/unstable text region 和 translation scheduling。
- LocalAgreement buffer 与完整 LLM structured patch manager 仍是后续阶段。

建议优先级：P2。先把 ASR 模型匹配、诊断和记录编辑补齐。

### Agent 侧会议纪要 API

当前实现：

- Electron main 已有本地摘要生成。
- Python Agent 没有 records/minutes/summary endpoint。

是否必须实现取决于后端 ownership：

- 如果“后端”定义为 Electron main 本地后端：摘要已部分实现，下一步是和记录编辑/诊断/隐私闭环。
- 如果“后端”定义为 Python Agent：会议纪要 API 仍未实现，需要新增 service 和 HTTP endpoint。

建议：

- 短期不要把摘要逻辑搬到 Agent，先补 Electron main 的记录闭环。
- 如果未来要支持 Web、多设备或服务端部署，再把摘要抽象为 Agent/Server API。

## 推荐实施顺序

### 第一批：记录复盘闭环

1. `sessionRecords.updateSegment`：Electron main/preload/DesktopApi/Renderer autosave。
2. `diagnostics.jsonl`：按 session 落盘 caption/translation diagnostic events。
3. `realtime_log_summary` join：检测翻译缺口和时间轴重叠。

理由：这三项直接覆盖“会议记录详情面板已经有，但后端没有完整能力”的核心问题。

### 第二批：真实翻译质量闭环

1. FunASR SenseVoice profile 或 source language preflight。
2. TermQuickAdd 真实同步到 glossary，并进入运行中 pipeline。
3. 每会话 diagnostics JSONL 自动落盘，并包含 DeepSeek cache/translation/glossary metrics。
4. 基于 diagnostics 汇总 `glossary_missing_required_terms`，把不能安全本地修复的术语问题送入会后复盘或慢速修订，不进入实时首 token 路径。

理由：用户现在反馈的主要痛点是英文真实场景的识别/翻译质量，而不是再添加 UI。

### 第三批：产品化入口

1. 记录与隐私设置持久化和自动清理。
2. 性能诊断导出。
3. 文件回放入口。
4. AudioWorklet 迁移。

理由：这些能提升产品完整度，但依赖前两批的记录和诊断基础。

## 当前不应误判的事项

- 会议摘要不是空实现：Electron main 已经有摘要生成器。
- Deepgram 和 DeepL 不是完全未实现：Agent 已有 provider 和 capabilities。
- Telemetry metrics passthrough 不是完全未实现：`SegmentCommit.metrics`、`caption_update.metrics`、DeepSeek/glossary 发布日志和 `realtime_log_summary` 汇总已存在。
- 文件回放不是 Agent 完全没有：Agent 侧媒体源能力存在，Desktop 产品链路未接通。
- 术语表不是翻译 prompt 完全没有：Agent 可从 CSV 加载并匹配术语；缺的是前端快加到后端的 live sync。
