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

- 级联链路依赖 `Transcriber`、`Translator`、`CorrectionEngine`、`SubtitleSink`、`TtsSynthesizer` 等小接口，而不是依赖 FunASR、DeepSeek、edge-tts、ElevenLabs 或 LiveKit 的具体 SDK。
- 翻译器最小契约是 `Translator.translate()`，DeepL 这类非流式 API 可以直接接入；支持 token stream 的 DeepSeek / OpenAI-compatible 适配器再额外实现 `StreamingTranslator.stream_translate()`。
- 端到端链路依赖 `InterpretationEngine`，可以直接输出字幕事件、修订补丁、提交事件和译文音频块。
- 字幕输出和译文音频输出分离为 `SubtitleSink` 与 `TranslatedAudioSink`，避免一个接口承担无关职责。
- TTS 默认关闭；Agent 侧已接入 `edge-tts` 和 ElevenLabs provider，启用后作为旁路 `tts.audio` 事件输出，不阻塞字幕；Desktop 可在本次会话选择语音播报 provider，并在控制中心窗口播放返回音频。语音合成仍在 Agent 侧，API key、voice id 和 provider 逻辑不下放到前端。

## 初始功能范围

- 捕获或接收单向音频流输入
- 对语音内容进行近实时转录
- 以低延迟将转录结果翻译为中文
- 以字幕形式展示翻译结果，并在后续支持可选的语音合成播报
- 当获得更多上下文信息时，自动修正先前的识别或翻译错误

## 当前状态

项目仓库已初始化，并完成 Next 15 + Python Agent 框架、提供商无关的实时管道契约、字幕事件协议和模拟链路测试骨架。当前地基同时支持 ASR→翻译→修正的级联模型，以及未来 OpenAI Realtime、Qwen LiveTranslate、Azure Speech Translation 等端到端模型适配。

ASR provider 当前支持 `mock`、`funasr`、`voxtral`、`deepgram`。默认 `.env.example` 使用 `mock` 方便跑通事件链路；真实 PCM 音频必须切到 `funasr`、`voxtral` 或 `deepgram`，否则 `MockTranscriber` 只适合文本帧演示，不代表真实识别能力。翻译 provider 当前支持 `mock`、`deepseek`；TTS provider 当前支持 `disabled`、`edge-tts`、`elevenlabs`。Desktop 会在启动前读取 Agent `/v1/realtime/capabilities`，显示后端默认 provider、缺失密钥或缺失 SDK/本地依赖，并在本次会话中声明 `asr_latency_mode`；只有用户显式选择 provider 时才额外发送 `asr_provider`、`translation_provider` 或 `tts_provider` 覆盖后端 `.env` 默认值。API key、base URL、voice id 和模型密钥仍只保留在后端环境变量中。Azure 目前是下一批 ASR 候选，不是已接入的可选 provider。

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
- Windows 系统声音默认走 Rust WASAPI sidecar 的 Application Loopback，模式为“采系统声但排除 EchoSync 进程树”；sidecar 在本机转为 16k mono PCM16 后通过主进程直接送入 Python Agent，避免 TTS 播放被系统声回采。Electron `getDisplayMedia` loopback 仅保留为兼容/历史路径，不作为默认系统声方案。
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
- 构建 Windows 原生 WASAPI sidecar：`npm run build:wasapi-sidecar`。若 C 盘空间不足，可把 `RUSTUP_HOME`、`CARGO_HOME`、`CARGO_TARGET_DIR` 指向 D 盘，例如 `D:\toolchains\rustup`、`D:\toolchains\cargo`、`D:\code\echosync\.tmp\wasapi-target`。

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

Windows 系统声音默认不再由 renderer 创建 WebAudio 采集流，而是由 Electron 主进程启动 `apps/wasapi-sidecar` 编译出的 `echosync-wasapi-sidecar.exe`。开发态会优先查找 `apps/wasapi-sidecar/target/debug/echosync-wasapi-sidecar.exe`，也支持 `D:\code\echosync\.tmp\wasapi-target\debug\echosync-wasapi-sidecar.exe`；也可以用 `ECHOSYNC_WASAPI_SIDECAR_PATH` 显式指定。主进程向 Agent 发送的 `audio.start.device_id` 形如 `wasapi:exclude-process-tree:<pid>`，Agent 只有在看到这种原生排除自身进程的 device id 时，才允许 Windows 系统声音和 TTS 同时启用。

