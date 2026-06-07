# Agent → Desktop 字幕链路审计

## 链路全貌

```
┌─────────────────────────────────────────────────────────────────┐
│ Agent (Python)                                                   │
│                                                                  │
│  /v1/realtime/sessions/{session_id}                              │
│    Desktop 发送 audio.start + pcm16.binary.v1 binary frame       │
│    静音边界用 audio.final JSON 控制帧表达                         │
│    → AudioFrame                                                  │
│    → MockTranscriber / FunASR / Voxtral → TranscriptSegment      │
│    → MockTranslator / DeepSeek → TranslationSegment              │
│    → EventSubtitleSink → InMemoryEventBus                        │
│    → CaptionEventHub.publish() → ws.send_json()                  │
│                                                                  │
│  /v1/caption/events                                              │
│    Desktop 被动连接，接收字幕事件                                 │
│    可选 producer=run_demo_caption_pipeline → UI 演示用 mock 流   │
└─────────────────────────────────────────────────────────────────┘
                            ↓ WebSocket ws://127.0.0.1:8766
┌─────────────────────────────────────────────────────────────────┐
│ Desktop (Electron)                                               │
│                                                                  │
│  main.ts: captionWs = new WebSocket(CAPTION_WS_URL)             │
│    ws.on("message") → JSON.parse → broadcastCaptionEvent()      │
│    → webContents.send("caption:event", event)                    │
│                                                                  │
│  renderer/main.tsx:                                              │
│    window.echosyncDesktop?.onRealtimeEvent((event) => {          │
│      setLines((current) => applyRealtimeEvent(current, event));  │
│    })                                                            │
│                                                                  │
│  shared/caption-store.ts:                                        │
│    applyRealtimeEvent(lines, event) → 更新 CaptionLine[]         │
│                                                                  │
│  OverlayWindow: activeLine?.targetText → 渲染字幕                 │
└─────────────────────────────────────────────────────────────────┘
```

## 当前状态

当前 Desktop 已经不只是被动接收 `/v1/caption/events`。renderer 会在开始同传前通过主进程读取 Agent `/v1/realtime/capabilities`，确认默认 provider、密钥和 SDK 状态；通过预检后才采集音频，发送 JSON 控制帧 `audio.start`，声明 `asr_latency_mode`、采样率和源信息；只有用户显式选择 provider 时才声明 `asr_provider`、`translation_provider` 或 `tts_provider`。随后音频正文会转成 `pcm16.binary.v1` 二进制 WebSocket frame 发送到 `/v1/realtime/sessions/{session_id}`；连续静音达到门控阈值后，renderer 发送 `audio.final` JSON 控制帧，Agent 将其转成空 PCM 的 `is_final=True` frame，触发 ASR flush/cache reset。Agent 再通过同一个 `CaptionEventHub` 推字幕事件，启用语音播报时还会旁路推送 `tts.audio`。

后端仍兼容旧 JSON `audio.chunk` / `pcm_base64`，主要用于旧测试、纯 ASR 调试和过渡期兼容；当前 Desktop 真实链路默认不走 base64 JSON。

仍需注意：默认 `mock` ASR 只适合文本帧演示。真实 PCM 音频必须使用 `funasr`、`voxtral` 或 `deepgram`，否则 Desktop preflight 会先拦截；如果绕过 preflight，Agent 仍会在启动 pipeline 前返回 `realtime.error` 并结束会话。FunASR readiness 按真实导入链检查 `funasr`、`modelscope` 和 `torch`，Voxtral 检查 `MISTRAL_API_KEY` 和 `mistralai`，Deepgram 检查 `DEEPGRAM_API_KEY` 和 `websockets`，不会等音频流启动后才懒加载失败。`audio.start.asr_provider`、`audio.start.translation_provider` 和 `audio.start.tts_provider` 可以做会话级切换；未发送时沿用 Agent 端 `.env`。密钥、voice id 和模型配置仍来自 Agent 端 `.env`。

`8765` 与 `8766` 的边界：

```text
8765 /v1/asr/sessions/{session_id}       # 纯 ASR 调试，只返回 asr.segment
8766 /healthz                            # Agent 健康检查
8766 /v1/realtime/capabilities           # provider/default/依赖状态
8766 /v1/realtime/sessions/{session_id}  # 完整同传输入
8766 /v1/caption/events                  # 完整同传输出
```

## 真实 MP4 场景延迟复盘

本轮使用仓库中的真实视频样本做复盘，不再只看配置或 mock 文本：

```text
视频：vido/videoplayback.mp4
大小：46,236,680 bytes
字幕参考：vido/I speak English at native speed.srt
内容：英语母语速度口播视频，适合作为“网课/英语演讲”场景样本。
```

### 已测数据

在 `D:\code\echosync` 使用仓库 `.venv` 执行：

```powershell
@'
import asyncio
import time
from echosync_agent.services.media import MediaAudioSource

async def main():
    source = MediaAudioSource(
        "vido/videoplayback.mp4",
        session_id="sess_video_probe",
        source_lang="en",
        chunk_ms=80,
    )
    started = time.perf_counter()
    count = 0
    async for frame in source.frames():
        count += 1
        wall_ms = (time.perf_counter() - started) * 1000
        print(f"frame={count} wall_ms={wall_ms:.1f} audio={frame.start_ms}-{frame.end_ms}")
        if count >= 10:
            break

asyncio.run(main())
'@ | .venv\Scripts\python.exe -
```

实测输出摘要：

| 节点 | 结果 | 结论 |
|------|------|------|
| 旧整文件 PCM 抽取 | `full_decode_ms=407.0`，`audio_ms=515204` | 如果先 `communicate()` 完整文件，首帧至少被整段解码阻塞约 407ms。 |
| 新流式 ffmpeg 分帧 | 首个 80ms frame 约 `40.5ms` 产出，前 10 帧约 `40.9ms` 内产出 | 文件复盘链路的首帧不再等待完整 MP4 解码，首帧阻塞下降约 360ms。 |
| 80ms PCM frame | 每帧 `2560 bytes` | 与 Desktop `pcm16.binary.v1` 的 16k/mono/PCM16/80ms 传输帧对齐。 |

这说明当前真实 MP4 链路里，媒体解码/分帧不应再是主延迟瓶颈；后续延迟主要看 ASR 模型等待窗口、ASR 推理/云端首 delta、翻译首 token 和字幕显示策略。

### 二次复盘：SRT 语速与分段仿真

为了避免只看模型配置，本轮继续用同一真实视频的参考字幕做“伪 ASR delta”仿真。参考字幕文件：

```text
vido/I speak English at native speed.srt
```

样本统计：

| 指标 | 结果 | 含义 |
|------|------|------|
| 字幕条数 | `135` | 样本足够覆盖普通口播节奏。 |
| 单条字幕时长 | 平均 `3828ms`，P50 `3280ms`，P90 `7120ms`，最大 `11760ms` | 真实字幕常跨 3-7 秒，不能等完整字幕结束才翻译。 |
| 单条词数 | 平均 `11.2`，P50 `10`，P90 `20`，最大 `37` | 一条字幕通常是完整短句或从句，不是单词级显示。 |
| 字幕间隔 | 平均约 `0ms` | 口播基本连续，不能依赖长静音触发 flush。 |

