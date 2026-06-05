# 实时低延迟翻译与修订流设计

## 背景

EchoSync 当前已经走“字幕优先、级联管道、事件流输出”的方向，但实时体验还缺一个统一的热路径策略：ASR、翻译器、字幕 store 都各自用阈值处理流式文本，容易继续演化成散落补丁。用户能感知到的问题是：流式模型按 token 或中文单字吐出时，字幕会一字一刷；而当系统为了避免一字一刷过度缓存时，又会牺牲低延迟。

本设计把实时同传拆成两条时间线：

- **即时线**：尽快显示可读短语，目标是让用户在 0.8-1.6 秒内看到第一条可读译文。
- **修订线**：允许最近 1-3 个片段在后续 1-2 秒内被模型修正，然后锁定，避免旧字幕反复变化。

## 调研结论

成熟实时 ASR/同传系统不会把每个 token 直接交给 UI。它们通常同时使用 interim/final、stability、partial stabilization、endpointing 和 bounded revision window。

- Amazon Transcribe 的 partial result stabilization 会限制只有最后少量词可变，并通过 `Stable` 字段暴露词级稳定性，适合低延迟字幕场景。参考：<https://docs.aws.amazon.com/transcribe/latest/dg/streaming-partial-results.html>
- Google Cloud StreamingRecognitionResult 明确区分 `isFinal` 和 interim 的 `stability`，说明 UI 应该把“不稳定但可显示”的内容与最终提交内容分开。参考：<https://docs.cloud.google.com/speech-to-text/docs/reference/rest/v2/StreamingRecognitionResult>
- Deepgram 同时提供 `is_final` 与 `speech_final`，把“文本已定稿”和“说话人是否暂停”拆开，适合下游翻译调度。参考：<https://developers.deepgram.com/docs/understand-endpointing-interim-results>
- Whisper-Streaming 使用 LocalAgreement：连续多次解码结果一致的前缀才确认，避免直接相信最后一个 hypothesis。参考：<https://arxiv.org/abs/2307.14743> 与 <https://github.com/ufal/whisper_streaming>
- Meta SeamlessStreaming 证明端到端 simultaneous speech/text translation 可行，但对 EchoSync 首版来说，级联方案更可控，术语表、补丁修订和 UI 可解释性更强。参考：<https://arxiv.org/abs/2312.05187>
- OpenAI Realtime transcription 支持 WebSocket/WebRTC、VAD 和转写 session，但官方也强调转写完成事件可能异步到达，客户端必须用 item/session id 维护顺序。参考：<https://platform.openai.com/docs/guides/realtime-transcription>

## 目标

- 译文层不再显示中文单字级抖动；源文层保留实时打字机反馈。
- 翻译流仍然保留低延迟：不用等完整句子才显示。
- 最近窗口可修订，旧片段必须锁定。
- ASR、翻译、UI store 的文本发射规则有统一抽象，不继续复制阈值逻辑。
- 后续可接 LocalAgreement、LLM revision patch、置信度/不确定性指标，而不推翻现有事件协议。

## 非目标

- 不在本阶段替换 FunASR、Voxtral 或 DeepSeek 供应商。
- 不在本阶段实现完整 token 级置信度 UI。
- 不在本阶段把所有旧事件协议重命名；继续兼容 `translation.partial`、`translation.patch`、`segment.commit`。
- 不在本阶段实现端到端 speech-to-speech 翻译。

## 推荐架构

```text
AudioFrame
  -> VAD / audio gate
  -> Transcriber.stream()
  -> TranscriptAssembler
       - source hypothesis coalescing
       - future: LocalAgreement stable prefix
       - meaning-unit checkpoint
  -> TranslationScheduler
       - latest revision wins
       - checkpoint coalescing
  -> Translator.stream_translate()
       - target emission policy
       - glossary prompt
  -> RevisionEngine
       - recent 1-3 segments only
       - structured patch operations
  -> EventSubtitleSink
  -> Desktop caption-store
```

