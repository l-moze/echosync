# EchoSync MVP 架构

## 技术选型与原则映射

## 与 deep-research-report.md 的对齐情况

| 研究报告建议 | 当前框架实现 | 状态 | 说明 |
|---|---|---|---|
| 字幕优先级联管道 | `AudioFrame -> Transcriber -> Translator -> CorrectionEngine -> SubtitleSink` | 已对齐 | 字幕优先，TTS 只作为可选 `TtsSynthesizer` 边界。 |
| React 或 Next.js 工作台 | `apps/web` 使用 Next 15 + React | 已对齐 | 已在 `D:\code\echosync` NTFS 路径下验证 Next 15 构建。 |
| 浏览器采集麦克风、标签页、文件 | Desktop 已接 Windows 系统声 PCM 输入，Web 仍是模拟工作台 | 部分对齐 | 麦克风应走 `getUserMedia`，文件/混音仍是后续源适配器。 |
| WebSocket 到自有后端 | 当前可运行主线为 FastAPI WebSocket + Python Agent | 已对齐 | `8766` 同时提供 realtime 音频输入和 caption 字幕输出；LiveKit/WebRTC 保留为后续候选传输层。 |
| Python 实时编排服务 | `apps/agent` Python 包 | 已对齐 | 目前是 Agent 编排层，不把供应商 SDK 写进核心管道。 |
| 流式 ASR：faster-whisper 或 FunASR | `FunAsrTranscriber` 已接入本地 FunASR AutoModel，`MockTranscriber` 用于测试 | 已对齐 | 当前优先 `paraformer-zh-streaming`；faster-whisper 可新增适配器，不改管道。 |
| 快速云翻译器 | `DeepSeekTranslator` 使用兼容 OpenAI 的 API | 已对齐 | DeepSeek 符合补充文档的国内友好约束。 |
| LocalAgreement 稳定策略 | `TranscriptAssembler` 将 ASR delta 聚合为 `partial/stable/committed` 三态 | MVP 已对齐 | `partial` 用于实时吐字，`stable` 是约 1 秒翻译 checkpoint，`committed` 是最终锁定；后续可替换为更严格的 LocalAgreement。 |
| 修正窗口补丁 | `RevisionWindowCorrectionEngine` + `translation.patch` | 已对齐 | MVP 只做保守补丁，复杂上下文纠错放到后续迭代。 |
| 事件流，而不是整段重绘 | `EventSubtitleSink` 输出 `transcript.partial`、`translation.partial`、`translation.patch`、`segment.commit` | 已对齐 | 源文 hypothesis 与译文字幕分离；同一 `segment_id` 用 `rev` 覆盖更新，前端不整段刷屏。 |
| 先用内存会话状态，后续再接 Redis | `InMemoryEventBus` | 已对齐 | Redis Streams 放到阶段 4。 |
| 术语表是必需能力 | `Glossary` + `GlossaryEntry` + `MatchedTerm` 已实现；`CorrectionContext.glossary` + `glossary_constraints` 数据流贯通；流式窗口匹配 + overlap 去重 + XML prompt 注入 + `as_asr_phrases()` ASR bias 出口已完成 | 已对齐 | 术语表作为 session 级配置，会话启动时加载术语全集，每段只匹配命中术语，prompt 仅注入命中项。MVP 使用 `RegexGlossaryMatcher`（预编译正则），术语数超过 500 时可替换为 Aho-Corasick/FlashText。 |
| 可选 TTS / 原生语音翻译 | `EdgeTtsSynthesizer`、`TranslatedAudioSink`、`InterpretationEngine` 边界 | 已对齐 | 默认关闭，避免 MVP 首版增加延迟；端到端模型可直接输出译文音频块。 |

当前文档与研究报告的关系是：**产品/管道模型对齐，传输层当前落地为 Electron/Web Audio PCM + FastAPI WebSocket；LiveKit/WebRTC 来自补充文档的快速开发备选路线，保留在 `transport/` 边界中，不是当前已接通主链路。**

