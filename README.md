# EchoSync

面向单向音频流的 AI 同声传译助手。产品目标是帮助用户实时理解英语或其他外语的演讲、技术分享、会议以及在线课程内容，通过实时翻译提供流畅的中文理解体验。

## 架构

EchoSync 当前初始化为一个小型 monorepo：

- `apps/desktop`：Electron Windows 桌面端，提供主控窗口、透明置顶悬浮字幕窗和桌面音频源 IPC 边界。
- `apps/web`：Next 15 听译工作台，用于音频采集入口、字幕渲染和后续会话 token 接口。
- `apps/agent`：Python 实时 Agent，用于 ASR、翻译、修正、字幕事件和可选 TTS。
- `doc/architecture-mvp.md`：MVP 架构、模块边界与开发路线图。

后端核心采用依赖倒置：

- 级联链路依赖 `Transcriber`、`Translator`、`CorrectionEngine`、`SubtitleSink` 等小接口，而不是依赖 FunASR、DeepSeek、edge-tts 或 LiveKit 的具体 SDK。
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

当前 Web 工作台已按 `doc/UI设计调研.md` 的 MVP 方向实现：

- 三栏工作台、剧场、阅读、紧凑悬浮四种模式。
- `interim`、`stable`、`revised`、`locked` 字幕状态展示。
- 实时字幕采用 interim hypothesis 策略：ASR 源文先持续吐字，约 1 秒形成一次翻译 checkpoint，DeepSeek 译文通过流式 token 增量更新，同一字幕行允许尾部修订。
- 模拟 `translation.partial`、`translation.patch`、`segment.commit` 事件流。
- 源文、术语、笔记、历史时间线和延迟指标面板。

当前 Desktop 地基已按 `doc/原型图.html` 的悬浮字幕方向升级：

- Electron 主控窗口使用无边框标题栏，负责音频源选择、字幕事件调试和悬浮窗控制。
- 独立悬浮字幕窗使用透明、无边框、置顶窗口，渲染毛玻璃字幕卡。
- 桌面音频源目录包含麦克风、Windows 系统声音、混音和文件回放。
- Windows 系统声音先声明为 `electron-display-media-loopback` 边界；稳定生产方案会在该边界后接 WASAPI loopback 原生适配器或独立采集 sidecar。

当前 Desktop UI 已按 Stateful Hybrid 主页控制中心推进：

- `Idle`：视频/网课默认开箱，主区提供起飞前音频电平校验和一键打开字幕弹窗。
- `Active`：主页切换为会话驾驶舱，展示最近转写、健康度、术语快加和自动滚动锁入口。
- `Finished`：会话结束后停留在复盘态，提供导出前快速清理、摘要指标和最近记录。
- 字幕弹窗采用 Layer A/B/C：默认穿透极简、Hover 轻控制、Pin 小型双语舞台，并支持快捷唤醒和召回居中。

## 文档与备注规范

所有 Markdown 文档、代码注释、Python docstring、配置样例说明都使用中文。技术标识、包名、类名、事件名、配置键名可保留英文，例如 `Next.js`、`LiveKit`、`AudioFrame`、`translation.patch`。

## 本地开发

- 推荐路径：`D:\code\echosync`，该目录位于 NTFS 分区，支持 Next/Node 构建所需的正常 `readlink` 行为。
- 推荐 Node：`20.19.0`，可通过 `nvm use` 读取 `.nvmrc` 切换。
- Python Agent 必须使用项目内 `.venv`，不要使用全局 Python。环境隔离、GPU 版 PyTorch、ModelScope 缓存位置见 `doc/agent-env.md`。
- Web 工作台：`npm run dev:web`
- Windows 桌面端：`npm run dev:desktop`
- 桌面端测试：`npm run test:desktop`

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