真实识别前请确保 Agent 环境安装了对应 provider 依赖。FunASR 运行时需要 `funasr`、`modelscope` 和 `torch`，缺任一项都会在 `/v1/realtime/capabilities` 中显示为 `missing_dependency`，Desktop 会在开始采集前拦截。随后在 `.env` 中设置：

```powershell
ECHOSYNC_ASR_PROVIDER=funasr
FUNASR_DEVICE=auto
```

FunASR 默认关闭 `livekit.plugins.silero` VAD，依赖 hard timeout 做延迟兜底；需要实验 soft endpoint 时可设置 `FUNASR_VAD_ENABLED=true`。本地 30 秒英文样本里 Silero 没带来中途 soft endpoint，且会明显增加 CPU 开销，因此暂不作为 MVP 默认路径。

也可以在 Desktop 会话启动时选择 ASR provider、ASR 延迟模式、翻译 provider 和语音播报 provider。选择“自动/通用模型”时不发送覆盖字段，沿用 Agent `.env`；显式选择 `DeepSeek-V3` 时只发送 provider id，仍要求后端 `.env` 配置 `DEEPSEEK_API_KEY`。如需云端英语实时 ASR，可把 ASR provider 切到 `voxtral` 或 `deepgram`：Voxtral 需要 `MISTRAL_API_KEY`，Deepgram 需要 `DEEPGRAM_API_KEY`，默认 Deepgram 模型为 `nova-3`，`DEEPGRAM_ENDPOINTING_MS=300`。如需使用阿里云百炼实时音频模型，可设置 `DASHSCOPE_API_KEY` 后选择 ASR provider `qwen-asr` 或翻译 provider `qwen-livetranslate`：`qwen-asr` 使用 `QWEN_ASR_MODEL=qwen3-asr-flash-realtime-2026-02-10` 做实时语音识别，后续仍复用现有 DeepSeek/DeepL 翻译链路；`qwen-livetranslate` 使用 `QWEN_LIVETRANSLATE_MODEL=qwen3.5-livetranslate-flash-realtime` 作为端到端语音翻译引擎，直接产出译文和可选译文音频（`QWEN_LIVETRANSLATE_OUTPUT_AUDIO=true`），默认再并行 `qwen-asr` 回填源文（`QWEN_LIVETRANSLATE_SOURCE_BACKFILL=true`）。Deepgram Streaming STT 适配器会在静音门控期间发送 WebSocket `KeepAlive`，并把多个 `is_final=true` span 累积到 `speech_final=true` 后再提交 endpoint final，避免长句中段被拆丢。Deepgram 官方 Voice Agent 是 STT+LLM+TTS 的单 WebSocket 端到端对话方案，当前不直接接管 EchoSync 主链路；EchoSync 先接 Deepgram Streaming STT，继续复用现有 DeepSeek 翻译、术语、修订和字幕状态机。Agent 会在启动实时 pipeline 前校验本次音频源和 ASR provider：`mock` 只接受 `network_stream` 演示输入，遇到 Windows 系统声、麦克风或文件 PCM 会返回 `realtime.error` 并结束会话，不再额外发送 `realtime.done`。

### 可选慢速语义修复

实时翻译热路径仍只做一次流式翻译和本地清理；如果需要在提交后进一步修正口语化、断片、术语漏译或繁简混杂问题，可以启用 committed 字幕后台慢修复：

```powershell
ECHOSYNC_TRANSLATION_REPAIR_PROVIDER=deepseek
ECHOSYNC_TRANSLATION_REPAIR_MODEL=deepseek-chat
ECHOSYNC_TRANSLATION_REPAIR_TIMEOUT_MS=1500
ECHOSYNC_TRANSLATION_REPAIR_MAX_CONCURRENCY=1
ECHOSYNC_TRANSLATION_REPAIR_MODE=suspect_only
```

慢修复默认关闭。启用后只在 `segment.commit` 之后后台排队，命中 `glossary_missing_required_terms`、ASR 空格异常、疑似断片、口头禅/繁简清理等风险时才请求 DeepSeek；修复结果通过 `caption_update(state=final, revision+1)` 更新字幕和记录，不重新触发 TTS，也不阻塞首 token 或 commit。

### 可选语音播报（TTS）

TTS 默认关闭，不影响字幕延迟。需要播报译文时，可以在 Agent `.env` 中设置默认 provider，也可以在 Desktop 偏好设置的“语音播报”里对本次会话选择：