### 1. Next 15 Web 工作台

选型：`apps/web` 使用 Next 15 + React，后续接 `@livekit/components-react` 获取麦克风、标签页音频或文件音频。页面放在 `src/app`，避开旧 F 盘 exFAT 环境下根级 `app/` 目录的权限锁。

构建约束：Next 15 必须在 NTFS 路径下构建。本机 F/E 盘为 exFAT，会让 Node 的 `fs.readlink` 对普通文件返回异常的 `EISDIR`；`D:\code\echosync` 位于 NTFS，已验证 Next 15 构建通过。

原则落实：

- 关注点分离：浏览器只负责采集、状态展示、字幕补丁渲染，不承担 ASR/翻译推理。
- KISS：第一屏就是同传工作台，不做营销页或复杂导航。
- YAGNI：当前提供可交互工作台和模拟事件流，真实 Agent 接入优先服务 Desktop；LiveKit token 与房间管理后续按需接入。

### 1.5. Electron Windows 悬浮字幕端

选型：新增 `apps/desktop`，使用 Electron 作为桌面壳。主控窗口负责音频源选择、字幕事件调试和悬浮窗控制；悬浮字幕窗是独立 `BrowserWindow`，配置为透明、无边框、置顶、跳过任务栏，并使用毛玻璃字幕卡承载实时译文。

为什么不是只用 Web：实时字幕的核心使用场景是覆盖在直播、会议、网课、播放器或浏览器上方。普通网页区域无法稳定置顶到其他 Windows 应用之上，也无法直接获得系统级 loopback 音频。

原则落实：

- 关注点分离：`apps/desktop` 只负责窗口、桌面音频入口和 IPC，不承担 ASR、翻译、修正或 TTS 推理。
- 依赖倒置：桌面音频最后仍转换为 `AudioFrame`，Agent 管道只依赖 `AudioSource` 抽象，不依赖 Electron、WASAPI 或浏览器设备 API。
- KISS：首版桌面端只做主控窗口和悬浮字幕窗，不提前实现安装器、自动更新、托盘菜单和复杂热键。
- 开闭原则：Windows 系统声音当前声明为 `electron-display-media-loopback` 边界；后续可以替换为 WASAPI native addon、Python sidecar 或供应商 SDK，而不修改字幕 UI 和 Agent 推理管道。

桌面端核心结构：

```text
apps/desktop/
  src/main/             # Electron 主进程、窗口配置、IPC 注册
  src/preload/          # contextBridge 暴露最小桌面 API
  src/renderer/         # React 控制台和悬浮字幕窗
  src/shared/           # 音频源目录、字幕事件、字幕状态机
  tests/                # 窗口配置、音频源目录、字幕状态机测试
```

桌面端音频源边界：

| 音频源 | 当前边界 | 后续生产实现 | 原则 |
|---|---|---|---|
| 麦克风 | `browser-microphone` | Electron preload 调用浏览器 MediaStream 或 native addon | 接口隔离 |
| Windows 系统声音 | `electron-display-media-loopback` + renderer Web Audio PCM sender | AudioWorklet / WASAPI loopback native addon / Python sidecar | 依赖倒置 |
| 混音 | `native-wasapi-mixed` | 原生层混合麦克风与系统声音后输出 16k mono PCM | 单一职责 |
| 文件回放 | `file-decode` | ffmpeg / WebCodecs 解码后转 `AudioFrame` | 开闭原则 |

当前最小真实链路已经接通：

```text
Electron getDisplayMedia(loopback)
  -> Web Audio downmix/resample
  -> PCM16 binary audio frame
  -> Agent /v1/realtime/sessions/{session_id}
  -> build_demo_pipeline(Settings.from_env())
  -> Transcriber -> Translator -> CorrectionEngine
  -> CaptionEventHub
  -> /v1/caption/events
  -> Electron overlay caption-store
```

