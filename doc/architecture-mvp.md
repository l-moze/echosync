# EchoSync MVP 架构

## 技术选型与原则映射

## 与 deep-research-report.md 的对齐情况

| 研究报告建议 | 当前框架实现 | 状态 | 说明 |
|---|---|---|---|
| 字幕优先级联管道 | `AudioFrame -> Transcriber -> Translator -> CorrectionEngine -> SubtitleSink` | 已对齐 | 字幕优先，TTS 只作为可选 `TtsSynthesizer` 边界。 |
| React 或 Next.js 工作台 | `apps/web` 使用 Next 15 + React | 已对齐 | 已在 `D:\code\echosync` NTFS 路径下验证 Next 15 构建。 |
| 浏览器采集麦克风、标签页、文件 | UI 已保留 `mic/tab/file` 模式入口 | 部分对齐 | 真实 Web Audio/LiveKit 采集在阶段 1 接入。 |
| WebSocket 到自有后端 | 当前选择 LiveKit/WebRTC + Python Agent | 有意偏离 | 研究报告给 WebSocket/FastAPI 作为默认可控路径；补充文档要求 3 天 MVP 国内友好，优先 LiveKit 降低音频传输复杂度。后续可补 FastAPI 控制面。 |
| Python 实时编排服务 | `apps/agent` Python 包 | 已对齐 | 目前是 Agent 编排层，不把供应商 SDK 写进核心管道。 |
| 流式 ASR：faster-whisper 或 FunASR | `FunAsrTranscriber` 已接入本地 FunASR AutoModel，`MockTranscriber` 用于测试 | 已对齐 | 当前优先 `paraformer-zh-streaming`；faster-whisper 可新增适配器，不改管道。 |
| 快速云翻译器 | `DeepSeekTranslator` 使用兼容 OpenAI 的 API | 已对齐 | DeepSeek 符合补充文档的国内友好约束。 |
| LocalAgreement 稳定策略 | `TranscriptAssembler` 将 ASR delta 聚合为 `partial/stable/committed` 三态 | MVP 已对齐 | `partial` 用于实时吐字，`stable` 是约 1 秒翻译 checkpoint，`committed` 是最终锁定；后续可替换为更严格的 LocalAgreement。 |
| 修正窗口补丁 | `RevisionWindowCorrectionEngine` + `translation.patch` | 已对齐 | MVP 只做保守补丁，复杂上下文纠错放到后续迭代。 |
| 事件流，而不是整段重绘 | `EventSubtitleSink` 输出 `translation.partial`、`translation.patch`、`segment.commit` | 已对齐 | `translation.partial` 同时承载源文 hypothesis 和译文流式增量；同一 `segment_id` 用 `rev` 覆盖更新，前端不整段刷屏。 |
| 先用内存会话状态，后续再接 Redis | `InMemoryEventBus` | 已对齐 | Redis Streams 放到阶段 4。 |
| 术语表是必需能力 | `Glossary` + `GlossaryEntry` + `MatchedTerm` 已实现；`CorrectionContext.glossary` + `glossary_constraints` 数据流贯通；流式窗口匹配 + overlap 去重 + XML prompt 注入 + `as_asr_phrases()` ASR bias 出口已完成 | 已对齐 | 术语表作为 session 级配置，会话启动时加载术语全集，每段只匹配命中术语，prompt 仅注入命中项。MVP 使用 `RegexGlossaryMatcher`（预编译正则），术语数超过 500 时可替换为 Aho-Corasick/FlashText。 |
| 可选 TTS / 原生语音翻译 | `EdgeTtsSynthesizer`、`TranslatedAudioSink`、`InterpretationEngine` 边界 | 已对齐 | 默认关闭，避免 MVP 首版增加延迟；端到端模型可直接输出译文音频块。 |

当前文档与研究报告的关系是：**产品/管道模型对齐，传输层采用补充文档里的 LiveKit 快速开发路线；FastAPI/WebSocket 作为后续可控路径保留，而不是删除。**

### 1. Next 15 Web 工作台

选型：`apps/web` 使用 Next 15 + React，后续接 `@livekit/components-react` 获取麦克风、标签页音频或文件音频。页面放在 `src/app`，避开旧 F 盘 exFAT 环境下根级 `app/` 目录的权限锁。