```powershell
ECHOSYNC_TTS_PROVIDER=disabled   # disabled / edge-tts / elevenlabs
EDGE_TTS_VOICE=zh-CN-XiaoxiaoNeural
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
# 同传优先低延迟；质量优先可改为 eleven_multilingual_v2。
ELEVENLABS_MODEL=eleven_flash_v2_5
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
ELEVENLABS_SPEED=1.15
ELEVENLABS_STABILITY=0.85
ELEVENLABS_SIMILARITY_BOOST=0.75
ELEVENLABS_STYLE=0.0
ELEVENLABS_USE_SPEAKER_BOOST=false
ELEVENLABS_OPTIMIZE_STREAMING_LATENCY=
```

`edge-tts` 需要安装对应 Python 依赖；`elevenlabs` 必须配置 `ELEVENLABS_API_KEY` 和 `ELEVENLABS_VOICE_ID`，且 voice id 必须属于当前 API key 可访问的 ElevenLabs voice。Agent 启动前能力检查会调用 ElevenLabs voice 查询接口校验该 voice id；若返回 `voice_not_found`，前端预检会拦截启动并提示重新从 ElevenLabs Voices 页面或 `/v1/voices` 复制可用 voice id。仅 voice 可查还不等于可合成，部分 library/professional voice 在免费套餐下会在 TTS stream 阶段返回 `paid_plan_required`；Agent 会对同一 key/voice/model/output 组合做一次缓存的极短 TTS 探测，把这类套餐/API 权限问题提前暴露给前端预检。启用后，Agent 只在最终 `segment.commit` 后消费 committed 译文，避免 DeepSeek committed 流式增量触发重复合成；但进入 TTS 前会优先按逗号、顿号、分号这类停顿拆成小句，`ECHOSYNC_TTS_UTTERANCE_MAX_CHARS` / `ECHOSYNC_TTS_UTTERANCE_MIN_CHARS` 只做长度兜底，给每个小句生成独立 `segment_id_ttsNN` 音频流，避免等到句号才播。TTS worker 会先发布空音频占位锁定播放顺序，再按 `ECHOSYNC_TTS_PREFETCH_CONCURRENCY` 受限并发预合成后续小句；Desktop 仍按 segment/rev 串行播放，避免抢话，同时减少连续视频里的句间空档。用户停止会话时 pipeline 取消会同步取消 TTS worker。

安全闸规则：普通完整系统 loopback 不允许和 TTS 同时启用，防止 EchoSync 自己播报的译文再次被 ASR 识别。当前 Windows 系统声音默认通过 WASAPI `exclude-process-tree` 排除 EchoSync 主进程树，因此可在该模式下开启 TTS；如果后续降级回 Electron displayMedia 或其他无法证明排除自身音频的系统声采集，前端预检和 Agent 兜底都会重新阻止 `windows-system + TTS`。

同传播报默认略快：`EDGE_TTS_RATE=+15%`，`ELEVENLABS_SPEED=1.15`，用于弥补翻译语音天然落后原声的问题。ElevenLabs 默认使用更适合实时场景的 `eleven_flash_v2_5`；如果更重视长文本数字规范化和播报质量，可在 `.env` 改回 `eleven_multilingual_v2`。同传语音默认走平稳设置：`ELEVENLABS_STABILITY=0.85` 降低情绪起伏，`ELEVENLABS_STYLE=0.0` 不放大表演风格，`ELEVENLABS_USE_SPEAKER_BOOST=false` 降低额外计算和延迟风险，`ELEVENLABS_SIMILARITY_BOOST=0.75` 保持基本音色一致性。`ELEVENLABS_OPTIMIZE_STREAMING_LATENCY` 保留兼容但默认不设置，因为官方已不推荐把它作为新方案。Agent 收到 TTS 音频分片后立即推送 `final=false`，不为了标记结束而压住首个音频包；供应商流结束时再发送空 `audio_base64` 的 `final=true` 结束包。renderer 优先用 MediaSource 追加播放分片并用结束包关闭流；运行环境不支持对应 MIME 时，回退为同一 segment/rev 等到结束包后拼接 Blob 播放。`tts.audio` 会携带 `tts_first_audio_ms`、`tts_queue_wait_ms`、`tts_total_ms`、`tts_audio_chunks`、`tts_audio_bytes`、`tts_utterance_index`、`tts_utterance_count` 等 metrics，便于区分 TTS 首音慢、预合成队列追不上、总合成慢、小句切分不合理还是前端播放慢。

如果只想验证字幕事件和 UI，可以继续使用默认 `mock`。

### 会议记录 AI 摘要