关键边界：

- `TranscriptAssembler` 只负责 ASR hypothesis 到 `partial/stable/committed` 的源文片段，不直接关心 UI。
- `TextEmissionPolicy` 负责“下一次译文是否值得发给字幕层”，包括译文短增量合并、标点 flush、最终 flush 和改写 flush；源文 partial 优先实时展示。
- `CascadedInterpretationEngine` 负责并发调度和 checkpoint 合并，保证源文 hypothesis 不被慢翻译阻塞。
- `RevisionWindowCorrectionEngine` 只允许近期片段产生 patch，锁定片段不能再被自动修改。
- `caption-store` 负责保留和渲染 Agent 已发布的最新 snapshot，不再二次语义合帧；主要防线在 Agent 输出侧。

## 文本发射策略

### 源文 ASR

源文可以比译文更激进，优先保持打字机反馈：

- 英文/拉丁文本按词或短语到达时立即显示。
- 纯 CJK 单字 delta 也允许累计文本逐步显示，后续由 stable/commit 修订。
- 标点、stable checkpoint、committed 立即发。
- 后续 LocalAgreement 会把“稳定前缀”和“可变尾巴”分开，UI 只弱化可变尾巴。

### 译文

译文必须按可读短语发射：

- 首次译文至少 6 个可见字符，或遇到明显标点。
- 后续增量至少 6 个可见字符，或遇到明显标点。
- 如果模型不是追加，而是重写前文，立即发射；这属于 revision 信号，不能被短 delta 阈值吞掉。
- stream 结束时强制发射最终译文。

## 修订模型

字幕生命周期：

```text
Interim -> Stable -> Revised -> Locked
```

工程含义：

- `Interim`：ASR/翻译假设，可完全替换，不写入最终历史。
- `Stable`：可读 checkpoint，允许最近窗口小范围 patch。
- `Revised`：收到补丁后短暂高亮，1.5-2 秒后视觉衰减回 Stable。
- `Locked`：commit、超时、用户固定或导出后锁定，不再自动改写。

修订窗口策略：

- 默认只开放最近 2 个 segment。
- LLM 修订只返回结构化 patch，不返回整屏文本。
- patch 必须包含 `base_rev`，前端只能应用到匹配 revision 的行。
- 若 patch 到达时目标行已 locked 或 revision 已更新，必须丢弃。

## 延迟预算

| 阶段 | 目标 |
| --- | ---: |
| 音频采集与封包 | 40-80 ms |
| 上行传输 | 20-100 ms |
| VAD/endpointing | 80-250 ms |
| ASR hypothesis | 200-700 ms |
| meaning-unit checkpoint | 600-1200 ms |
| 首次译文可读短语 | 800-1600 ms |
| LLM 修订 patch | +1000-2200 ms |
| 最终锁定 | 2500-4500 ms |

## 第一阶段实现范围

第一阶段只做低风险热路径整理：

- 新增 `services/realtime/text_emission_policy.py`。
- `TranscriptAssembler` 使用该策略保持源文 partial 实时输出，并把 weak boundary 作为 stable checkpoint。
- `DeepSeekTranslator` 使用同一策略决定是否 flush streaming target。
- 保留现有 public helper `should_flush_streaming_target()`，避免测试和调用方大改。
- 增加单元测试覆盖源文 CJK 累计输出、译文短增量合并、标点/final/rewrite flush。

## 后续阶段

- 阶段 2：实现 LocalAgreement buffer，比较连续 hypothesis 的最长公共稳定前缀。
- 阶段 3：新增 `MeaningUnitSegmenter`，按时间、标点、语义边界和 source language 自适应 checkpoint。
- 阶段 4：实现 LLM revision engine，只修最近 1-3 个 segment，并输出 structured patch。
- 阶段 5：增加指标：`first_subtitle_latency_ms`、`stable_latency_ms`、`patch_rate`、`rewrite_chars`、`locked_patch_drop_count`。