构建约束：Next 15 必须在 NTFS 路径下构建。本机 F/E 盘为 exFAT，会让 Node 的 `fs.readlink` 对普通文件返回异常的 `EISDIR`；`D:\code\echosync` 位于 NTFS，已验证 Next 15 构建通过。

原则落实：

- 关注点分离：浏览器只负责采集、状态展示、字幕补丁渲染，不承担 ASR/翻译推理。
- KISS：第一屏就是同传工作台，不做营销页或复杂导航。
- YAGNI：当前提供可交互工作台和模拟事件流，真实 LiveKit token 与房间管理后续接入。

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
| Windows 系统声音 | `electron-display-media-loopback` | WASAPI loopback native addon / Python sidecar | 依赖倒置 |
| 混音 | `native-wasapi-mixed` | 原生层混合麦克风与系统声音后输出 16k mono PCM | 单一职责 |
| 文件回放 | `file-decode` | ffmpeg / WebCodecs 解码后转 `AudioFrame` | 开闭原则 |

桌面 UI 生命周期：

```text
Idle -> Active -> Finished
```

`Idle` 负责视频/网课默认开箱和起飞前音频电平校验；`Active` 负责转写监控、健康度、术语快加和自动滚动锁；`Finished` 负责复盘、导出前清理和沉淀。透明字幕窗按 Layer A/B/C 分层，默认穿透，Hover 唤醒轻控制，Pin 后展示最近 2-3 行和字幕状态。桌面端的状态模型放在 `apps/desktop/src/shared/session-ui-state.ts` 和 `apps/desktop/src/shared/overlay-interaction.ts`，后续 Web 工作台可以复用同一语义而不共享 Electron IPC。

### 2. LiveKit 作为实时音频通道

选型：用 LiveKit/WebRTC 承载实时音频，避免手写重采样、丢包恢复、设备兼容和数据通道编排。

原则落实：

- 优先成熟库：把音视频实时传输交给成熟框架，而不是从零造轮子。
- 低耦合：LiveKit 被限制在 `transport/` 适配层，核心管道不依赖 LiveKit SDK。
- 开闭原则：未来可增加 WebSocket、文件回放或原生实时供应商传输，不改 ASR/翻译模块。

### 3. Python Agent 作为推理编排层

选型：`apps/agent` 使用 Python 3.11，负责实时管道、会话状态、ASR/翻译/修正/TTS 适配器。

环境约束：Python Agent 必须使用项目内 `.venv`，并将 `PIP_CACHE_DIR`、`MODELSCOPE_CACHE` 指向项目内 `.cache/`。FunASR 依赖的 PyTorch CPU/GPU 轮子不能安装到全局 Python，详细步骤见 `doc/agent-env.md`。

原则落实：

- 单一职责：`pipeline/` 只做编排，`services/` 只做供应商适配，`domain/` 只定义 DTO。
- 依赖倒置：级联链路依赖 `Transcriber`、`Translator`、`CorrectionEngine`、`SubtitleSink` 抽象；端到端链路依赖 `InterpretationEngine` 抽象。
- 接口隔离：ASR、翻译、修正、字幕输出、TTS 是小接口，互不强迫对方实现无关方法。

### 4. FunASR / DeepSeek / edge-tts 作为 MVP 供应商方向

选型：

- ASR：FunASR 本地 AutoModel 适配器在 `services/asr/funasr_transcriber.py`，媒体文件抽音频由 `services/media/ffmpeg_audio_source.py` 完成。
- 翻译：DeepSeek 兼容 OpenAI API 的适配器在 `services/translation/deepseek_translator.py`。
- TTS：edge-tts 适配器在 `services/tts/edge_tts_synthesizer.py`，先作为可选输出。

原则落实：

- DRY：所有供应商统一转成内部 DTO，避免每层重复解析供应商格式。
- 里氏替换：`MockTranscriber` 与 `FunAsrTranscriber` 都实现同一个 `Transcriber` 语义。
- YAGNI：当前先用本地 AutoModel 和终端媒体样本验证 ASR 质量与延迟，前端接入前再补 FastAPI/WebSocket 会话服务。

### 5. 级联模型与端到端模型共用统一引擎边界

