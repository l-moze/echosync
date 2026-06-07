# AI 同声传译助手需求分析与调研

## 题目理解

题目要求开发一款面向英语或其他外语内容的 AI 同声传译助手。核心不是“会议管理”或“会后纪要”，而是帮助用户在观看演讲、技术分享、国际会议、网课等单向音频内容时，实时理解信息。

产品必须满足四个关键约束：

- 接收单向音频流，而不是要求成为会议平台本身。
- 将外语语音实时、流畅地翻译成中文。
- 输出形态优先是字幕，语音播报可作为增强能力。
- 系统必须具备修正能力，能在后续上下文到达后纠正之前的识别或翻译错误。

因此 EchoSync 的产品定位应是：**跨应用的个人实时听译层**。它覆盖在用户正在使用的播放器、浏览器、会议软件或网课平台之上，降低语言门槛，而不是替代 Zoom、Teams、Google Meet 或专业同传平台。

## 真实用户场景

### 场景 1：观看英文技术分享或大会直播

用户在 YouTube、B 站搬运、官网直播、Zoom Webinar 或浏览器播放器中观看英文技术分享。核心痛点是演讲语速快、技术术语多、幻灯片节奏快，用户错过一句后很难追上。

真实需求：

- 首条字幕要快，最好 1 秒左右可读。
- 技术名词要稳定，例如模型名、框架名、公司名、产品名不能乱翻。
- 允许字幕短暂修订，但不能整屏跳动。
- 用户需要同时看到中文译文和可折叠英文原文，方便确认术语。

### 场景 2：观看国际会议、远程分享或线上研讨会

用户可能只是参会者，没有主持权限，也不一定能要求主办方开启字幕或翻译。平台内字幕常常受账号、语言、主持人设置和组织权限限制。

真实需求：

- 不依赖主办方开启字幕。
- 不依赖某一个会议平台。
- 能捕获电脑正在播放的系统声音。
- 字幕悬浮在任意应用上方，用户不用切换窗口。

### 场景 3：观看英文网课或录播课程

用户需要长时间学习，不只是“听懂当下”，还要回看、复制、摘录和导出。

真实需求：

- 字幕必须稳定可读，不能为了极低延迟牺牲理解。
- 需要时间线和历史片段，方便回到刚才没听懂的位置。
- 需要术语表和课程上下文，保持翻译一致。
- 需要会后导出原文、译文和修订后的字幕。

### 场景 4：希望用中文语音跟听，但仍保留字幕

部分用户希望像真正同传一样听中文播报，但 TTS 会增加延迟，也可能遮挡原声。

真实需求：

- MVP 不应把语音播报放在关键路径。
- 语音播报应可开关，并允许控制音量、语速和延迟。
- 字幕仍是主输出，因为字幕可回看、可修订、可校验。

## 竞品与行业做法

### 会议平台内置翻译字幕

Zoom、Microsoft Teams、Google Meet 都已支持实时翻译字幕，但它们主要服务自己的会议场景。

