# EchoSync MVP Architecture

## 技术选型与原则映射

## 与 deep-research-report.md 的对齐情况

| 研究报告建议 | 当前框架实现 | 状态 | 说明 |
|---|---|---|---|
| Caption-first cascaded pipeline | `AudioFrame -> Transcriber -> Translator -> CorrectionEngine -> SubtitleSink` | 已对齐 | 字幕优先，TTS 只作为可选 `TtsSynthesizer` 边界。 |
| React 或 Next.js 工作台 | `apps/web` 使用 Next 15 + React | 已对齐 | 已在 `D:\code\echosync` NTFS 路径下验证 Next 15 build。 |
| 浏览器采集 microphone/tab/upload | UI 已保留 `mic/tab/file` 模式入口 | 部分对齐 | 真实 Web Audio/LiveKit capture 在 Phase 1 接入。 |
| WebSocket 到自有后端 | 当前选择 LiveKit/WebRTC + Python Agent | 有意偏离 | 研究报告给 WebSocket/FastAPI 作为默认可控路径；补充文档要求 3 天 MVP 国内友好，优先 LiveKit 降低音频传输复杂度。后续可补 FastAPI control plane。 |
| Python 实时编排服务 | `apps/agent` Python package | 已对齐 | 目前是 Agent 编排层，不把供应商 SDK 写进核心管道。 |
| streaming ASR: faster-whisper 或 FunASR | `FunAsrTranscriber` 适配器占位，`MockTranscriber` 用于测试 | 已对齐 | MVP 接 FunASR；faster-whisper 可新增适配器，不改管道。 |
| fast cloud translator | `DeepSeekTranslator` 使用 OpenAI-compatible API | 已对齐 | DeepSeek 符合补充文档的国内友好约束。 |
| local-agreement stability | 由 `Transcriber` 输出 `partial/stable/committed` 状态，独立策略未实现 | 部分对齐 | 当前契约已预留状态字段；后续应新增 `StabilityPolicy` 或 ASR aggregator。 |
| revision-window patches | `RevisionWindowCorrectionEngine` + `translation.patch` | 已对齐 | MVP 只做保守 patch，复杂上下文纠错放到后续迭代。 |
| event stream, not full redraw | `EventSubtitleSink` 输出 `translation.partial`、`translation.patch`、`segment.commit` | 已对齐 | 前端 `protocol.ts` 与后端 DTO 对齐。 |
| in-memory session state first, Redis later | `InMemoryEventBus` | 已对齐 | Redis Streams 放到 Phase 4。 |
| glossary/termbank mandatory | DTO 和 `CorrectionContext.glossary` 已预留 | 部分对齐 | UI 有术语栏展示；术语管理和命中统计待实现。 |
| optional TTS/native S2ST | `EdgeTtsSynthesizer` 边界 | 已对齐 | 默认关闭，避免 MVP 首版增加延迟。 |

当前文档与研究报告的关系是：**产品/管道模型对齐，传输层采用补充文档里的 LiveKit 快速开发路线；FastAPI/WebSocket 作为后续可控路径保留，而不是删除。**

### 1. Next 15 Web 工作台

选型：`apps/web` 使用 Next 15 + React，后续接 `@livekit/components-react` 获取麦克风、标签页音频或文件音频。页面放在 `src/app`，避开旧 F 盘 exFAT 环境下根级 `app/` 目录的权限锁。

构建约束：Next 15 必须在 NTFS 路径下构建。本机 F/E 盘为 exFAT，会让 Node 的 `fs.readlink` 对普通文件返回异常的 `EISDIR`；`D:\code\echosync` 位于 NTFS，已验证 Next 15 构建通过。

原则落实：

- 关注点分离：浏览器只负责采集、状态展示、字幕补丁渲染，不承担 ASR/翻译推理。
- KISS：第一屏就是同传工作台，不做营销页或复杂导航。
- YAGNI：当前只提供字幕工作台骨架，真实 LiveKit token 与房间管理后续接入。

### 1.5. 桌面 UI 生命周期

`Idle -> Active -> Finished`

`Idle` 负责视频/网课默认开箱和音频电平校验；`Active` 负责转写监控、健康度和术语快加；`Finished` 负责复盘、导出前清理和沉淀。透明字幕窗按 Layer A/B/C 分层，默认穿透，Hover 唤醒轻控制，Pin 后展示最近 2-3 行和字幕状态。

后续 Web 工作台可以复用同一套生命周期语义，但不共享 Electron IPC 和桌面窗口策略。

### 2. LiveKit 作为实时音频通道

选型：用 LiveKit/WebRTC 承载实时音频，避免手写重采样、丢包恢复、设备兼容和数据通道编排。

原则落实：

- 优先成熟库：把音视频实时传输交给成熟框架，而不是从零造轮子。
- 低耦合：LiveKit 被限制在 `transport/` 适配层，核心管道不依赖 LiveKit SDK。
- 开闭原则：未来可增加 WebSocket、文件回放或原生 Realtime Provider 传输，不改 ASR/翻译模块。