用 SRT 内容按词模拟 ASR delta 后，`TranscriptAssembler` 的输出统计：

```text
outputs=362
partial=238
stable=101
committed=23
stable interval avg=1264ms
```

这说明 assembler 本身确实能生成较高频的 stable checkpoint。修复前，`CascadedInterpretationEngine` 使用 `stable_checkpoint_seen`，会让同一 `segment_id` 只翻译第一个 stable。用前 12 条 SRT 仿真时，实际翻译请求变成：

```text
stable      1360- 1828   text=Hello,
committed   1360-11188   text=Hello, my name is Eevee ...
stable     11190-12213   text=Feels funny to
committed  11190-17760   text=but this is the 100,000 subscriber special.
```

问题：长句会先翻译一个过短 stable，然后等 committed 才更新完整译文；如果句末标点或最终段很晚，用户看到的译文会天然落后 3-9 秒。这和“字幕全部放到一块、翻译迟迟不显示”的体感一致。

同时，`HypothesisUpdatePolicy` 对英文“无前导空格的单词 delta”存在误判。以下本地探针可复现：

```text
current='Hello, my name is' incoming='Eevee'
-> mode=replace_hypothesis text='Eevee'

current='Feels funny to say that at normal speed,' incoming='but'
-> mode=replace_hypothesis text='but'
```

这会把应该追加的 ASR token 当成整段滚动 hypothesis 修订，导致前文被抹掉或字幕看起来“一词一词跳”。因此，当前首要瓶颈不仅是模型慢，也包括 ASR delta 合并算法和翻译 checkpoint 调度策略。

### 已落地的优化算法

1. **在线分片算法**

   `MediaAudioSource` 已从“先把整段 ffmpeg stdout 读完再切片”改为“边读 stdout 边用 `bytearray` 聚合到固定 frame size 后立即产出 `AudioFrame`”。

   ```text
   ffmpeg stdout bytes
     -> pending bytearray
     -> len(pending) >= frame_size 时产出 AudioFrame
     -> 剩余不足一帧的尾块在 EOF 时 final flush
   ```

   算法收益：首帧延迟从 `O(整段视频解码时间)` 降为 `O(ffmpeg 首块输出 + frame_ms)`；内存从 `O(整段音频 PCM)` 降为 `O(read_size + frame_size)`。对会议记录和录播课程复盘很关键。

2. **Voxtral 延迟模式映射**

   `audio.start.asr_latency_mode` 现在会真正影响 Voxtral 的 `target_streaming_delay_ms`：

   | 模式 | Voxtral target delay | 使用场景 |
   |------|----------------------|----------|
   | `low_latency` | 最多 `480ms`，最低不低于 `240ms` | 直播字幕、用户正在跟听内容 |
   | `balanced` | 沿用 `VOXTRAL_TARGET_DELAY_MS`，当前 `.env` 为 `1000ms` | 默认稳定字幕 |
   | `accuracy` | 至少 `1600ms` | 复盘、纪要、可接受时间差的高准确率模式 |

   根因：此前 Desktop 即使声明低延迟模式，Voxtral 工厂仍固定使用 `.env` 的 `VOXTRAL_TARGET_DELAY_MS=1000`，ASR 层天然背负约 1 秒等待下限。

3. **弱边界优先翻译 + latest-wins 合并**

   `TranscriptAssembler` 已把英文逗号、中文逗号、分号、冒号视为 `stable` checkpoint，而不是直接 `committed`。`CascadedInterpretationEngine` 已允许同一长段按“至少约 1 秒音频间隔 + 足够新增字符”刷新 stable 翻译，同时 pending 队列仍按 latest-wins 合并，避免慢翻译时积压一串过期修订。

   算法收益：字幕能在自然停顿处提前翻译；长句不再只翻译第一个过短 stable；同时避免“每个 token/每个小修订都进翻译模型”。

4. **ASR delta 合并的裸词补空格**

   `HypothesisUpdatePolicy` 已补上英文裸词 delta 追加逻辑。对于 `"Hello, my name is" + "Eevee"`、`"normal speed," + "but"` 这类供应商按词吐 delta 但不带前导空格的输出，会追加为自然英文短语，而不是误判为整段替换。

   算法收益：减少源文字幕“前文被抹掉”或“一词一词跳”的概率，并保留完整 rolling hypothesis 的替换能力。

5. **前端即时显示**

   `caption-display-buffer` 当前不再做字素级慢放。Agent 已经完成语义合并后，前端直接显示最新事件，避免“后端已经有句子，前端还一个字一个字吐”的二次延迟。

   2026-06-06 补充：悬浮字幕默认改为源文在上、译文在下；译文未返回时不再渲染“正在翻译...”占位。字幕文本左对齐，避免居中排版在流式增量到达时产生整体横向跳动。

6. **短语级译文发射**

   DeepSeek 流式译文仍在 Agent 侧合帧，但默认阈值从“首包/增量均 6 个可见字符”调整为“首包 4 个可见字符、增量 2 个可见字符”。这样能过滤 1 字 token 刷屏，同时允许“今天”“因此”这类短语级增量快速进入前端。