会议记录保存后，Desktop 主进程会在后台读取完整双语片段并调用 OpenAI-compatible/DeepSeek Chat Completions 生成复盘摘要。Renderer 只负责保存草稿和展示状态，不持有模型密钥。摘要任务完成或失败后，主进程会更新本地 `session.json`，并通过 `session-records:changed` 通知会议记录列表和详情页刷新。

默认复用翻译侧的 DeepSeek 配置：

```powershell
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
```

如需给复盘摘要单独指定模型，可覆盖：

```powershell
ECHOSYNC_SESSION_SUMMARY_API_KEY=
ECHOSYNC_SESSION_SUMMARY_BASE_URL=
ECHOSYNC_SESSION_SUMMARY_MODEL=
```

摘要输出会写入 `summary.status/text/keywords/actionItems/topics/risks/terminologySuggestions`。未配置密钥或模型请求失败时，状态会更新为 `failed`，复盘页仍可查看完整双语记录和原始音频。

4. 观察 Python 日志：

- `audio_stream_started`：桌面端已开始送系统音频。
- `wasapi_sidecar_started / wasapi_capture_metrics`：Windows 原生采集 sidecar 的启动和每秒聚合指标，包含 `capture_mode`、目标进程、回调间隔、重采样耗时、编码耗时和 stdout 写入耗时，用于拆分采集端延迟。
- `audio_chunk_received`：实时 PCM chunk 已进入 Agent。
- `audio_stream_metrics`：Agent 每秒聚合打印音频帧、音频毫秒数、字节数、传输延迟和队列深度。
- `audio_stream_final_marker`：Desktop 音频门控检测到连续静音后发送 `audio.final` 控制消息，Agent 将其转为空 PCM 的 `is_final=True` frame，用于 flush ASR cache。
- `funasr_inference_chunk`：FunASR 每次模型推理的真实窗口，包含 `input_audio_ms`、`transport_frames`、`final`、`latency_ms`、`rtf`，用于证明 80ms 传输帧没有被直接变成 80ms 模型调用。
- `funasr_semantic_boundary`：FunASR 遇到 soft endpoint、hard endpoint 或 stream end 时打印，包含 `boundary`、`active_audio_ms`、`overlap_ms` 和当前 chunk 时间范围。
- `deepgram_result`：Deepgram Streaming STT 返回识别事件时打印，包含 `is_final`、`speech_final`、confidence 和文本长度；`is_final=true` 会更新当前 utterance buffer，`speech_final=true` 会被映射为 ASR endpoint final。
- `translation_checkpoint_skipped`：跳过不稳定翻译 checkpoint 时出现；`reason=partial_disabled` 表示默认不翻 partial，`reason=simul_wait` 表示 Simul 策略认为 stable 尾部仍悬空。
- `translation_checkpoint_started / first_token / finished`：请求级翻译耗时日志，包含 `translation_queue_wait_ms`、首 token 和最终耗时，是判断 DeepSeek 调度是否变快的主要依据。
- `tts_synthesis_started / first_audio / finished`：TTS 旁路耗时日志，分别定位 provider 启动、首个音频包和完整合成耗时；`tts_synthesis_failed` 用于发现 provider 或网络失败。
- `caption_event_published`：ASR/翻译后的字幕事件已推给桌面端，并带 `published_at_ms` 与模型指标；`transcript.partial` 是源文草稿，`translation.partial` 是译文更新。
- `python -m echosync_agent.diagnostics.realtime_log_summary <log>` 或 `echosync-log-summary <log>`：离线汇总真实测评日志，统计音频传输、ASR 队列、FunASR RTF、翻译请求、跳过原因、`simul_wait`、DeepSeek 首 token、TTS 首音和总合成分布。
- `python -m echosync_agent.diagnostics.translation_strategy_benchmark`：可重复的合成调度基准，用固定延迟 fake translator 对比“旧式 partial/stable 都翻”和“当前 partial 默认不翻 + Simul wait”的请求数、跳过数和估算请求工作量。这个脚本只能证明调度压力变化，不能替代真实 DeepSeek/ElevenLabs 网络 A/B。
- `python -m echosync_agent.diagnostics.real_agent_translation_benchmark .\vido\videoplayback.mp4 --duration-ms 30000 --asr-provider deepgram --translator-provider deepseek --log-file .tmp\agent-ab.log`：真正走 Agent 组件的翻译 A/B。默认按真实音频时间送媒体 frame，记录真实 ASR provider（FunASR、Voxtral 或 Deepgram）+ `TranscriptAssembler` 产出的 transcript 到达时间，再用同一批 transcript 按到达节奏分别回放给旧式调度和当前调度，两边都真实调用 DeepSeek。可用 `--order current-old` 反转顺序排查网络波动和 provider cache 偏差。