### 3. Python Agent 作为推理编排层

选型：`apps/agent` 使用 Python 3.11，负责实时管道、会话状态、ASR/翻译/修正/TTS 适配器。

原则落实：

- 单一职责：`pipeline/` 只做编排，`services/` 只做供应商适配，`domain/` 只定义 DTO。
- 依赖倒置：`RealtimeInterpretationPipeline` 只依赖 `Transcriber`、`Translator`、`CorrectionEngine`、`SubtitleSink` 抽象。
- 接口隔离：ASR、翻译、修正、字幕输出、TTS 是小接口，互不强迫对方实现无关方法。

### 4. FunASR / DeepSeek / edge-tts 作为 MVP 供应商方向

选型：

- ASR：FunASR 适配器预留在 `services/asr/funasr_transcriber.py`。
- 翻译：DeepSeek OpenAI-compatible 适配器在 `services/translation/deepseek_translator.py`。
- TTS：edge-tts 适配器在 `services/tts/edge_tts_synthesizer.py`，先作为可选输出。

原则落实：

- DRY：所有供应商统一转成内部 DTO，避免每层重复解析供应商格式。
- 里氏替换：`MockTranscriber` 与 `FunAsrTranscriber` 都实现同一个 `Transcriber` 语义。
- YAGNI：真实 FunASR 音频流接入先占位，不提前写不可验证的复杂 WebSocket 逻辑。

### 5. 修正能力采用事件流 + 修正窗口

选型：核心事件包括 `translation.partial`、`translation.patch`、`segment.commit`。修正引擎使用最近 1-2 个片段作为可修正窗口，MVP 只预留补丁生成策略。

原则落实：

- 观察者模式：`InMemoryEventBus` 让 UI、日志、测试都能订阅同一事件流。
- 事件溯源思想：字幕状态由事件追加而来，后续可持久化到 Redis Streams。
- KISS/YAGNI：先实现保守 revision patch，不在初始化阶段接复杂 LLM 纠错链。

## 项目目录结构

```text
echosync/
  apps/
    agent/
      pyproject.toml
      src/echosync_agent/
        domain/              # AudioFrame、TranscriptSegment、TranslationSegment、Patch DTO
        interfaces/          # Transcriber、Translator、CorrectionEngine、SubtitleSink 等抽象
        pipeline/            # RealtimeInterpretationPipeline 编排核心
        runtime/             # Settings、依赖组装、内存事件总线
        services/
          asr/               # MockTranscriber、FunASR adapter
          translation/       # MockTranslator、DeepSeek adapter
          correction/        # Revision window correction
          subtitle/          # Event subtitle sink
          tts/               # edge-tts adapter
        transport/           # LiveKit bridge 占位
      tests/
    web/
      src/app/               # Next 15 App Router 工作台页面
      src/lib/protocol.ts    # 前端字幕事件协议
  doc/
    deep-research-report.md
    补充文档.md
    architecture-mvp.md
```

## 核心管道

```text
AudioFrame stream
  -> Transcriber.stream()
  -> Translator.translate()
  -> CorrectionEngine.revise()
  -> SubtitleSink.publish_translation / publish_patch / publish_commit
  -> EventBus observers
```

这个结构把“音频流接入、流式 ASR、翻译引擎、字幕/TTS 输出、错误修正引擎”垂直切开。新增 ASR 供应商时，只新增一个 `Transcriber` 实现；新增修正策略时，只新增一个 `CorrectionEngine` 实现。

## MVP 路线图

### Phase 0: 初始化完成

- 建立 monorepo。
- 建立 Python agent 抽象接口、DTO、管道和 fake 链路。
- 建立 Next 15 字幕工作台骨架。
- 建立事件协议和修正窗口接口。

### Phase 1: 音频通道

- 创建 LiveKit token 服务或本地开发 token。
- 前端接入 LiveKit Room、麦克风和标签页音频。
- `LiveKitAgentBridge` 将音频帧转换为 `AudioFrame`。

### Phase 2: MVP AI 链路

- 接入 FunASR streaming WebSocket。
- 接入 DeepSeek 翻译器。
- 使用 `translation.partial` 和 `segment.commit` 驱动前端字幕。
- 保持 edge-tts 关闭，避免 TTS 增加首版延迟。

### Phase 3: 修正与术语

- 实现术语表注入和命中统计。
- 将最近 1-2 个片段进行小窗口重翻译。
- 输出 `translation.patch`，前端只更新变化字符，减少闪烁。

### Phase 4: 可选能力

- edge-tts 或云 TTS 语音输出。
- 录播课程 accuracy mode。
- Redis Streams 会话事件持久化。
- 离线评估：WER/CER、COMET/SacreBLEU、首字幕延迟、patch rate。
