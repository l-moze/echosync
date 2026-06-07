# Agent 能力发现与启动预检设计

## 背景

EchoSync 已经支持在 `audio.start` 中声明 `asr_provider`、`asr_latency_mode` 和 `translation_provider`，Agent 也会做 session 级 override。但 Desktop 仍缺少启动前能力发现：用户不知道后端默认 provider 是什么、密钥和 SDK 是否齐全、真实 PCM 音频能否被当前 ASR 处理。

## 目标

- Desktop 在开始采集音频前先读取 Agent 能力，避免先开媒体流再失败。
- 前端 UI 能选择 ASR provider、ASR 延迟模式、翻译 provider 和可选 TTS provider。
- 设置页直接使用 Agent capabilities 禁用不可用 provider，并通过 hover title 展示缺 key、缺依赖或不支持真实音频的原因。
- `server-default` 保留后端 `.env` 默认语义；客户端只传显式选择，不传密钥。
- 后端暴露 provider readiness，但不泄漏 API key。
- 文档统一：当前真实桌面链路使用 `8766`，`mock` 只适合事件演示。

## 非目标

- 该设计起草时不在本阶段接入 Deepgram、Azure、OpenAI Realtime 或新的云 ASR；当前实现已补充 `deepgram` Streaming STT provider，Azure 和端到端语音 Agent 仍不在本设计范围。
- 不在本阶段迁移 AudioWorklet。
- 不在本阶段实现文件回放和混音的生产级入口。

## 架构

```text
Agent /v1/realtime/capabilities
  -> 当前默认配置
  -> ASR provider readiness
  -> 翻译 provider readiness
  -> TTS provider readiness
  -> ASR latency modes

Desktop main/preload
  -> agent:get-capabilities

Renderer
  -> 启动前 refresh capabilities
  -> settings panel disables unavailable provider choices
  -> validate selected source/provider
  -> createRealtimeAudioClient({ asrProvider, asrLatencyMode, translationProvider, ttsProvider })
```

## Provider 状态

Provider readiness 使用小而稳定的状态集合：

- `ready`：依赖和配置满足。
- `missing_key`：缺少所需后端环境变量。
- `missing_dependency`：缺少 SDK 或本地依赖。
- `unavailable`：当前只是候选或不适合该音频源。

`mock` ASR 永远可用于演示，但 `real_audio_supported=false`。真实 PCM 音频源（Windows 系统声、麦克风、文件、混音）不能用 `mock` ASR 进入同传。

FunASR 的 readiness 必须覆盖实际运行时导入链：`funasr`、`modelscope`、`torch` 都可发现才算 `ready`。缺少 `torch` 时不能等到实时音频已经开始后再由模型懒加载失败；Agent capabilities 应返回 `missing_dependency`，Desktop preflight 直接阻止启动并展示后端 `reason`。

Deepgram 的 readiness 必须覆盖 `DEEPGRAM_API_KEY` 和 `websockets` 依赖。Desktop 只展示 provider 状态和模型名，不接触 API key；真实会话通过 `audio.start.asr_provider="deepgram"` 选择后端 `.env` 中的 Deepgram 配置。

`server-default` 在 UI 中仍显示为“自动”，但可用性要解析到 Agent 返回的默认 provider；例如后端默认是 Deepgram 且缺少 `DEEPGRAM_API_KEY` 时，“自动”也必须禁用并显示同一原因。显式 provider 选择同理：ASR、翻译和 TTS 都不在 renderer 中保存密钥，只消费 capabilities 的 `available/reason/model`。

## 测试要求

- 后端 capabilities 能反映默认 provider、缺 key、缺依赖和 real audio 支持。
- HTTP endpoint 返回 capabilities JSON。
- 前端 preflight 能阻止 mock + 真实音频、缺 key provider、未实现音频源和后端不支持的 ASR 延迟模式。
- 设置面板在开始会话前禁用不可用 provider 选项，并展示后端返回的 `reason`。
- renderer 启动 realtime client 时传入显式 ASR provider、延迟模式、翻译 provider 和 TTS provider。
- 文档中不再出现“前端默认强制 funasr”的口径。