截至 2026-06-06，仓库中可检索到的 desktop/web 日志没有 Agent 请求级 `translation_checkpoint_started / first_token / finished` 记录；用现有日志汇总时 `translation_started=0`、`translation_first_token_ms=n:0`。因此当前不能宣称“真实 DeepSeek 翻译延迟已经低于之前版本”。已可量化的是策略基准：在 `first_token_ms=35ms,total_ms=90ms` 的合成 translator 下，`long_partial_then_committed` 和 `suspended_stable_tail_then_committed` 两个典型场景都从 2 次翻译请求降为 1 次，估算请求工作量从 180ms 降为 90ms；真实提升必须通过重定向 Agent 日志后再跑 `realtime_log_summary` 验证。

2026-06-06 已补真实 Agent paced A/B。样本为 `vido/videoplayback.mp4` 前 30 秒，`.env` 使用 `voxtral + deepseek-v4-flash`，翻译 A/B 保留 ASR transcript 到达节奏。两组顺序对照结果一致证明：当前策略把 DeepSeek 请求从 `20` 次降到 `17` 次，并跳过 `56-59` 个不稳定 checkpoint；但真实延迟没有稳定降低。`old-current` 顺序下 current 的首 token 平均 `698.2ms` vs old `714.3ms`，final 平均 `874.5ms` vs old `799.2ms`；`current-old` 顺序下 current 的首 token 平均 `773.7ms` vs old `622.7ms`，final 平均 `907.4ms` vs old `781.3ms`。所以当前可确认收益是“减少无效请求和回滚风险”，不能确认“翻译耗时更低”。

当前 Windows 系统声音已迁移到 WASAPI sidecar；麦克风和旧兼容采集路径仍使用 renderer 音频处理做快速验证，后续会替换为 `AudioWorklet`，以降低主线程抖动和长期运行风险。

当前 renderer 已加轻量门控：低于响度阈值时不发送音频块；活跃音频会立即以 80ms binary PCM frame 发送，不再为了 final 语义等待下一帧。连续静音后 renderer 发送 `audio.final` 控制消息，Agent 侧把它转成空 PCM 的 `is_final=True` frame，触发 FunASR flush/cache reset，避免静音时持续打满 ASR。字幕弹窗会显示当前片段时间范围。

实时热路径已做首轮算法优化：Desktop 真实链路使用 `audio.start` JSON 控制帧 + `pcm16.binary.v1` 二进制 PCM frame，目标帧长 80ms；音频门控使用分片队列减少样本重复拷贝，并把“音频正文发送”和“final/turn 边界”拆开，活跃音频不再承担一帧 lookahead。FunASR 适配器内部会把 80ms 传输帧聚合成推理窗口，`balanced` 默认使用 `FUNASR_CHUNK_MS=600ms`，`low_latency` 使用约 320ms，`accuracy` 使用约 900ms，避免低延迟传输强迫本地模型一帧一推理；遇到上游 endpoint final 会以 `is_final=True` flush 并重置 FunASR cache。Agent 已新增 `SemanticAudioChunker`，支持 soft cut、hard cut 和 overlap；FunASR 流式路径使用轻量 `SemanticEndpointTracker`，连续语音超过 hard timeout 时会强制 endpoint 并重置 cache，不等待说话人自然停顿；`LiveKitSileroFrameVadDetector` 已接入但默认关闭，作为后续 soft endpoint 调参实验。Voxtral 会按同一 `asr_latency_mode` 映射 `target_streaming_delay_ms`：`low_latency` 最多 480ms，`balanced` 沿用 `.env`，`accuracy` 至少 1600ms。ASR 分段维护增量文本避免高频 `join`，翻译 checkpoint 默认只处理 `stable/committed`，`partial` 只显示源文；新增的规则级 Simul 策略会把明显悬空的 stable 尾巴先 `WAIT`，避免把 “... the/of/to” 这类半句送进 DeepSeek。待翻译项仍按 `segment_id` 合并，降低模型慢响应时的队列积压。MP4/音频文件源使用 ffmpeg stdout 流式分帧，真实样本 `vido/videoplayback.mp4` 的首个 80ms PCM frame 约 40ms 产出，不再等待完整文件解码。旧 JSON `audio.chunk` / `pcm_base64` 仅作为兼容协议和部分测试路径保留。

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
