# EchoSync

面向单向音频流的 AI 同声传译助手。产品目标是帮助用户实时理解英语或其他外语的演讲、技术分享、会议以及在线课程内容，通过实时翻译提供流畅的中文理解体验。

## 架构

EchoSync 当前初始化为一个小型 monorepo：

- `apps/desktop`：Electron Windows 桌面端，提供主控窗口、透明置顶悬浮字幕窗和桌面音频源 IPC 边界。
- `apps/web`：Next 15 听译工作台，用于音频采集入口、字幕渲染和后续会话 token 接口。
- `apps/agent`：Python 实时 Agent，用于 ASR、翻译、修正、字幕事件和可选 TTS。
- `doc/architecture-mvp.md`：MVP 架构、模块边界与开发路线图。
- `doc/AI同声传译助手需求分析与调研.md`：面向题目的产品需求、竞品调研、MVP 范围和非目标。
- `doc/技术路线与库调研.md`：当前代码状态、库选择和下一步技术风险。

文档口径以 `README.md`、`doc/architecture-mvp.md` 和 `doc/AI同声传译助手需求分析与调研.md` 为当前事实源。`doc/补充文档.md` 保留早期 LiveKit 优先方案背景，`doc/realtime-audio-streaming-research.md` 保留音频传输改造前后的调研记录；其中旧链路描述用于解释为什么要改，不代表当前 Desktop 主链路。

后端核心采用依赖倒置：

- 级联链路依赖 `Transcriber`、`Translator`、`CorrectionEngine`、`SubtitleSink` 等小接口，而不是依赖 FunASR、DeepSeek、edge-tts 或 LiveKit 的具体 SDK。
- 翻译器最小契约是 `Translator.translate()`，DeepL 这类非流式 API 可以直接接入；支持 token stream 的 DeepSeek / OpenAI-compatible 适配器再额外实现 `StreamingTranslator.stream_translate()`。
- 端到端链路依赖 `InterpretationEngine`，可以直接输出字幕事件、修订补丁、提交事件和译文音频块。
- 字幕输出和译文音频输出分离为 `SubtitleSink` 与 `TranslatedAudioSink`，避免一个接口承担无关职责。

## 初始功能范围

- 捕获或接收单向音频流输入
- 对语音内容进行近实时转录
- 以低延迟将转录结果翻译为中文
- 以字幕形式展示翻译结果，并在后续支持可选的语音合成播报
- 当获得更多上下文信息时，自动修正先前的识别或翻译错误

## 当前状态

项目仓库已初始化，并完成 Next 15 + Python Agent 框架、提供商无关的实时管道契约、字幕事件协议和模拟链路测试骨架。当前地基同时支持 ASR→翻译→修正的级联模型，以及未来 OpenAI Realtime、Qwen LiveTranslate、Azure Speech Translation 等端到端模型适配。

ASR provider 当前支持 `mock`、`funasr`、`voxtral`。默认 `.env.example` 使用 `mock` 方便跑通事件链路；真实 PCM 音频必须切到 `funasr` 或 `voxtral`，否则 `MockTranscriber` 只适合文本帧演示，不代表真实识别能力。翻译 provider 当前支持 `mock`、`deepseek`。Desktop 会在启动前读取 Agent `/v1/realtime/capabilities`，显示后端默认 provider、缺失密钥或缺失 SDK，并在本次会话中声明 `asr_latency_mode`；只有用户显式选择 provider 时才额外发送 `asr_provider` 或 `translation_provider` 覆盖后端 `.env` 默认值。API key、base URL 和模型密钥仍只保留在后端环境变量中。Deepgram/Azure 目前是下一批候选，不是已接入的可选 provider。

当前 Web 工作台已按 `doc/UI设计调研.md` 的 MVP 方向实现：

- 三栏工作台、剧场、阅读、紧凑悬浮四种模式。
- `interim`、`stable`、`revised`、`locked` 字幕状态展示。
- 实时字幕采用 interim hypothesis 策略：ASR 源文先通过 `transcript.partial` 持续吐字，约 1 秒形成一次翻译 checkpoint；DeepSeek 译文通过流式 `translation.partial` 增量更新，同一字幕行允许尾部修订。
- 模拟 `transcript.partial`、`translation.partial`、`translation.patch`、`segment.commit` 事件流。
- 源文、术语、笔记、历史时间线和延迟指标面板。