Agent 实时服务和字幕事件服务共用 `8766` 端口，输入和输出分成两个 WebSocket：桌面端向 `/v1/realtime/sessions/{session_id}` 发送 JSON 控制帧 `audio.start`、`audio.end`，音频正文使用 `pcm16.binary.v1` 二进制帧；主进程保持连接 `/v1/caption/events` 接收 `transcript.partial`、`translation.partial`、`translation.patch`、`segment.commit`。Agent 同时暴露 `/healthz` 和 `/v1/realtime/capabilities`，用于 Desktop 启动前确认默认 provider、缺失密钥和缺失依赖。`audio.start` 默认声明本次会话的 `asr_latency_mode`，只在用户显式选择 provider 时声明 `asr_provider` 或 `translation_provider` 覆盖后端 `.env` 默认值；API key、base URL 与模型密钥仍只来自后端环境变量。Agent 会在启动 pipeline 前校验本次音频源与 ASR provider，默认 `mock` 只接受 `network_stream` 演示输入；真实 PCM 音频必须走 `funasr` 或 `voxtral`。Python 后端兼容旧的 JSON `audio.chunk` / `pcm_base64`，但新桌面链路默认走二进制 PCM。后端每秒聚合打印音频帧数、音频时长、字节数、传输延迟和队列深度，字幕事件携带 `published_at_ms` 和模型指标，方便现场拆分采集、传输、ASR、翻译和 UI 接收延迟。

桌面 UI 生命周期：

```text
Idle -> Active -> Finished
```

`Idle` 负责视频/网课默认开箱、起飞前音频电平校验、ASR provider、ASR 延迟模式和翻译 provider 选择；开始同传前会读取 Agent capabilities 并阻止不可用组合。`Active` 负责转写监控、健康度、术语快加和自动滚动锁；`Finished` 负责复盘、导出前清理和沉淀。收到当前会话 `realtime.error` 时，renderer 会停止本地音频 client、通知主进程回收采集状态，并退回带错误详情的失败浮层。透明字幕窗按 Layer A/B/C 分层，默认穿透，Hover 唤醒轻控制，Pin 后展示最近 2-3 行和字幕状态；字幕样式支持双语、主字幕、翻译字幕三种显示模式，旧 `line/split` 值归一为双语模式。桌面端的状态模型放在 `apps/desktop/src/shared/session-ui-state.ts` 和 `apps/desktop/src/shared/overlay-interaction.ts`，后续 Web 工作台可以复用同一语义而不共享 Electron IPC。

### 1.6. 会话回放记录

选型：同传开始后，renderer 使用 `MediaRecorder` 对原始 `MediaStream` 进行连续录音；实时 ASR 仍走 `audio-gate -> PCM16 binary frame -> Agent`。两条链路共享输入但职责分离：录音保留静音、停顿和完整时间线，ASR 链路可以继续做门控和低延迟发送。

停止同传后，桌面端生成 `SessionArchiveDraft`：

```text
SessionArchiveDraft
  id / title / createdAt / durationMs
  audio.mimeType / audio.objectUrl
  segments[]: segmentId / startMs / endMs / sourceText / targetText / state / patchCount
```

当前 MVP 在本次进程内用 `Blob` object URL 回放原始音频，复盘页提供左右双栏原文/译文、片段时间帧、点击片段 seek、播放时按时间高亮对应片段。下一阶段再把归档落盘到 `app.getPath("userData")/sessions/{sessionId}/session.json + audio.webm`，并支持打开历史记录。

原则落实：

- 关注点分离：`session-recorder.ts` 只负责原始音频录制，`session-archive.ts` 只负责归档 DTO 和时间帧选择，`FinishedDashboard` 只负责回放 UI。
- 依赖倒置：归档模型只依赖 `CaptionLine` 领域数据，不依赖 Electron IPC 或具体 ASR 供应商。
- KISS/YAGNI：MVP 先做片段级高亮和本次会话回放，不引入波形裁剪、词级时间戳或云端同步。

### 2. WebSocket 作为当前实时音频通道，LiveKit 作为后续候选