- Zoom Translated Captions 支持会议和 Webinar 中的实时翻译字幕，但需要特定套餐或 add-on，且语言由主机或管理员配置；Zoom 也提示翻译字幕可能不准确。[Zoom Support](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0059081)、[Zoom Blog](https://www.zoom.com/en/blog/translated-captions/)
- Teams live translated captions 属于 Teams Premium 或 Microsoft 365 Copilot 等许可能力，且会议 spoken language 必须设置正确；活动场景里组织者还会预选可用字幕语言。[Microsoft Teams Support](https://support.microsoft.com/pl-PL/teams/meetings/use-live-captions-in-microsoft-teams-meetings)
- Google Meet 提供 translated captions，用于把会议字幕翻译到指定语言。[Google Meet Help](https://support.google.com/meet/answer/10964115?co=GENIE.Platform%3DDesktop&hl=en)

结论：平台内置字幕验证了市场需求，但它们的弱点是平台绑定、权限绑定、主办方绑定。EchoSync 的机会是“用户自己能开、任意应用都能用”。

### 系统级实时字幕

Windows 11 Live Captions 能把通过 PC 的音频变成字幕，Copilot+ PC 上还支持翻译能力。微软强调其处理在本地完成，并能作为系统级浮窗跨应用显示。[Microsoft Windows Support](https://support.microsoft.com/en-US/accessibility/windows/use-live-captions-to-better-understand-audio)

结论：系统级字幕说明“跨应用浮窗”是正确方向。EchoSync 不能只做网页插件；Windows 桌面悬浮字幕是题目场景里的关键能力。区别在于 EchoSync 需要更强的中文翻译、术语表、修正窗口、多 ASR/翻译供应商和学习场景导出。

### 企业实时同传工具

DeepL Voice、Wordly、KUDO、Interprefy 等产品证明企业和活动场景愿意为实时翻译、字幕、语音输出、摘要和隐私付费。

- DeepL Voice for Meetings 面向 Teams 和 Zoom，强调实时翻译字幕，语音到语音翻译仍作为增强能力。[DeepL Voice](https://www.deepl.com/en/products/voice/deepl-voice-for-meetings)
- Wordly 提供实时翻译、字幕、音频、转录和摘要，覆盖线下、线上和混合会议活动。[Wordly](https://www.wordly.ai/real-time-translation)
- Interprefy 面向企业活动，提供远程同传、AI 语音翻译和实时字幕。[Interprefy](https://www.interprefy.com/)

结论：专业平台往往偏企业会议和活动组织方，EchoSync 更适合先做个人工具：用户自己开、自己听、自己控制术语和隐私。

### 流式 ASR 与字幕修正行业共识

实时字幕不是等一句话结束才显示，也不是每个 token 都永久提交。成熟 ASR 服务普遍有 interim/partial 与 final/stable 的概念。

- Google Cloud Speech-to-Text 的 streaming result 有 `isFinal` 和 `stability`，其中 interim result 可能变化，final result 不再为该段音频返回新假设。[Google Cloud Docs](https://docs.cloud.google.com/speech-to-text/docs/reference/rest/v2/StreamingRecognitionResult)
- Amazon Transcribe 支持 partial result stabilization，可标记词或标点是否 `Stable`，也建议用不同样式显示未稳定词。[AWS Docs](https://docs.aws.amazon.com/transcribe/latest/dg/streaming-partial-results.html)
- Azure Speech SDK 区分 `Recognizing` 和 `Recognized`，前者是会变化的中间估计，后者是最终识别结果。[Microsoft Learn](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/get-speech-recognition-results)
- Google Research 指出实时字幕的视觉不稳定会干扰观看体验，造成分心、疲劳和阅读困难。[Google Research](https://research.google/pubs/modeling-and-improving-text-stability-in-live-captions/)

结论：题目里的“修正能力”不能做成整段重翻、整屏刷新。正确设计是 interim 实时吐字、stable 短窗口稳定、patch 局部修正、commit 后锁定。

### 同声传译的延迟-质量权衡

同传系统天然有延迟与准确率的权衡。Mistral Voxtral Realtime 提供 `target_streaming_delay_ms`，通过等待更多上下文来提高准确率。[Mistral Docs](https://docs.mistral.ai/studio-api/audio/speech_to_text/realtime_transcription) 同声翻译研究工具 SimulEval 也把延迟指标作为评估核心，说明不能只看 BLEU/准确率，还要看系统何时输出。[Meta AI Research](https://ai.meta.com/research/publications/simuleval-an-evaluation-toolkit-for-simultaneous-translation/)

结论：EchoSync 应提供模式选择，而不是一个固定策略：

- 低延迟模式：适合直播和会议跟听。
- 平衡模式：适合技术分享，约 1 秒稳定检查点。
- 准确优先模式：适合录播网课或复盘导出。

## 用户需求优先级

### P0：必须有

1. Windows 系统音频输入

用户需要听译任何正在播放的内容，包括浏览器、播放器、会议软件和网课应用。因此系统声音采集是 P0，不应只支持麦克风。

2. 实时中文字幕

核心体验是中文可读字幕。译文应该优先于原文显示，原文可折叠或次级展示。

3. 流式输出和打字机体验

用户不能等整句结束。源文和译文都应渐进出现，但需要合帧，避免一字一刷。

4. 可修正字幕状态机

至少支持：

- `partial`：临时内容，可被替换。
- `stable`：短窗口内相对稳定，可显示为主字幕。
- `revised`：收到局部修订，高亮变化短语。
- `committed`：锁定片段，不再自动改动。

5. 术语表

技术演讲里，术语准确性常比普通语句流畅度更重要。MVP 至少要支持 CSV 术语表，影响翻译 prompt 和后续修正。

6. 延迟与健康状态可见

用户需要知道系统是在“听不到音频”“ASR 慢”“翻译慢”还是“网络断了”。因此主控窗口要显示音频电平、连接状态、首字幕延迟、稳定提交延迟和错误原因。

### P1：重要但可第二阶段

1. 译文语音播报

语音形式符合题目要求，但它会增加延迟和复杂度。建议作为可选增强，不阻塞字幕 MVP。

2. 历史时间线和导出

网课和技术分享用户需要复盘，可导出 SRT、Markdown 或双语文本。

3. 文件回放测试

支持用户拖入视频或音频文件进行离线/准实时听译，有助于评估质量和演示。

4. 多 ASR / 翻译供应商选择

不同内容、网络和成本环境下供应商表现不同。系统应保留 FunASR、Voxtral、托管 ASR、DeepSeek、专用翻译 API 的适配边界。

MVP 的多 ASR 选择不应让前端持有供应商密钥。前端只声明本次会话的 provider 和延迟模式，服务端根据 `.env` 中已启用的 provider 创建适配器。低延迟/准确率优先级建议是：FunASR 本地兜底、Voxtral 云端英语技术内容、Deepgram 作为已接入的云端 streaming ASR 备选；Azure 作为下一批候选。Deepgram Voice Agent / OpenAI Realtime 更适合端到端语音同传候选，不应混入当前 ASR-only provider 抽象。

### P2：后续增强

1. 说话人分离

国际会议或多人 Q&A 有价值，但单向演讲和网课不是第一优先级。

2. 会后摘要与会议纪要

可从转录历史自然延伸，但不是题目主需求。当前不应抢走实时听译资源。

3. Agent 记忆

可以用于术语、用户偏好和课程上下文，但应建立在稳定字幕链路之后。

4. 企业协作和权限系统

适合商业化阶段，不适合 MVP。

## 推荐 MVP 产品方案

### MVP 一句话

用户打开 EchoSync，选择“Windows 系统声音”，播放英文演讲或网课，悬浮窗实时显示中文字幕；字幕先快速出现，再在 1-2 秒内小范围修正，用户能看到原文、术语命中和延迟状态。

### 核心用户流程

```text
打开 EchoSync
  -> 选择场景：视频/网课、技术分享、国际会议
  -> 选择音频源：Windows 系统声音
  -> 选择源语言/目标语言：英语 -> 中文
  -> 启动同传
  -> 悬浮字幕窗显示实时译文
  -> 后端持续 ASR、翻译、局部修正
  -> 用户可查看原文、术语、延迟、历史
  -> 停止后导出双语字幕或文本
```

### 输出体验

字幕显示应遵循三个原则：

- 优先显示中文，不让英文抢阅读注意力。
- 未稳定内容使用弱样式，稳定内容使用强样式。
- 修正只高亮变化短语，不能整行闪烁。

推荐显示策略：

```text
翻译字幕：中文译文，作为视觉主行，最多 2 行
主字幕/原文主轨：英文原文，默认较小或可隐藏
状态：只进入主页驾驶舱、日志和导出诊断，不在字幕弹窗显示“已锁定”等工程标签
错误：明确显示是音频、ASR、翻译还是连接问题
```

字幕弹窗的主体验应使用“逐句对照 / 分区对照”两种双语形态。源文固定在上，译文固定在下；译文可以异步慢半拍到达，但不能显示“正在翻译...”占位，也不能因为 `segment.commit` 立刻把上一句推入历史。

### 修正策略

MVP 不需要复杂 LLM 全局纠错，先做可解释的小窗口策略：

```text
ASR partial 先显示源文草稿
每约 800-1200 ms 形成 stable checkpoint
翻译 stable checkpoint，流式输出中文
若后续 ASR 修正最近 1-2 个片段，则重新翻译该窗口
只输出 translation.patch，不重绘旧字幕
超过窗口或段落结束后 segment.commit 锁定
```

这样既满足“自动纠正之前错误”，也避免字幕频繁抖动。

### 延迟目标

MVP 应以体感指标为准：

| 指标 | 目标 | 说明 |
|---|---:|---|
| 音频输入到后端 | 100-250 ms | Windows 本地链路应尽量稳定 |
| 首个源文 partial | 500-1200 ms | 取决于 ASR |
| 首个中文可读字幕 | 900-1800 ms | 题目体验的关键指标 |
| stable 提交 | 1500-3000 ms | 允许修正窗口 |
| 修订补丁延迟 | 300-1000 ms | 只作用于最近片段 |

低于 500 ms 的全链路中文同传可以作为研发目标，但不应作为 MVP 承诺。对技术内容来说，1 秒左右的稳定上下文通常比极限低延迟更可用。

## 功能边界

### MVP 做

- Windows 系统声音采集。
- 真实 ASR provider：FunASR 或 Voxtral 至少一个可跑通。
- DeepSeek 或兼容 OpenAI 的流式翻译。
- 悬浮字幕窗。
- 源文 partial、译文 partial、局部 patch、最终 commit。
- 术语表。
- 基础延迟与错误日志。
- 真实视频 + 字幕样本的定性评估。

### MVP 不做

- 不做会议机器人入会。
- 不做完整会议纪要和 Agent 记忆。
- 不做复杂多人说话人分离。
- 不做企业权限、团队空间、CRM、任务同步。
- 不把 TTS 放进关键路径。
- 不承诺专业人工同传级准确率。

## EchoSync 的差异化

1. 跨应用

平台内字幕只在自己的会议系统里工作。EchoSync 通过 Windows 系统音频和悬浮窗覆盖任意应用。

2. 个人可控

用户不需要主持人开权限，也不需要企业管理员配置。

3. 字幕优先且可修正

不是等完整句子，也不是一字乱跳，而是有状态机和小窗口修订。

4. 技术内容友好

术语表、原文对照、历史回看、导出，是技术分享和网课场景的刚需。

5. 供应商可替换

ASR、翻译、修正、TTS 分层，方便测试 FunASR、Voxtral、Deepgram、Azure、DeepL、OpenAI Realtime 等不同方案。

## 评估方法

不要一开始做复杂测评平台。先用真实视频做小样本评估：

- 选 3 段英文技术分享或网课，每段 3-5 分钟。
- 用人工字幕或官方字幕作为参考。
- 记录首字幕延迟、稳定提交延迟、修订次数、明显错译数、术语错误数。
- 人工打分：能否跟上节奏、术语是否可接受、字幕是否抖动、错了是否能修回来。

推荐最小评分表：

| 维度 | 分数 | 说明 |
|---|---:|---|
| 跟读节奏 | 1-5 | 是否能不暂停内容跟上 |
| 译文可懂 | 1-5 | 是否保留核心信息 |
| 术语准确 | 1-5 | 技术名词是否稳定 |
| 字幕稳定 | 1-5 | 是否频繁闪烁或回退 |
| 修正可接受 | 1-5 | 修正是否帮助理解而非干扰 |

## 需求结论

这个题目的最佳 MVP 不是“万能 AI 会议助手”，而是一个可靠的个人实时听译工具：

```text
任意外语音频
  -> 实时 ASR
  -> 增量翻译
  -> 小窗口修正
  -> 中文悬浮字幕
  -> 可选语音播报和会后导出
```

优先级应非常明确：

1. 先把系统音频到中文字幕的真实链路跑顺。
2. 再把字幕稳定性和修正体验做好。
3. 再加入术语、导出和评估。
4. 最后才考虑 TTS、会议纪要和 Agent 记忆。

一句话：**实时听译的护城河不是“能翻译”，而是跨应用、低延迟、字幕稳定、可修正、技术术语可靠。**
