# EchoSync

面向单向音频流的 AI 同声传译助手。产品目标是帮助用户实时理解英语或其他外语的演讲、技术分享、会议以及在线课程内容，通过实时翻译提供流畅的中文理解体验。

## 架构

EchoSync 当前初始化为一个小型 monorepo：

- `apps/web`：Next 15 听译工作台，用于音频采集入口和字幕渲染。
- `apps/agent`：Python 实时 Agent，用于 ASR、翻译、修正、字幕事件和可选 TTS。
- `doc/architecture-mvp.md`：MVP 架构、模块边界与开发路线图。

后端核心采用依赖倒置：管道依赖 `Transcriber`、`Translator`、`CorrectionEngine`、`SubtitleSink` 抽象接口，而不是依赖 FunASR、DeepSeek、edge-tts 或 LiveKit 的具体 SDK。

## 初始功能范围

- 捕获或接收单向音频流输入
- 对语音内容进行近实时转录
- 以低延迟将转录结果翻译为中文
- 以字幕形式展示翻译结果，并在后续支持可选的语音合成播报
- 当获得更多上下文信息时，自动修正先前的识别或翻译错误

## 当前状态

项目仓库已初始化，并完成 Next 15 + Python Agent 框架、提供商无关的实时管道契约、字幕事件协议和 fake 链路测试骨架。

当前 Desktop UI 正在按 Stateful Hybrid 主页控制中心推进：

- `Idle`：视频/网课默认开箱，起飞前音频电平校验。
- `Active`：最近转写、健康度、术语快加和自动滚动锁。
- `Finished`：会话复盘、导出前快速清理和最近记录。
- 字幕弹窗采用 Layer A/B/C：默认穿透极简、Hover 轻控制、Pin 小型双语舞台。

## 本地开发

- 推荐路径：`D:\code\echosync`，该目录位于 NTFS 分区，支持 Next/Node 构建所需的正常 `readlink` 行为。
- 推荐 Node：`20.19.0`，可通过 `nvm use` 读取 `.nvmrc` 切换。