选型：当前 MVP 用 FastAPI WebSocket 承载桌面端 PCM16 音频块和字幕事件，优先把 Windows 本地悬浮字幕链路跑实。LiveKit/WebRTC 保留为后续远程房间、多端会议、浏览器音轨和云端 Agent 场景的候选传输层。

控制事件语义：`realtime.error` 是终止态，表示启动校验失败或 pipeline 异常；`realtime.done` 只在正常结束时发送。用户主动停止时，Agent 会取消未完成的 pipeline；如果 pipeline 已经失败，则先把错误发给 realtime WebSocket 和 caption hub，避免客户端看到“失败后又完成”的矛盾状态。Desktop 主进程的 caption WebSocket 正常断线 5 秒重连，但应用退出时会清理重连计时器并主动关闭连接。

原则落实：

- 优先成熟库：本地服务使用 FastAPI 官方 WebSocket 能力；系统声音先用 Electron `desktopCapturer` / `getDisplayMedia` loopback，避免第一版手写 WASAPI。
- 低耦合：LiveKit 被限制在 `transport/` 适配层，核心管道不依赖 LiveKit SDK。
- 开闭原则：未来可增加 WebSocket、文件回放或原生实时供应商传输，不改 ASR/翻译模块。
- KISS：当前只需要本机 `audio.start + pcm16.binary.v1 -> AudioFrame -> caption event`，不先引入房间、token、信令和远程音轨复杂度。旧 JSON `audio.chunk` 仅作为兼容协议保留。

### 3. Python Agent 作为推理编排层

选型：`apps/agent` 使用 Python 3.11+，负责实时管道、会话状态、ASR/翻译/修正/TTS 适配器。Windows 本机 GPU 轮子示例使用 Python 3.12/cp312；如使用 Python 3.11，需要下载 cp311 对应的 `torch` / `torchaudio` wheel。

环境约束：Python Agent 必须使用项目内 `.venv`，并将 `PIP_CACHE_DIR`、`MODELSCOPE_CACHE` 指向项目内 `.cache/`。FunASR 依赖的 PyTorch CPU/GPU 轮子不能安装到全局 Python，详细步骤见 `doc/agent-env.md`。

原则落实：

- 单一职责：`pipeline/` 只做编排，`services/` 只做供应商适配，`domain/` 只定义 DTO。
- 依赖倒置：级联链路依赖 `Transcriber`、`Translator`、`CorrectionEngine`、`SubtitleSink` 抽象；端到端链路依赖 `InterpretationEngine` 抽象。
- 接口隔离：ASR、翻译、修正、字幕输出、TTS 是小接口，互不强迫对方实现无关方法。

### 4. FunASR / Voxtral / DeepSeek / edge-tts 作为 MVP 供应商方向

选型：

- ASR：当前 provider 支持 `mock`、`funasr`、`voxtral`。FunASR 本地 AutoModel 适配器在 `services/asr/funasr_transcriber.py`，会把 80ms 传输帧聚合成推理窗口：`low_latency` 约 320ms、`balanced` 默认 600ms、`accuracy` 约 900ms；Voxtral Realtime 云端适配器在 `services/asr/voxtral_transcriber.py`，并按 `asr_latency_mode` 映射目标等待：`low_latency` 最多 480ms、`balanced` 沿用 `VOXTRAL_TARGET_DELAY_MS`、`accuracy` 至少 1600ms。Deepgram/Azure 属于下一批低延迟/高稳定云端候选，尚未进入可选 provider。媒体文件抽音频由 `services/media/ffmpeg_audio_source.py` 完成，默认使用 ffmpeg stdout 流式读取并在线分帧，避免 MP4 复盘时等待完整文件解码。
- 翻译：当前 provider 支持 `mock`、`deepseek`。DeepSeek 兼容 OpenAI API 的适配器在 `services/translation/deepseek_translator.py`；Desktop 的“通用模型”不发送覆盖字段，沿用 Agent `.env`，显式选择 `DeepSeek-V3` 时只发送 `translation_provider=deepseek`。Desktop 会通过 capabilities 在启动前发现缺失的 `DEEPSEEK_API_KEY` 或 SDK。
- TTS：edge-tts 适配器在 `services/tts/edge_tts_synthesizer.py`，先作为可选输出。