7. **stable-only DeepSeek 调度**

   `CascadedInterpretationEngine` 默认不再把 `partial` 送进翻译模型。`partial` 只负责源文实时吐字；DeepSeek 只处理 `stable/committed` checkpoint，避免半句话触发错译、Token 浪费和字幕回滚。低延迟实验仍可通过 `translate_partial_checkpoints=True` 显式打开，但不是默认主链路。
   2026-06-06 本轮补充：新增规则级 `SimulTranslationPolicy`，作为论文里 source/draft/policy 三流思想的应用层 MVP。它不增加额外 LLM 请求，只在调度前把明显悬空的 stable 尾巴先 `WAIT`，例如英文稳定文本以 `the/of/to/because/if` 等连接词结尾时，记录 `translation_checkpoint_skipped reason=simul_wait simul_reason=suspended_tail`，等待下一次 stable 或最终 committed 再翻译。

   ```text
   transcript.partial
     -> translation_checkpoint_skipped reason=partial_disabled
     -> transcript.stable
        -> translation_checkpoint_skipped reason=simul_wait  # 明显半句
     -> transcript.stable / transcript.committed
     -> translation.partial(稳定翻译)
     -> segment.commit(最终锁定)
   ```

   算法收益：在“长 partial 后接 committed”的典型场景里，默认翻译请求从 partial+committed 两次降为 committed 一次；在“stable 尾部仍是半句”的场景里，请求从 stable+committed 两次降为 committed 一次。对应测试可观测到 translator 只接收最终 committed 文本，并且日志会出现 `translation_checkpoint_skipped reason=simul_wait` 作为证据。

   2026-06-06 量化校正：当前仓库可检索到的 desktop/web 日志没有 Agent 请求级 `translation_checkpoint_started / first_token / finished`，运行 `realtime_log_summary` 得到 `translation_started=0`、`translation_first_token_ms=n:0`、`translation_latency_ms=n:0`。因此不能宣称真实 DeepSeek 翻译延迟已经下降。已补充 `translation_strategy_benchmark` 合成基准，只证明调度压力变化：在 fake translator `first_token_ms=35ms,total_ms=90ms` 下，`long_partial_then_committed` 从 2 次请求降为 1 次，估算请求工作量 180ms -> 90ms，committed 首个译文从约 150.3ms -> 51.1ms；`suspended_stable_tail_then_committed` 从 2 次请求降为 1 次，估算请求工作量 180ms -> 90ms，committed 首个译文从约 161.1ms -> 39.0ms。这个结果不是 DeepSeek 网络 A/B，只能作为策略基准。

   2026-06-06 真正 Agent paced A/B：新增 `real_agent_translation_benchmark`，默认按真实音频时间送媒体 frame，先用真实 `MediaAudioSource -> VoxtralRealtimeTranscriber -> TranscriptAssembler` 采集 assembled transcripts 和到达时间，再用同一批 transcript 按到达节奏分别回放给旧式调度和当前调度，两边都调用真实 `DeepSeekTranslator`。样本为 `vido/videoplayback.mp4` 前 30 秒，`.env` 为 `voxtral + deepseek-v4-flash`。

   | 顺序 | 策略 | DeepSeek 请求 | 跳过 checkpoint | simul_wait | 首 token avg / p95 | final avg / p95 | queue avg / p95 |
   |------|------|--------------:|----------------:|-----------:|-------------------:|----------------:|----------------:|
   | old -> current | old-like | 20 | 0 | 0 | 714.3 / 1300.1ms | 799.2 / 1443.3ms | 110.2 / 631.8ms |
   | old -> current | current | 17 | 59 | 4 | 698.2 / 1203.8ms | 874.5 / 1237.7ms | 129.6 / 926.6ms |
   | current -> old | current | 17 | 56 | 3 | 773.7 / 1350.8ms | 907.4 / 1510.2ms | 107.8 / 838.9ms |
   | current -> old | old-like | 20 | 0 | 0 | 622.7 / 1062.7ms | 781.3 / 1240.9ms | 80.6 / 696.7ms |

   结论：当前策略可以稳定减少 3 次 DeepSeek 请求，并跳过 56-59 个不稳定 checkpoint，减少半句翻译和 UI 回滚风险；但两组顺序对照不能证明真实翻译延迟下降。`old-current` 中 current 首 token 略快但 final 平均更慢；`current-old` 中 current 首 token 和 final 都更慢。后续优化不能再声称“翻译耗时降低”，除非新的 Agent paced A/B 在反转顺序后仍稳定降低 `translation_first_token_ms` 和 `translation_latency_ms`。

   2026-06-07 追加质量修正：真实英语输入中出现过 `... a spatial reasoning tasks` 被翻成“新的空间推理”，漏掉尾部 head noun `tasks`。根因不是前端展示，而是后端翻译 prompt 过度强调 concise，且 DeepSeek prefix completion 可能把上一版已句末闭合的译文前缀固定住，导致后续追加名词只能生硬补在句号后。后端已把提示词改为“compact but do not summarize/drop/merge semantic content”，明确保留 final content words / head nouns，并在旧源文未句末闭合但旧译文已闭合时禁用 prefix completion，让 committed/stable 新版本走完整重译。

8. **SemanticChunker + FunASR endpoint cache reset**

   `services/asr/semantic_chunker.py` 已提供第一版 `SemanticAudioChunker`：支持 soft endpoint、hard cut 和 hard cut 后保留 overlap。这个完整 chunker 适合未来 batch ASR 或非流式模型。

   FunASR 是流式 ASR，不应该为了等待完整语义块牺牲现有 320/600/900ms 推理窗口。因此 FunASR 接的是同文件里的 `SemanticEndpointTracker`：它不缓存音频，只在上游 `is_final=true`、可选 `LiveKitSileroFrameVadDetector` 判定连续静音达到阈值，或连续语音超过 hard timeout 时，把当前 frame 标记为 final，触发 FunASR flush 和 cache reset。每次推理都会打印：

   ```text
   funasr_inference_chunk session_id=... start_ms=... end_ms=...
     input_audio_ms=... transport_frames=... final=... semantic_boundary=...
     latency_ms=... rtf=... text_chars=...

   funasr_semantic_boundary session_id=...
     boundary=soft|hard|stream_end active_audio_ms=... overlap_ms=...
   ```

   算法收益：80ms 传输帧仍保持实时上行，但 FunASR 推理窗口继续按 320/600/900ms 聚合。以 balanced 的 600ms 窗口估算，模型调用频率从每秒 12.5 次传输帧降到约 1.67 次推理，理论调用压力降低约 86.7%；真实运行时直接看 `transport_frames` 和 `input_audio_ms` 验证是否达到预期。soft endpoint 的证据是 `funasr_semantic_boundary boundary=soft`，hard endpoint 的证据是 `funasr_semantic_boundary boundary=hard`。`livekit.plugins.silero` 已通过 adapter 接入，但默认关闭，后续优化必须用真实视频链路日志比较 soft endpoint 命中率、ASR RTF 和字幕端到端延迟。

   2026-06-06 使用 `.tmp/vad-funasr-30s.mp4` 复跑 FunASR：

   | 模式 | 输出行 | committed | 平均 ASR 耗时 | 平均 ASR RTF | 最终 e2e RTF | Silero 慢实时警告 |
   |------|------:|----------:|--------------:|-------------:|-------------:|------------------:|
   | `FUNASR_VAD_ENABLED=false` | 38 | 9 | 93.0ms | 0.30 | 0.86 | 0 |
   | `FUNASR_VAD_ENABLED=true` | 38 | 9 | 111.6ms | 0.36 | 0.79 | 10 |

   这组数据说明：Silero adapter 当前没有让同一视频产生更多 committed 或更早 soft endpoint，且增加了本地推理开销；因此 MVP 默认 no-VAD，保留 hard timeout 做延迟底线。需要特别区分：Silero / `SemanticEndpointTracker` 只判断“语音内容是否到达一句话边界”，不能判断用户是否点击停止，也不能解决云端 realtime provider 在长静音期间的连接保活问题。

9. **前端空译文 fallback**

   Desktop 的字幕状态机现在区分“底层记录”和“当前展示”。底层 `CaptionLine[]` 仍按事件真实保存；但悬浮字幕选择当前行时，如果最新源文草稿暂时没有译文，会借用最近一条可用译文展示，直到当前行自己的译文到达。

   这不是伪造最终译文，而是同传显示策略：源文显示最新 ASR 假设，译文显示最近可用翻译，避免高频源文 partial 抢焦点后让 UI 长时间停在“正在翻译...”。

### 仍需补的真实测量

当前 MP4 已验证媒体解码与分帧，也已补过一轮 FunASR no-VAD/VAD 对比。要完整定位“音频识别到字幕显示”的瓶颈，还需要用同一视频继续采集：