当前 Desktop 地基已按 `doc/原型图.html` 的悬浮字幕方向升级：

- Electron 主控窗口使用无边框标题栏，负责音频源选择、字幕事件调试和悬浮窗控制。
- 独立悬浮字幕窗使用透明、无边框、置顶窗口，渲染毛玻璃字幕卡。
- 桌面音频源目录包含麦克风、Windows 系统声音、混音和文件回放。
- Windows 系统声音已通过 Electron `getDisplayMedia` loopback 接入 renderer Web Audio，转为 16k mono PCM16 后送到 Python Agent。
- Python Agent 的 `8766` 端口同时提供 `/v1/realtime/sessions/{session_id}` 音频输入和 `/v1/caption/events` 字幕输出，真实链路为“识别 -> 翻译 -> 字幕显示”。

当前 Desktop UI 已按 Stateful Hybrid 主页控制中心推进：

- `Idle`：视频/网课默认开箱，主区提供起飞前音频电平校验和一键打开字幕弹窗。
- Idle 启动前会先做 Agent 能力预检；如果 `mock` ASR 被用于真实音频、Voxtral/DeepSeek 缺少密钥或依赖，UI 会阻止开始并显示原因。
- `Active`：主页切换为会话驾驶舱，展示最近转写、健康度、术语快加和自动滚动锁入口。
- `Finished`：会话结束后停留在复盘态，提供导出前快速清理、摘要指标和最近记录。
- 字幕弹窗采用 Layer A/B/C：默认穿透极简、Hover 轻控制、Pin 小型双语舞台，并支持快捷唤醒和召回居中；字幕样式支持双语、主字幕、翻译字幕三种显示模式，旧 `line/split` 配置会兼容回双语模式。
- 会话结束后会保留本次原始音频 Blob，并在复盘页提供双栏原文/译文、片段级播放高亮和点击片段 seek。当前归档只在本次进程内可回放，下一阶段落盘到 `userData/sessions/{sessionId}/`。

## 文档与备注规范

人工维护的 Markdown 文档、业务代码注释、Python docstring、配置样例说明都使用中文。技术标识、包名、类名、事件名、配置键名、日志 key、自动生成文件和测试英文语料可保留英文，例如 `Next.js`、`LiveKit`、`AudioFrame`、`translation.patch`。

## 本地开发

- 推荐路径：`D:\code\echosync`，该目录位于 NTFS 分区，支持 Next/Node 构建所需的正常 `readlink` 行为。
- 推荐 Node：`20.19.0`，可通过 `nvm use` 读取 `.nvmrc` 切换。
- Python Agent 必须使用项目内 `.venv`，不要使用全局 Python。环境隔离、GPU 版 PyTorch、ModelScope 缓存位置见 `doc/agent-env.md`。
- Web 工作台：`npm run dev:web`
- Windows 桌面端：`npm run dev:desktop`
- 桌面端测试：`npm run test:desktop`

### 本地真实链路测试

1. 在一个终端启动 Python Agent：

```powershell
cd apps/agent
python -m echosync_agent.transport.caption_ws
```

2. 在另一个终端启动桌面端：

```powershell
npm run dev:desktop
```

3. 打开视频或网课音频，桌面端选择“Windows 系统声音”，点击“开始同传”。

真实识别前请在 `.env` 中设置：

```powershell
ECHOSYNC_ASR_PROVIDER=funasr
FUNASR_DEVICE=auto
```

也可以在 Desktop 会话启动时选择 ASR provider、ASR 延迟模式和翻译 provider。选择“后端默认/通用模型”时不发送覆盖字段，沿用 Agent `.env`；显式选择 `DeepSeek-V3` 时只发送 provider id，仍要求后端 `.env` 配置 `DEEPSEEK_API_KEY`。如需云端英语实时 ASR，可把会话 provider 切到 `voxtral`，同时保证后端 `.env` 配置了 `MISTRAL_API_KEY`。Agent 会在启动实时 pipeline 前校验本次音频源和 ASR provider：`mock` 只接受 `network_stream` 演示输入，遇到 Windows 系统声、麦克风或文件 PCM 会返回 `realtime.error` 并结束会话，不再额外发送 `realtime.done`。

如果只想验证字幕事件和 UI，可以继续使用默认 `mock`。

4. 观察 Python 日志：