原则落实：

- DRY：所有供应商统一转成内部 DTO，避免每层重复解析供应商格式。
- 里氏替换：`MockTranscriber` 与 `FunAsrTranscriber` 都实现同一个 `Transcriber` 语义。
- YAGNI：当前先用本地 AutoModel、Voxtral 备选和终端媒体样本验证 ASR 质量与延迟；FastAPI/WebSocket 会话服务已接入 Desktop 真实链路，后续重点是模型预热和延迟压测。

### 5. 级联模型与端到端模型共用统一引擎边界

选型：新增 `InterpretationEngine` 抽象。级联方案由 `CascadedInterpretationEngine` 组合 ASR、翻译和修正组件；端到端方案可以直接实现 `InterpretationEngine`，输出统一的 `TranslationSegment`、`SubtitlePatch`、`SegmentCommit` 或 `TranslatedAudioChunk`。

原则落实：

- 开闭原则：新增 OpenAI Realtime、Qwen LiveTranslate、Azure Speech Translation 等端到端供应商时，只新增一个引擎适配器。
- 接口隔离：字幕输出仍走 `SubtitleSink`，译文音频单独走 `TranslatedAudioSink`，不会强迫字幕链路处理音频。
- 依赖倒置：`EngineDrivenInterpretationPipeline` 依赖抽象引擎和抽象输出，不依赖任何具体模型 SDK。
- 里氏替换：级联引擎和端到端引擎都输出相同领域事件，可以被同一个输出管道消费。

### 6. 修正能力采用事件流 + 修正窗口

选型：核心事件包括 `transcript.partial`、`translation.partial`、`translation.patch`、`segment.commit`。修正引擎使用最近 1-2 个片段作为可修正窗口，MVP 只预留补丁生成策略。

原则落实：

- 观察者模式：`InMemoryEventBus` 让 UI、日志、测试都能订阅同一事件流。
- 事件溯源思想：字幕状态由事件追加而来，后续可持久化到 Redis Streams。
- KISS/YAGNI：先实现保守 revision patch，不在初始化阶段接复杂 LLM 纠错链。

### 6.5. 实时字幕 hypothesis 与流式翻译策略

选型：实时字幕采用行业常见的 interim hypothesis 模型，而不是等完整句子稳定后再显示。ASR 适配器持续输出 delta，`TranscriptAssembler` 负责把 delta 聚合成同一个活动片段：

- `partial`：每个 ASR delta 都会更新当前源文，用于英文/原文打字机效果；默认不触发翻译请求，避免把不稳定尾巴送进 DeepSeek。
- `stable`：默认约 1 秒形成一次 checkpoint，触发一次流式翻译；前端用同一个 `segment_id` 和递增 `rev` 替换尾部文字。
- `committed`：遇到标点、供应商 final 或音频流结束时锁定片段，输出最终译文并发布 `segment.commit`。

翻译器以 `translate()` 一次性接口作为最小契约，适合 DeepL、传统机器翻译 API、录播视频回放等可接受时间差的场景。支持实时 token 的供应商再额外实现 `StreamingTranslator.stream_translate()`；DeepSeek 使用 OpenAI-compatible `stream=True`，收到 token delta 后累计成当前译文并持续发布 `translation.partial`。如果供应商暂时不支持流式，级联引擎会回退到一次性 `translate()`，不影响管道契约。

级联引擎会优先发布 `transcript.partial` 源文 hypothesis，翻译在后台只处理 stable/committed checkpoint；如果同一活动片段已经排入更高 `rev`，旧 checkpoint 会被跳过，避免慢翻译把前文回滚或浪费 API。低延迟实验可以显式打开 `translate_partial_checkpoints=True`，但默认链路遵循“DeepSeek 只吃稳定文本”的同传策略。