| 层级 | 需要记录 | 日志/指标 |
|------|----------|-----------|
| 桌面采集 | callback 间隔、处理/编码耗时、`socket.bufferedAmount` | `realtime_audio_capture_metrics` |
| Agent 接收 | transport avg/p95、queue depth | `audio_stream_metrics` |
| ASR | 首个 text delta、每个 segment `asr_latency_ms`、`asr_rtf` | `TranscriptSegment.metrics` |
| 分段聚合 | checkpoint 间隔、weak boundary 命中、force checkpoint 次数 | `merge_wait_ms` + 后续 debug log |
| 翻译 | 首 token、完整译文、stream delta 数 | `translation_latency_ms` |
| 字幕输出 | publish 到 Desktop 主进程、renderer receivedAt | `caption_event_published` + 前端 `receivedAtMs` |

2026-06-06 更新：Desktop 健康面板和会后摘要不再把音频时间戳当作延迟。新的 UI 延迟口径是：

```text
caption_lag_ms = caption_line.receivedAtMs - sessionStartedAtMs - caption_line.endMs
```

其中 `sessionStartedAtMs` 是 renderer 进入 `session.started` 时记录的本地墙钟，`receivedAtMs` 是 `caption-store` 收到字幕事件时写入的本地墙钟，`endMs` 是该字幕覆盖到的音频时间。这个值表达的是“用户在屏幕上收到这条字幕时，字幕落后当前音频时间线多少毫秒”。如果缺少 `sessionStartedAtMs` 或 `receivedAtMs`，UI 返回 `null`，不再显示伪延迟。会后摘要的 `averageLatencyMs` 也改为所有可计算字幕行的平均 `caption_lag_ms`，没有可计算样本时显示 0。

## 实时链路日志规范

日志目标不是“多打几行”，而是让每个关键边界都能用同一套字段串起来。当前约定如下：

| 位置 | 日志库 | 原则 |
|------|--------|------|
| Agent | Python 标准 `logging` | 使用结构化 `key=value` 文本，避免在核心管道里散落 print。 |
| Desktop main | `electron-log/main` | Electron 主进程连接、重连、解析失败、display media fallback 统一进 Electron 日志文件。 |
| Desktop renderer | `electron-log/renderer` | renderer 收到字幕事件时记录端到端到达延迟。 |
| Desktop main 工具模块 | `electron-log/node` | 保持 Vitest/node 环境可测，同时复用成熟日志库。 |

关键事件名：

| 事件名 | 触发点 | 用途 |
|--------|--------|------|
| `audio_stream_metrics` | Agent 实时音频入口 | 统计接收帧数、音频时长和 transport 侧吞吐。 |
| `funasr_inference_chunk` | FunASR 适配器每次模型调用 | 统计一次 ASR 推理吃掉多少音频、聚合了多少传输帧、是否 endpoint final、ASR RTF。 |
| `funasr_semantic_boundary` | FunASR soft/hard/stream-end endpoint | 判断 endpoint 来自上游静音、强制 hard timeout 还是流结束。 |
| `translation_checkpoint_queued` | Engine 收到 stable/committed checkpoint | 判断翻译任务是否被 latest-wins 合并或排队；只有显式开启 partial 实验开关时，partial 才会进入这里。 |
| `translation_checkpoint_skipped` | Engine 跳过不稳定 checkpoint | 默认跳过 partial 翻译时记录 `reason=partial_disabled`；Simul 策略等待半句时记录 `reason=simul_wait`。 |
| `translation_checkpoint_started` | 翻译任务开始 | 请求级边界，记录 `asr_latency_ms`、`merge_wait_ms`、`translation_queue_wait_ms`、术语命中数和 `simul_action`。 |
| `translation_checkpoint_first_token` | 翻译流首个 delta | 定位模型首 token 慢还是完整输出慢。 |
| `translation_checkpoint_finished` | 翻译任务结束 | 记录完整翻译耗时、delta 数和译文长度。 |
| `tts_synthesis_started` | committed 译文进入 TTS 旁路 | 记录目标文本长度和 TTS provider，用来确认 TTS 只消费最终译文。 |
| `tts_synthesis_first_audio` | TTS provider 返回首个音频包 | 记录 `tts_first_audio_ms`，这是语音播报体感延迟的核心指标。 |
| `tts_synthesis_finished` | TTS provider 流结束 | 记录 `tts_total_ms`、`tts_audio_chunks` 和 `tts_audio_bytes`，判断是首音慢还是完整合成慢。 |
| `tts_synthesis_failed` | TTS provider 失败 | 统计 provider、网络或格式异常，避免只看 started/finished 差值猜原因。 |
| `caption_event_published` | Agent 字幕事件发布到 `/v1/caption/events` | 发布级边界，记录 `published_at_ms`、投递耗时和随事件携带的模型指标；不用于请求级延迟分布统计。 |
| `caption_event_renderer_received` | Desktop renderer 收到 `caption:event` | 用 `Date.now() - published_at_ms` 计算 Agent publish 到 renderer receive 的延迟。 |
| `realtime_audio_capture_metrics` | Desktop renderer 音频采集/编码窗口 | 每个聚合窗口记录 Web Audio callback 数、输入/重采样样本、发出的 PCM frame 数、编码字节数、平均/p95 callback 间隔、平均/p95 处理耗时、平均/p95 PCM 编码耗时和最大 `socket.bufferedAmount`。 |

`published_at_ms` 是 Agent 发布事件时写入的毫秒时间戳。Desktop renderer 不参与 ASR/翻译耗时计算，只负责补上 `agentToRendererMs`，这样可以把“模型慢”和“桌面事件转发慢”拆开看。日志转换集中在 `apps/desktop/src/shared/realtime-telemetry.ts`，React 组件只注入 `electron-log/renderer`，避免日志胶水污染字幕状态机。

需要区分两类延迟：

- `agentToRendererMs = rendererReceivedAt - published_at_ms`：只衡量 Agent 已发布事件到 renderer 收到事件的 IPC/WebSocket 转发延迟。
- `caption_lag_ms = receivedAtMs - sessionStartedAtMs - endMs`：衡量字幕相对音频时间线的真实显示滞后，适合健康面板和会后平均延迟。

下一步建议直接用 `vido/videoplayback.mp4` 跑三组固定实验：

```powershell
# 1. 只测媒体分帧，不进真实模型。
.venv\Scripts\python.exe -m echosync_agent.asr_demo vido\videoplayback.mp4 --provider mock --chunk-ms 80 --source-lang en

# 2. 测本地 FunASR，建议先截取 30-60 秒，分别比较 VAD 开关。
$env:FUNASR_VAD_ENABLED='false'
.venv\Scripts\python.exe -m echosync_agent.asr_demo .tmp\vad-funasr-30s.mp4 --provider funasr --chunk-ms 320 --source-lang en --device auto
$env:FUNASR_VAD_ENABLED='true'
.venv\Scripts\python.exe -m echosync_agent.asr_demo .tmp\vad-funasr-30s.mp4 --provider funasr --chunk-ms 320 --source-lang en --device auto

# 3. 测 Voxtral 云端：建议先截取前 30-60 秒，避免整段 8 分钟样本消耗过高。
.venv\Scripts\python.exe -m echosync_agent.asr_demo vido\videoplayback.mp4 --provider voxtral --chunk-ms 80 --source-lang en --voxtral-delay-ms 480
```