- `audio_stream_started`：桌面端已开始送系统音频。
- `audio_chunk_received`：实时 PCM chunk 已进入 Agent。
- `audio_stream_metrics`：Agent 每秒聚合打印音频帧、音频毫秒数、字节数、传输延迟和队列深度。
- `caption_event_published`：ASR/翻译后的字幕事件已推给桌面端，并带 `published_at_ms` 与模型指标；`transcript.partial` 是源文草稿，`translation.partial` 是译文更新。

当前 MVP 的采集节点使用 `ScriptProcessorNode` 做快速验证；后续会替换为 `AudioWorklet` 或 WASAPI loopback，以降低抖动和长期运行风险。

当前 renderer 已加轻量门控：低于响度阈值时不发送音频块，连续静音后自动把上一块活跃音频标记为 `is_final=true`，避免静音时持续打满 ASR。字幕弹窗会显示当前片段时间范围。

实时热路径已做首轮算法优化：Desktop 真实链路使用 `audio.start` JSON 控制帧 + `pcm16.binary.v1` 二进制 PCM frame，目标帧长 80ms；音频门控使用分片队列减少样本重复拷贝。FunASR 适配器内部会把 80ms 传输帧聚合成推理窗口，`balanced` 默认使用 `FUNASR_CHUNK_MS=600ms`，`low_latency` 使用约 320ms，`accuracy` 使用约 900ms，避免低延迟传输强迫本地模型一帧一推理。Voxtral 会按同一 `asr_latency_mode` 映射 `target_streaming_delay_ms`：`low_latency` 最多 480ms，`balanced` 沿用 `.env`，`accuracy` 至少 1600ms。ASR 分段维护增量文本避免高频 `join`，翻译 checkpoint 按 `segment_id` 合并待处理项，降低模型慢响应时的队列积压。MP4/音频文件源使用 ffmpeg stdout 流式分帧，真实样本 `vido/videoplayback.mp4` 的首个 80ms PCM frame 约 40ms 产出，不再等待完整文件解码。旧 JSON `audio.chunk` / `pcm_base64` 仅作为兼容协议和部分测试路径保留。

实时控制事件语义：`realtime.error` 表示本次会话启动失败或 pipeline 失败，客户端应进入错误态并停止本地媒体流；`realtime.done` 只表示正常完成。用户主动停止时，如果 pipeline 已经失败，Agent 会优先上报错误；如果仍在处理队列，则取消未完成的 pipeline，避免停止后继续推送晚到字幕。

原始音频录制与 ASR 发送是两条链路：`MediaRecorder` 连续保存原始 `MediaStream`，ASR 发送链路继续使用音频门控。这样复盘页能回放完整音频，而实时识别不会被静音流拖慢。

## 术语表（Glossary）

术语表用于控制翻译时的术语译法，默认启用 `default` 域。

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ECHOSYNC_GLOSSARY_ENABLED` | `true` | 是否启用术语表（`true`/`false`） |
| `ECHOSYNC_GLOSSARY_DOMAIN` | `default` | 加载的术语域名（对应 `terms/<domain>.csv`） |
| `ECHOSYNC_GLOSSARY_TERMS_DIR` | 项目根目录下的 `terms/` | 术语 CSV 文件目录路径 |

### CSV 格式

术语文件位于 `apps/agent/terms/` 下，有表头，`source,target` 强制，其余 optional：

```csv
source,target,aliases,category,case_sensitive,match_mode,priority,constraint
LiveKit,LiveKit,,brand,true,literal,10,required
GPT-4o,GPT-4o,"GPT 4o|gpt4o",model,false,literal,10,required
latency,延迟,,tech,false,word,5,preferred
simultaneous interpretation,同声传译,,translation,false,phrase,8,required
```

- `aliases`：同义词变体，以 `|` 分隔，内部展开为独立条目
- `match_mode`：`word`（英文词边界）、`phrase`（多词短语，空格归一化）、`literal`（C++/Node.js 等符号术语）、`auto`（自动推断）
- `constraint`：`required`（必须使用该译法）、`preferred`（优先采用该译法）
- `priority`：数值越大越优先，冲突时 priority 高者优先

### 添加自定义术语

1. 在 `apps/agent/terms/` 下创建新的 CSV 文件（如 `tech.csv`）
2. 设置 `ECHOSYNC_GLOSSARY_DOMAIN=tech`，会加载 `default.csv` + `tech.csv`，后者覆盖前者
3. 术语加载失败时不会中断 pipeline，仅记录 warning