前端约定：`transcript.partial` 只更新源文草稿，不清空已有译文；`translation.partial` 更新目标译文。为了兼容旧事件，当前空 `translation.partial.target_text` 仍按源文草稿处理。悬浮字幕优先显示最新有译文的行，避免慢翻译或 batch 翻译模式下被空译文草稿抢焦点。

当可以直接访问录播视频、课程文件或完整音轨时，可以使用批量翻译模式：ASR 仍按时间戳切片，翻译器使用 `translate()` 或批量 API 在 1-3 个片段的缓冲窗口后输出译文，前端通过时间帧延迟显示。这个模式牺牲少量实时性，换取 DeepL 等专用翻译 API 的稳定质量和更低字幕抖动。

### 6.6. 实时热路径算法与数据结构优化

当前链路的瓶颈主要来自流式音频、增量文本和多模型排队，不适合优先上 DFS 或背包。已落地的优化方向如下：

- 音频门控：`audio-gate.ts` 使用分片队列读取固定长度 chunk，避免每次 `push()` 都把残留 buffer 与新样本整体拼接，也避免每次切片后复制剩余样本。该优化把热路径从“重复搬运余量样本”收敛为“只复制输出 chunk 一次”，降低 renderer GC 和音频抖动。
- SemanticChunker：`services/asr/semantic_chunker.py` 提供完整的 soft cut、hard cut、overlap 语义块实现，供后续 batch ASR 或非流式模型复用。FunASR 这类流式 provider 不等待完整语义块，而是使用 `SemanticEndpointTracker` 标记 soft/hard endpoint，保持 320/600/900ms 推理窗口不被阻塞。`SemanticEndpointTracker` 已支持可插拔 `FrameVadDetector`，连续静音达到阈值时可直接触发 soft endpoint；未配置 detector 时继续兼容上游 `is_final`。
- FunASR endpoint：FunASR 适配器遇到上游 `is_final=true` 会把当前窗口作为 endpoint final 推理，并在之后重置 provider cache，避免上一句上下文污染下一句。连续语音超过 hard timeout 时，endpoint tracker 会强制把当前帧标记为 final，触发 cache reset。每次 ASR 推理都会输出 `funasr_inference_chunk` 日志，包含 `input_audio_ms`、`transport_frames`、`final`、`semantic_boundary`、`latency_ms` 和 `rtf`；soft/hard/stream end 还会输出 `funasr_semantic_boundary`。
- ASR 分段：`TranscriptAssembler` 维护 `current_text` 增量文本，不再每个 ASR delta 都 `join(buffer)`。输出契约仍保持 `partial/stable/committed` 三态，避免改变字幕 UI 和翻译器边界。
- 翻译排队：`CascadedInterpretationEngine` 对待翻译 checkpoint 按 `segment_id` 去重，同一活动片段在队列中只保留最新 `rev`。默认跳过 partial 翻译，并输出 `translation_checkpoint_skipped reason=partial_disabled`，让日志能证明 DeepSeek 请求没有被不稳定文本放大。
- 译文显示合帧：DeepSeek 等流式翻译模型可能按中文单字 token 返回。后端 `DeepSeekTranslator` 会按最小可见字符数和标点合并 token 后再发布，前端只即时展示 Agent 已发布的事件文本，不再二次语义切块。最终 `committed` 事件仍完整覆盖字幕。
- 术语匹配：小词表继续使用预编译 Regex，大词表使用 Aho-Corasick 多模式匹配。后续若 ASR 错词导致术语漏匹配，应先做 normalized text + offset map，再对高优先级术语做轻量近似匹配，避免全量编辑距离扫描。

暂不采用的算法：

- DFS：当前没有树/图搜索场景。
- 背包：只有后续做“有限 token 预算下选择历史上下文、术语和修正片段”时才值得引入。
- 重型语义断句模型：MVP 先用时间、长度、标点和音频 final 信号做流式断句，避免额外模型延迟。