注意：FunASR 结果必须标明模型、设备、VAD 开关和样本长度；当前 `.env` 默认模型是 `paraformer-zh-streaming`，用于英语样本时准确率不代表英文 ASR 上限，只能用于链路延迟和分段行为评估。

## 当前性能瓶颈排序

这部分基于真实 MP4 复盘、当前代码路径和已有测试，不把尚未实测的网络模型耗时假装成定量结论。

### P0：ASR delta 合并策略会误判英文裸词 delta（已完成第一轮修复）

`HypothesisUpdatePolicy` 当前主要区分两类 ASR 输出：

1. 供应商返回“完整滚动 hypothesis”：应替换当前文本。
2. 供应商返回“新增 delta”：应追加到当前文本。

真实流式 ASR 常见第三种情况：供应商按词返回 delta，但单词前不一定带空格。当前策略对这种情况过于保守，会把 `"Hello, my name is" + "Eevee"` 判成替换，结果只剩 `"Eevee"`。后续接入 Deepgram 后又暴露出第四种情况：供应商可能把同一个英文长词切成多个 span，例如 `"ident" + "ifi" + "ability"`；如果只按“英文短语后裸词补空格”处理，就会显示成 `ident ifi ability`。

已完成第二轮优化：英文裸词 delta 在已有英文短语或标点上下文后会补空格追加；英文词内 continuation delta 会无空格续接，例如 `ident + ifi + ability -> identifiability`；常见短功能词如 `to/but/and/the` 仍保留词间空格。短 token 拼接和完整 rolling hypothesis 替换契约保持不变。后续如果接入更多供应商，再补最长重叠匹配，兼容局部重复和更复杂的 ASR 修订。

| 算法点 | 做法 | 目的 |
|--------|------|------|
| token-aware append | 当英文短语/标点上下文后出现裸词 delta 时补一个空格追加 | 已完成，兼容英文裸词 delta。 |
| continuation-aware append | 当当前尾词像未完成词干，incoming 像后缀/短续接片段时无空格追加 | 已完成，避免 `ident ifi ability` 这类显示空格。 |
| 修订保护 | incoming 与 current 有显著公共前缀时仍走 replace | 已完成，保留供应商纠错能力。 |
| 最长重叠匹配 | 计算 current 尾部与 incoming 头部的最长重叠 | 后续增强，兼容局部重复和更复杂修订。 |

这属于字符串匹配问题，不需要 DFS/背包这类重算法；关键是契约要清晰，并用 SRT 仿真测试覆盖。

### P0：同一 segment 只翻译第一个 stable，长句译文会被憋到 committed（已完成第一轮修复）

`TranscriptAssembler` 在真实 SRT 仿真中能生成约 1.2 秒一个 stable。修复前，`CascadedInterpretationEngine` 使用 `stable_checkpoint_seen` 跳过同一段后续 stable。结果：

```text
第一个 stable：Hello,
最终 committed：约 9.8 秒后才有完整句子
```

已完成第一轮优化：保留 latest-wins，但不再“一段只翻译一次 stable”。当前调度策略：

| 状态 | 调度规则 |
|------|----------|
| partial | 只显示源文，不进翻译。 |
| stable | 同一 segment 默认至少间隔 `1000ms`，并且比上次多出至少 `12` 个可见字符；命中弱边界时也允许刷新。 |
| committed | 总是翻译最新完整文本，作为最终修订兜底。 |

这样仍能避免每个 token 打翻译模型，同时能让长句译文持续推进。

### P0：桌面端 ASR 延迟模式已接入，默认仍是均衡

`createRealtimeAudioClient()` 现在会发送 `asr_latency_mode`，主控首页和偏好设置也能切换 `low_latency`、`balanced`、`accuracy`。这已经消除了“UI 选择质量模式但实时会话没有声明”的断点。

仍需注意：默认模式是 `balanced`。如果当前 `.env` 的真实链路是 `voxtral + deepseek`，Voxtral 会沿用 `VOXTRAL_TARGET_DELAY_MS`，常见配置约为 `1000ms`。直播跟听时应显式选择 `low_latency`，复盘或纪要时再使用 `accuracy`。

当前建议：

| 场景 | 建议 ASR 模式 |
|------|---------------|
| 直播字幕/跟听 | `asr_latency_mode="low_latency"` |
| 技术分享/网课 | `balanced` 或可切低延迟 |
| 会议纪要/复盘 | `accuracy` |

### P0：最终译文过早 locked 会丢弃随后到达的修订 patch（已修复）

当前后端在 committed checkpoint 上的事件顺序是：

```text
translation.partial(status=committed)
translation.patch
segment.commit
```

此前前端 `caption-store` 会把 `translation.partial(status=committed)` 直接映射为 `locked`，随后 `translation.patch` 因为目标行已经 locked 被忽略。结果是：即使后端生成了修订补丁，桌面端也可能看不到这次修订。

已调整为“真正锁定”只由 `segment.commit` 触发。`translation.partial(status=committed)` 只表示“最终译文候选已到达”，在 `segment.commit` 前仍允许 `base_rev` 匹配的 patch 生效；对应回归测试在 `apps/desktop/tests/caption-store.test.ts`。

### P0：翻译首 token 指标已完成第一轮，仍缺部分端到端时间戳

`DeepSeekTranslator.stream_translate()` 已经是流式，`CascadedInterpretationEngine` 现在会拆出：


```text
translation_request_started
translation_first_token_ms
translation_final_ms
translation_delta_count
```

同时 `CaptionEventHub.publish()` 已给字幕事件写入 `published_at_ms`，Desktop renderer 侧可计算 `agentToRendererMs`。下一步的 telemetry 重点应转向采集/编码/发送、ASR 首 delta、overlay rendered 等剩余边界，而不是继续把“翻译首 token 缺指标”当成当前 P0。

### P1：`audio-gate` 一帧 lookahead 固定增加约 80ms（已完成第一轮修复）

Desktop 真实链路 `AUDIO_FRAME_DURATION_MS=80`。此前 `audio-gate` 为了判断上一块是否要标 `isFinal`，会把一块活跃音频保存在 `pending`，等下一块到来时才发送上一块。

已完成第一轮修复：活跃音频 chunk 立即发送，不再等待下一块；连续静音后输出 `type="final"` marker，`realtime-audio-client` 将它发送为 `audio.final` JSON 控制消息。Agent 收到后生成空 PCM 的 `is_final=True` frame，复用现有 ASR flush/cache reset 逻辑。

收益：活跃音频正文不再承担一帧 lookahead，按目标 80ms frame 立即进入 WebSocket；final/turn 边界仍能在静音后表达。

验证证据：