选型：新增 `InterpretationEngine` 抽象。级联方案由 `CascadedInterpretationEngine` 组合 ASR、翻译和修正组件；端到端方案可以直接实现 `InterpretationEngine`，输出统一的 `TranslationSegment`、`SubtitlePatch`、`SegmentCommit` 或 `TranslatedAudioChunk`。

原则落实：

- 开闭原则：新增 OpenAI Realtime、Qwen LiveTranslate、Azure Speech Translation 等端到端供应商时，只新增一个引擎适配器。
- 接口隔离：字幕输出仍走 `SubtitleSink`，译文音频单独走 `TranslatedAudioSink`，不会强迫字幕链路处理音频。
- 依赖倒置：`EngineDrivenInterpretationPipeline` 依赖抽象引擎和抽象输出，不依赖任何具体模型 SDK。
- 里氏替换：级联引擎和端到端引擎都输出相同领域事件，可以被同一个输出管道消费。

### 6. 修正能力采用事件流 + 修正窗口

选型：核心事件包括 `translation.partial`、`translation.patch`、`segment.commit`。修正引擎使用最近 1-2 个片段作为可修正窗口，MVP 只预留补丁生成策略。

原则落实：

- 观察者模式：`InMemoryEventBus` 让 UI、日志、测试都能订阅同一事件流。
- 事件溯源思想：字幕状态由事件追加而来，后续可持久化到 Redis Streams。
- KISS/YAGNI：先实现保守 revision patch，不在初始化阶段接复杂 LLM 纠错链。

### 6.5. 实时字幕 hypothesis 与流式翻译策略

选型：实时字幕采用行业常见的 interim hypothesis 模型，而不是等完整句子稳定后再显示。ASR 适配器持续输出 delta，`TranscriptAssembler` 负责把 delta 聚合成同一个活动片段：

- `partial`：每个 ASR delta 都会更新当前源文，用于英文/原文打字机效果；不触发翻译请求。
- `stable`：默认约 1 秒形成一次 checkpoint，触发一次流式翻译；前端用同一个 `segment_id` 和递增 `rev` 替换尾部文字。
- `committed`：遇到标点、供应商 final 或音频流结束时锁定片段，输出最终译文并发布 `segment.commit`。

翻译器保留 `translate()` 一次性接口，同时新增 `stream_translate()`。DeepSeek 使用 OpenAI-compatible `stream=True`，收到 token delta 后累计成当前译文并持续发布 `translation.partial`。如果供应商暂时不支持流式，级联引擎会回退到一次性 `translate()`，不影响管道契约。

级联引擎会优先发布源文 hypothesis，翻译在后台按 checkpoint 顺序处理；如果同一活动片段已经排入更高 `rev`，旧 checkpoint 会被跳过，避免慢翻译把前文回滚或浪费 API。

前端约定：当 `translation.partial.target_text` 为空时，只更新源文，不清空已有译文；当译文增量到达时，替换同一行目标文本。这样可以实现“实时吐字 + 约 1 秒断句/修订前文”的体验，避免每个 token 新开字幕行。

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
  -> partial 源文 hypothesis 事件
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

- 创建 LiveKit token 服务或本地开发 token。
- 前端接入 LiveKit Room、麦克风和标签页音频。
- `LiveKitAgentBridge` 将音频帧转换为 `AudioFrame`。
- 桌面端接入 Electron 主控窗口和悬浮字幕窗，完成麦克风、Windows 系统声音、混音、文件回放的源选择 IPC。
- Windows 系统声音先用 Electron display media loopback 做开发验证；稳定版本再替换为 WASAPI loopback 原生适配器。

### 阶段 2：MVP AI 链路

- 接入 FunASR `paraformer-zh-streaming` 本地 AutoModel。
- 使用 `echosync-asr-demo` 或 `python -m echosync_agent.asr_demo` 对视频/音频样本做终端转写和延迟测试。
- FastAPI/WebSocket 只作为前端和桌面端接入 ASR 会话的传输层，不把模型逻辑移到 Node 或前端。
- 接入 DeepSeek 翻译器，并开启兼容 OpenAI API 的流式翻译。
- 使用 `translation.partial` 持续驱动源文和译文打字机效果，使用 `segment.commit` 锁定最终字幕。
- 保持 edge-tts 关闭，避免 TTS 增加首版延迟。

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