### 7. 中文文档与备注规范

选型：Markdown 文档、代码注释、Python docstring、配置样例说明统一使用中文；技术标识、包名、类名、事件名、配置键名保留英文，避免破坏工程可读性和 API 约定。

原则落实：

- 清晰性：业务意图和架构说明面向中文团队直接可读。
- 低耦合：语言规范不改变接口、DTO、事件名和供应商 SDK 约定。
- KISS：只约束说明性文本，不强行翻译技术标识。

## 项目目录结构

```text
echosync/
  apps/
    desktop/
      package.json
      src/main/            # Electron 主进程、窗口配置和 IPC
      src/preload/         # 最小桌面 API 暴露
      src/renderer/        # 主控窗口和悬浮字幕窗 UI
      src/shared/          # 音频源目录、字幕事件、字幕状态机
      tests/               # 桌面端契约测试
    agent/
      pyproject.toml
      src/echosync_agent/
        domain/              # AudioFrame、TranscriptSegment、TranslationSegment、TranslatedAudioChunk 等 DTO
        interfaces/          # Transcriber、Translator、InterpretationEngine、SubtitleSink 等抽象
        pipeline/            # 级联兼容门面和统一引擎管道
        runtime/             # Settings、依赖组装、内存事件总线
        services/
          asr/               # MockTranscriber、FunASR 适配器
          media/             # ffmpeg 媒体解码和 AudioFrame 切片
          translation/       # MockTranslator、DeepSeek 适配器
          correction/        # 修正窗口
          engine/            # 级联引擎和未来端到端引擎适配器
          subtitle/          # 事件字幕输出
          tts/               # edge-tts 适配器
        transport/           # LiveKit 桥接占位
      tests/
    web/
      src/app/               # Next 15 App Router 工作台页面
      src/lib/protocol.ts    # 前端字幕事件协议
      src/lib/demo-session.ts # 工作台模拟事件流
  doc/
    deep-research-report.md
    补充文档.md
    architecture-mvp.md
```

## 核心管道

```text
AudioFrame 流
  -> Transcriber.stream()
  -> TranscriptAssembler.stream()
  -> transcript.partial 源文 hypothesis 事件
  -> stable/committed checkpoint
  -> Translator.stream_translate() 或 Translator.translate()
  -> CorrectionEngine.revise()
  -> SubtitleSink.publish_translation / publish_patch / publish_commit
  -> EventBus 观察者
```

这个结构把“音频流接入、流式 ASR、翻译引擎、字幕/TTS 输出、错误修正引擎”垂直切开。新增 ASR 供应商时，只新增一个 `Transcriber` 实现；新增修正策略时，只新增一个 `CorrectionEngine` 实现。

端到端模型走同一个输出契约：

```text
AudioFrame 流
  -> InterpretationEngine.stream()
  -> TranslationSegment / SubtitlePatch / SegmentCommit / TranslatedAudioChunk
  -> SubtitleSink 或 TranslatedAudioSink
```

这个结构避免把端到端模型伪装成 ASR 或翻译器。端到端模型负责直接产出标准领域事件，输出层继续保持稳定。

## MVP 路线图

### 阶段 0：初始化完成

- 建立 monorepo。
- 建立 Python Agent 抽象接口、DTO、管道和模拟链路。
- 建立 Next 15 字幕工作台骨架，并实现三栏、剧场、阅读、紧凑悬浮四种模式。
- 建立事件协议和修正窗口接口。

### 阶段 1：音频通道