```text
npm test -- audio-gate.test.ts realtime-audio-client.test.ts
# 2 个测试文件，17 个测试通过

python -m pytest tests/test_realtime_caption_websocket_contracts.py::test_realtime_session_accepts_audio_final_control_message -q
# 1 passed
```

### P1：`ScriptProcessorNode(2048)` 是采集线程抖动来源

当前 Web Audio 回调大小为 `2048`：

```text
48kHz: 2048 / 48000 ≈ 42.7ms
44.1kHz: 2048 / 44100 ≈ 46.4ms
```

它还运行在 renderer 主线程，遇到 React 渲染、布局或 DevTools 开销会抖。它不是最大固定延迟，但会影响 p95/p99。后续应迁移 `AudioWorklet`，把 downmix、resample、PCM16 编码从主线程移走。

### P2：MP4 媒体解码已不是主要瓶颈

`vido/videoplayback.mp4` 的旧整文件抽取约 `407ms`；当前流式分帧后首个 80ms frame 约 `40-53ms` 产出。文件复盘路径仍要继续接 UI，但 Agent 媒体解码不再是首要性能问题。

### P2：前端字幕显示缓冲已改为稳定化视觉层

`caption-display-buffer` 不再是 snapshot pass-through。当前前端分成两层：

- `caption-store` 保存 desired state，并按源文/译文分别记录接收顺序。双语/原文模式按最新源文选择 active line，避免旧段晚到译文抢焦点；翻译模式按最新译文选择。
- `caption-display-buffer` 负责视觉合成：源文和译文分别以字素队列追赶 desired text，`segment.commit` 后先进入 `settling` 驻留，再进入 history。

2026-06-07 性能修正：悬浮字幕不能让整场会话历史参与每帧打字机计算。`selectOverlayDisplayWindow` 只向视觉合成器提供最近窗口，且常规路径只切尾部窗口；active 行落在窗口外时才回扫一次。已补极小窗口契约，避免 `maxLines=1` 时因为 `slice(-0)` 退化成全量历史。`selectActiveCaptionLine` 保持“源文优先、无源文再回退译文”的语义，但底层选择器从 `reduce` 临时对象改为简单循环，减少长会话下每个 realtime event 的分配开销。

2026-06-07 体验修正：前端主字幕选择从“最新 active 优先”调整为“readable dwell 未结束的已提交片段优先”。这样新源文片段到达时，上一句不会在用户刚看到译文时立刻被挤到历史区。readable dwell 公式同步放宽为 `base=2200ms`、短句最少 `3600ms`、长双语最多 `9000ms`，并按源文/译文字素数增加驻留时间。对应回归测试在 `apps/desktop/tests/caption-display-buffer.test.ts`。

2026-06-07 二次体验修正：此前 `zonedPair` 只是名字和 gap，实际仍是紧凑逐句布局；现在 `CaptionText` 引入 `CaptionTextBlock` 视图层，`zonedPair` 使用真实上下分区，源文区和译文区各占稳定区域。`sentencePair` 则会在单个 segment 过长时做显示层 soft block：优先按英文/中文句末标点拆，其次按英文常见新句起点（如 `I would` / `That is`）或字符阈值在词边界拆。这个拆分只影响视觉呈现，不改变 `segment_id`、`rev` 或 DeepSeek patch 协议，因此后续修订仍按原 segment 的 `base_rev + char index` 生效。

2026-06-07 三次体验修正：主字幕不再使用纯函数即时拆块。`CaptionTextBlockBuffer` 会为主字幕记录已经提交的视觉边界：当逐句对照内容超过约三行的字符预算后，先进入 `pending`，普通长句等待约 `900ms` 让用户反应；只有异常超长尾巴才走 `450ms` 硬兜底。到期后只提交一个冻结边界，剩余尾巴如果仍超过阈值，会进入下一轮 pending，而不是突然把整段一次性切碎。后续 ASR token 追加、译文迟到或 DeepSeek 修订到达时，已冻结的前段视觉边界保持不变，避免“先很长、过很久突然拆成一句一句”的重排感。历史轨道仍使用纯 selector 展示压缩块，避免为旧行维护额外状态。
2026-06-07 四次体验修正：真实前端仍看不到“延迟拆分”的根因不是 buffer 状态机没有计算，而是状态没有进入视觉层：`pending` 只停留在 selector 返回值，没有标到 DOM；同时普通字幕默认 `-webkit-line-clamp: 2`，且默认悬浮层把 `.overlaySource` 改成 `display: block`，导致三行反应窗口不可见或 line-clamp 失效。现在 pending block 会带 `splitPending` class；逐句对照 pending 态临时允许 source/target 三行，并显式恢复 source 的 `display: -webkit-box`。这样“超过三行附近先让用户看到长句，再约 900ms 后拆块”的视觉状态才真正能被观察到。

2026-06-07 五次体验修正：真实流式 ASR 不是单调追加文本，经常会把同一 `segment_id` 中间的词轻微修订。旧状态机只接受 `nextText.startsWith(previousText)`，一旦出现 “concepts -> ideas” 这类小幅修订，就把 `pendingSinceMs` 清空，导致 900ms 反应窗口在真实前端里不断重计时，用户看到的效果仍然是“长段卡住很久，然后突然拆”。现在 `CaptionTextBlockBuffer` 会识别同段流式小修订，保留待拆分起点和已冻结边界；只有短文本或明显换句/重启才重置状态。对应回归用例先红后绿：1900ms 应该拆分但旧逻辑仍只有 1 个 block，新逻辑稳定拆为 2 个以上 block。

2026-06-06 真实日志回放结论：本机 `main.old.log + main.log` 共解析到 `translation.partial=1234`、`transcript.partial=1354`、`segment.commit=57`、`realtime.error=2`。其中译文长度缩短回退 `129` 次，新的策略全部覆盖：`transcript.partial` 不清空已有译文，`translation.partial` 不缩短已可见译文，真正缩短/替换由 `translation.patch` 或 `segment.commit` 负责。源文侧仍允许小范围 ASR 修订，严重前缀回退由 display buffer 保持可见稳定。

停止播放或主动停止时出现的 `RealtimeTranscriptionErrorDetail(... code=3804)` 不应进入字幕文本。根因分两类：

- 用户点击“停止同传”是会话控制边界，Desktop 会发送 `audio.end(reason="user_stop")`。Agent 收到后优先按正常取消处理；即使 pipeline task 已经因为 provider timeout/连接失败结束，也只记录 `realtime_pipeline_exception_suppressed_after_user_stop`，不再发布 `realtime.error` 到 caption hub。
- 用户暂停视频但同传会话还开着时，Desktop 的 `audio-gate` 会在连续静音后停发音频正文，只发一次 `audio.final`。这对 FunASR 是正确的 flush/cache reset 语义；但 Voxtral 这类云端 realtime ASR 如果长时间收不到任何 bytes，会把空闲流判断为 timeout。因此 Voxtral 适配器内部已增加 PCM silence keepalive，并且不会把 `audio.final` 产生的空 PCM endpoint marker 当作音频正文发给 SDK。

Renderer 侧仍保留 stopping session 集合过滤，作为异常竞态的最后防线；但产品契约应由 Agent 层保证：`user_stop` 之后的 provider late exception 不发布给字幕面板。

## 下一轮必须补的 telemetry

为了继续收敛瓶颈，下一轮不要再只看肉眼观感，应把一条字幕的关键时间戳串起来：

```text
capture_callback_at
pcm_encoded_at
ws_send_at
agent_received_at
asr_first_delta_at
checkpoint_created_at
translation_request_at
translation_first_token_at
caption_published_at
renderer_received_at
overlay_rendered_at
```

最小可落地做法：

1. Desktop binary frame header 继续带 `sentAtMs`；renderer 已用 `realtime_audio_capture_metrics` 聚合记录采集端 callback、处理/编码耗时和 WebSocket backlog。
2. Agent 在 `TranscriptSegment.metrics` 里补 `asr_first_delta_ms` 或 provider 首 delta。
3. DeepSeek streaming 已拆出首 token 和 final 指标；后续需要把这些指标接入统一诊断面板。
4. `CaptionEventHub.publish()` 已带 `published_at_ms`，renderer 已能计算 UI 侧接收延迟；后续需要补 `overlay_rendered_at`。

`realtime_audio_capture_metrics` 默认按约 1 秒窗口聚合，而不是每个 `audioprocess` callback 打一条日志，避免日志本身污染 renderer 主线程。判断是否值得迁移 AudioWorklet 时重点看：

- `p95ProcessingMs` 是否接近或超过 callback 间隔的一半；如果是，主线程处理已经在挤占实时预算。
- `p95CallbackIntervalMs` 是否明显高于 `2048 / inputSampleRate` 的理论值；如果是，ScriptProcessorNode 主线程抖动明显。
- `maxWebsocketBufferedAmount` 是否持续增长；如果是，问题更像发送背压或 Agent 接收处理慢，而不是采集线程本身。
- `audioFramesSent / callbacks` 是否稳定；如果波动大，需要先看 audio-gate 静音门控和输入电平，再判断 ASR。

## 2026-06-06 真实测评日志结论与本轮修订

最新真实会话 `sess_dd35bc23e3e6` 持续约 `66.16s`，桌面端共收到 `652` 个字幕事件：

```text
caption_update=326
transcript.partial=214
translation.partial=102
segment.commit=10
```

本轮日志结论：

- `agentToRendererMs`：p50 `2ms`，p95 `17ms`。Agent 到 Electron/renderer 不是主要瓶颈。
- `translationFirstTokenMs`：p50 约 `2.9s`，p95 约 `4.37s`。单次 DeepSeek 请求仍有明显体感延迟。
- 更大的问题是翻译调度积压：同一字幕段从首次源文到首次译文平均约 `18.2s`，stable 到译文平均约 `17.3s`。66 秒内触发 `21` 个翻译 checkpoint，只覆盖到 `10` 个字幕段，尾部已有源文段没有等到译文。
- Voxtral 的旧 `asr_latency_ms` 是从 realtime stream 启动到当前 `text_delta` 的累计墙钟时间，不是模型推理耗时。它在 60 秒会话中自然涨到 60s，不能用于 ASR 性能判断。

官方文档核对：

- Mistral Voxtral Realtime 的事件示例暴露 `event.text` 文本增量，`target_streaming_delay_ms` 是延迟/上下文权衡参数；官方没有给每个 text delta 的音频时间戳。因此 EchoSync 不能把共享音频窗口误当成逐 token 时间戳。
- DeepSeek Chat Completion 是无状态接口；stream 返回 SSE delta。上下文、去重、队列丢旧必须在 EchoSync 应用层完成。

本轮已修订：

1. Voxtral 不再把累计流时间写入 `asr_latency_ms`。新指标为：
   - `asr_stream_elapsed_ms`：从 Voxtral stream 启动到当前 text delta 的累计墙钟时间。
   - `asr_audio_window_ms`：当前供应商流累计音频窗口。
   - `asr_audio_lag_ms`：`stream_elapsed - audio_window` 的保守滞后估计。
   - `asr_stream_rtf`：流累计口径 RTF，不能和 FunASR 单次推理 `asr_rtf` 混读。
2. 翻译调度增加队列等待指标 `translation_queue_wait_ms`。
3. 当同一 `segment_id` 的 committed checkpoint 到达时，尚未开始的 stable/partial checkpoint 会被丢弃；当 stable 到达时，尚未开始的 partial 会被丢弃。已经开始的翻译不强行取消，避免供应商流中断和 UI 回滚复杂度。
   2026-06-07 追加：当翻译 worker 准备处理 stable/partial 草稿、且队列后方已经有 backlog 时，先让 producer 一个事件循环机会继续入队；如果这时出现 committed checkpoint，则跳过当前和队列中尚未开始的草稿 checkpoint，优先翻译 committed。无 backlog 时不允许 committed 抢掉当前 weak-boundary stable 草稿，避免损失低延迟首译；但如果同一 `segment_id + status` 的更新版草稿已经入队，则跳过旧草稿，防止连续翻译 stale stable 造成 UI 修订风暴。这个策略只丢“未开始的草稿”，不丢 committed 终稿。对应日志为 `translation_checkpoint_dropped reason=committed_backlog|newer_draft_backlog`，`realtime_log_summary` 会统计 `translation_dropped` 和 `dropped_reasons`。
4. Desktop renderer 采集侧 `realtime_audio_capture_metrics` 改为 `info` 级别，真实测评日志应能看到采集 callback、编码耗时、发送帧数和 WebSocket backlog。
5. Agent caption 发布日志补充 `asr_stream_elapsed_ms`、`asr_audio_lag_ms`、`translation_queue_wait_ms`，同时保留 FunASR 可用的 `asr_latency_ms`。

下一次真实 A/B 证明口径：

真实测评必须保存 Agent stdout/stderr，不能只看 Desktop 日志。建议启动 Agent 时重定向：

```powershell
cd apps/agent
python -m echosync_agent.transport.caption_ws *> ..\..\agent-live.log
```

跑完同一段视频或网课后再汇总：

```powershell
python -m echosync_agent.diagnostics.realtime_log_summary ..\..\agent-live.log
```

只有 before/after 都有 `translation_checkpoint_started / first_token / finished` 时，才能比较翻译真实延迟。

```text
before/after:
  translation_started
  translation_skipped
  translation_dropped
  skipped_reasons(partial_disabled/simul_wait)
  dropped_reasons(committed_backlog)
  dropped_reasons(newer_draft_backlog)
  source_to_first_translation_ms
  stable_to_first_translation_ms
  translation_queue_wait_ms p50/p95
  translation_first_token_ms p50/p95
  tts_first_audio_ms p50/p95
  tts_total_ms p50/p95
  realtime_audio_capture_metrics.p95ProcessingMs
  realtime_audio_capture_metrics.maxWebsocketBufferedAmount
```