- 桌面端已接入 Electron 主控窗口和悬浮字幕窗，完成音频源选择 IPC 和字幕事件接收。
- Windows 系统声音已用 Electron display media loopback + Web Audio PCM sender 接入 Agent `8766` 实时链路；音频传输已从 base64 JSON chunk 改为 JSON control + binary PCM frame。稳定版本再替换为 AudioWorklet 或 WASAPI loopback 原生适配器。
- 麦克风源已改走 `getUserMedia({ audio: true })`，不再复用系统声的 `getDisplayMedia` 分支。
- renderer 已加轻量音频门控：响度超过阈值后发送约 80ms PCM binary frame，连续静音后给上一块活跃音频标记 `is_final=true`。FunASR 适配器内部按 `FUNASR_CHUNK_MS` 聚合小传输帧，避免把 80ms 网络帧直接等同于模型推理窗。后续如果 ASR 对静音停发敏感，可按调研文档改为持续发送 silence frame 或 keepalive。
- Agent 文件源已支持 ffmpeg 流式分帧；Desktop 文件回放和混音入口未形成完整产品链路前应标记为实验入口，避免 UI 误导。
- LiveKit token、LiveKit Room 和 `LiveKitAgentBridge` 作为后续远程传输适配任务，不阻塞当前 Windows 本地 MVP。

### 阶段 2：MVP AI 链路

- 接入 FunASR `paraformer-zh-streaming` 本地 AutoModel。
- 使用 `echosync-asr-demo` 或 `python -m echosync_agent.asr_demo` 对视频/音频样本做终端转写和延迟测试。
- FastAPI/WebSocket 只作为前端和桌面端接入实时会话的传输层，不把模型逻辑移到 Node 或前端；`/v1/realtime/sessions/{session_id}` 已经复用完整 ASR -> 翻译 -> 字幕管道。
- 接入 DeepSeek 翻译器，并开启兼容 OpenAI API 的流式翻译。
- 使用 `transcript.partial` 驱动源文 hypothesis，使用 `translation.partial` 驱动译文字幕，使用 `segment.commit` 锁定最终字幕。
- 为 DeepL 等非流式翻译器保留 batch-only 路线：只实现 `Translator.translate()`，由级联引擎自动回退，并允许录播/可访问视频场景打时间差。
- 保持 edge-tts 关闭，避免 TTS 增加首版延迟。
- 默认 `mock` 只用于事件演示；真实 PCM 音频测试必须使用 `funasr` 或 `voxtral`。会话级 `audio.start.asr_provider` 和 `audio.start.translation_provider` 可以覆盖 `.env` 默认 provider，但密钥配置仍由服务端 `.env` 控制。
- `realtime.error` 与 `realtime.done` 保持互斥：启动失败、provider 不匹配或 pipeline 异常只发 error；正常 `audio.end` 才发 done。
- `TranscriptAssembler` 当前按标点、最大约 3.8 秒音频窗口或约 90 字符强制提交，避免中文无标点识别结果长期堆成一个字幕块。

### 阶段 3：端到端模型预留

- 为 OpenAI Realtime、Qwen LiveTranslate、Azure Speech Translation 等供应商新增 `InterpretationEngine` 适配器。
- 如果模型输出译文语音，则通过 `TranslatedAudioSink` 推送到 LiveKit 音轨或前端播放器。
- 仍然把字幕、补丁、提交事件归一到现有前端协议。

### 阶段 4：修正与术语

- 术语表注入和命中统计：已完成。`Glossary` 加载时预编译正则，每段用流式窗口（最近 committed 段 + 当前段）匹配命中术语，prompt 仅注入命中项；廉价 telemetry 记录术语命中/缺失，不阻塞主路径。
- `CorrectionContext` 新增 `glossary_constraints` 字段，承载 `required`/`preferred` 约束级别，贯通到 LLM prompt。
- 保留 `Glossary.as_asr_phrases()` 出口，未来可接 FunASR/Voxtral/Azure/Google phrase list。
- 将最近 1-2 个片段进行小窗口重翻译。
- 输出 `translation.patch`，前端只更新变化字符，减少闪烁。

### 阶段 5：可选能力

- edge-tts 或云 TTS 语音输出。
- 录播课程高准确模式。
- Redis Streams 会话事件持久化。
- 离线评估：WER/CER、COMET/SacreBLEU、首字幕延迟、补丁率。