请求级翻译指标用 `translation_checkpoint_started / first_token / finished` 计算；TTS 指标用 `tts_synthesis_started / first_audio / finished / failed` 计算；发布级 `caption_event_published` 只用于观察 Agent 到 Desktop 的事件投递和字幕事件数量。真实测评后可运行：

```powershell
python -m echosync_agent.diagnostics.realtime_log_summary path\to\agent.log
```

或安装入口脚本后运行：

```powershell
echosync-log-summary path\to\agent.log
```

当前真实 Agent paced A/B 已经证明：收益不是让单次 DeepSeek TTFT 消失，也没有稳定降低 `translation_first_token_ms` / `translation_latency_ms`；当前收益是减少重复请求、半句翻译和后续回滚风险。下一刀优化必须用同样的 `real_agent_translation_benchmark` 做反转顺序 A/B，只有当两种执行顺序下 current 都稳定降低首 token、final 或字幕相对音频时间线滞后，才允许写“延迟降低”。

2026-06-06 TTS 补充：ElevenLabs 官方延迟建议把 Flash 模型、streaming、地域就近和 voice 选择作为主要手段；Flash v2.5 的约 75ms 是模型推理时间，不等于 EchoSync 端到端首音。当前链路只把 committed 译文送入 TTS，因此 HTTP streaming 是 MVP 默认路径；WebSocket TTS 更适合 LLM 文本边生成边输入，只有当真实日志显示 `tts_first_audio_ms` 已成为主要瓶颈时再升级，避免提前引入输入流切块和音频缓冲复杂度。

## 已发现的断点

### 断点 1：producer 演示链路容易和真实链路混淆
**原因**：`/v1/caption/events` 可通过 `producer=run_demo_caption_pipeline` 推 mock 字幕，但真实链路应从 `/v1/realtime/sessions/{session_id}` 输入音频。
**处理**：文档中统一标明：demo producer 只用于 UI 验证，真实桌面链路必须发送实时音频 frame。

### 断点 2：混音和文件源仍是边界而非完整实现
**原因**：麦克风源已改用 `getUserMedia({ audio: true })`，Windows 系统声音走 `getDisplayMedia` loopback；Agent 端文件解码已经支持 ffmpeg 流式分帧，但 Desktop 文件回放入口和混音入口仍未形成完整产品链路。
**处理**：文档中区分“Agent 媒体解码能力”和“Desktop 文件回放 UI 能力”。混音和文件回放入口在 UI 中仍保持“后续/实验”口径，避免用户误以为完整可用。

### 断点 3：错误终止、用户停止和长静音必须分层
**原因**：实时链路如果在 `audio.start` 时先启动 pipeline、再校验 ASR provider，mock + 真实 PCM 会先发 `realtime.error`，随后空 pipeline 正常退出又发 `realtime.done`，桌面端会看到矛盾状态。另一个容易混淆的边界是：`audio.final` / Silero endpoint 只表达语音停顿，不表达用户停止；视频暂停造成的长静音也不是用户停止。
**处理**：Agent 现在先应用会话级 ASR 配置和音频源校验，再启动 pipeline。`realtime.error` 表示非停止态终止，启动失败、provider 不匹配或运行中 pipeline 异常不再追加 `realtime.done`；`audio.end(reason="user_stop")` 是用户主动停止，停止期间晚到的 provider exception 只进日志，不发布到 caption hub。Voxtral 云端 realtime 路径已补 PCM silence keepalive，避免视频暂停/长静音被 provider timeout 误报成字幕错误。

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `transport/caption_ws.py` | `run_caption_server()` 传 producer；WS handler 每次连接重新运行 producer |
| `transport/realtime_ws.py` | 完整实时链路 WS 路由；启动前校验 mock/真实音频组合；支持 `audio.final` 控制帧；`realtime.error` 与 `realtime.done` 保持互斥；`user_stop` 后的 provider late exception 不发布到字幕面板 |
| `runtime/assembly.py` | `build_demo_pipeline()` 接受 `caption_event_bus` 参数，订阅字幕事件和可选 `tts.audio` |
| `services/media/ffmpeg_audio_source.py` | MP4/音频文件通过 ffmpeg stdout 流式读取并在线分帧，避免整文件解码阻塞首帧 |
| `services/asr/factory.py` | FunASR 与 Voxtral 都按 `asr_latency_mode` 映射实际推理窗口/目标延迟 |
| `desktop/src/main/main.ts` | 启动时连接 `CAPTION_WS_URL`，断线 5s 重连；应用退出时清理重连计时器并关闭 WS |
| `desktop/src/renderer/realtime-audio-client.ts` | 真实链路发送 `audio.start` + `pcm16.binary.v1` binary frame + `audio.final` 控制帧；只在用户显式选择时覆盖 ASR/翻译/TTS provider；麦克风走 `getUserMedia`，系统声走 `getDisplayMedia` |
| `desktop/src/renderer/tts-audio-playback.ts` | 优先用 MediaSource 追加播放 `tts.audio` 分片；Agent 音频分片立即以 `final=false` 推送，流结束再用空音频 `final=true` 结束包收尾；不支持对应 MIME 时回退到同一 segment/rev 等结束包后拼接 Blob；`clear()` 后忽略旧播放器晚到回调，避免新队列并发播放 |
| `desktop/src/renderer/main.tsx` | 移除 demoEvents，新增 `hasRealEvents` 状态；收到当前会话 `realtime.error` 时停止本地音频并回收采集状态 |
| `desktop/src/shared/subtitle-style-state.ts` | 字幕显示模式迁移为双语、主字幕、翻译字幕三态，兼容旧 `line/split` 配置 |

## 下一步推进

### P0：真实 ASR 配置与健康检查
1. 启动 `8766` 完整同传服务。
2. 设置 `ECHOSYNC_ASR_PROVIDER=funasr`、`voxtral` 或 `deepgram` 作为默认值，设置 `ECHOSYNC_TRANSLATOR_PROVIDER=deepseek` 作为真实翻译默认值；也可以由 Desktop 在 `audio.start.asr_provider` / `audio.start.translation_provider` / `audio.start.tts_provider` 中选择本次会话 provider。
3. Desktop 已在开始同传前读取 `/v1/realtime/capabilities`，并阻止 mock+真实音频、缺 key、缺 SDK/本地依赖和未完整接入音频源这类组合；FunASR 会显式检查 `funasr`、`modelscope`、`torch`。后续还需要把能力结果做成更细的设置页和诊断页。

### P1：音频源分支补实
1. Windows 系统声音继续使用 Electron display media loopback。
2. 麦克风已改用 `getUserMedia({ audio: true })`，后续重点是权限错误和设备缺失提示。
3. Agent 文件源已支持 ffmpeg 流式分帧；Desktop 文件回放入口未接完整前仍标记为实验状态。
4. 后续把 `ScriptProcessorNode` 迁移到 `AudioWorklet`。

### P2：术语表 UI 集成
后端 Glossary 已完成，前端需要：
1. 术语快加面板（ActiveDashboard）
2. Pin 模式下展示当前命中术语
3. 术语注入到 Agent 管道
