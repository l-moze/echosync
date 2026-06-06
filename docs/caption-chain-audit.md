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

仍需注意：默认 `mock` ASR 只适合文本帧演示。真实 PCM 音频必须使用 `funasr` 或 `voxtral`，否则 Desktop preflight 会先拦截；如果绕过 preflight，Agent 仍会在启动 pipeline 前返回 `realtime.error` 并结束会话。`audio.start.asr_provider`、`audio.start.translation_provider` 和 `audio.start.tts_provider` 可以做会话级切换；未发送时沿用 Agent 端 `.env`。密钥、voice id 和模型配置仍来自 Agent 端 `.env`。

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

   ```text
   transcript.partial
     -> translation_checkpoint_skipped reason=partial_disabled
     -> transcript.stable / transcript.committed
     -> translation.partial(稳定翻译)
     -> segment.commit(最终锁定)
   ```

   算法收益：在“长 partial 后接 committed”的典型场景里，默认翻译请求从 partial+committed 两次降为 committed 一次；测试用例可观测到 translator 调用数下降 50%，并且日志会出现 `translation_checkpoint_skipped` 作为证据。

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

   这组数据说明：Silero adapter 当前没有让同一视频产生更多 committed 或更早 soft endpoint，且增加了本地推理开销；因此 MVP 默认 no-VAD，保留 hard timeout 做延迟底线。

9. **前端空译文 fallback**

   Desktop 的字幕状态机现在区分“底层记录”和“当前展示”。底层 `CaptionLine[]` 仍按事件真实保存；但悬浮字幕选择当前行时，如果最新源文草稿暂时没有译文，会借用最近一条可用译文展示，直到当前行自己的译文到达。

   这不是伪造最终译文，而是同传显示策略：源文显示最新 ASR 假设，译文显示最近可用翻译，避免高频源文 partial 抢焦点后让 UI 长时间停在“正在翻译...”。

### 仍需补的真实测量

当前 MP4 已验证媒体解码与分帧，也已补过一轮 FunASR no-VAD/VAD 对比。要完整定位“音频识别到字幕显示”的瓶颈，还需要用同一视频继续采集：

| 层级 | 需要记录 | 日志/指标 |
|------|----------|-----------|
| 桌面采集 | `capture_callback_ms`、`encode_ms`、`socket.bufferedAmount` | 后续迁移 AudioWorklet 时补 |
| Agent 接收 | transport avg/p95、queue depth | `audio_stream_metrics` |
| ASR | 首个 text delta、每个 segment `asr_latency_ms`、`asr_rtf` | `TranscriptSegment.metrics` |
| 分段聚合 | checkpoint 间隔、weak boundary 命中、force checkpoint 次数 | `merge_wait_ms` + 后续 debug log |
| 翻译 | 首 token、完整译文、stream delta 数 | `translation_latency_ms` |
| 字幕输出 | publish 到 Desktop 主进程、renderer receivedAt | `caption_event_published` + 前端 `receivedAtMs` |

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
| `translation_checkpoint_skipped` | Engine 跳过不稳定 checkpoint | 默认跳过 partial 翻译时记录，证明 DeepSeek 请求没有被半句话放大。 |
| `translation_checkpoint_started` | 翻译任务开始 | 记录 `asr_latency_ms`、`merge_wait_ms`、术语命中数。 |
| `translation_checkpoint_first_token` | 翻译流首个 delta | 定位模型首 token 慢还是完整输出慢。 |
| `translation_checkpoint_finished` | 翻译任务结束 | 记录完整翻译耗时、delta 数和译文长度。 |
| `caption_event_published` | Agent 字幕事件发布到 `/v1/caption/events` | 记录发布时刻 `published_at_ms` 和随事件携带的模型指标。 |
| `caption_event_renderer_received` | Desktop renderer 收到 `caption:event` | 用 `Date.now() - published_at_ms` 计算 Agent publish 到 renderer receive 的延迟。 |

`published_at_ms` 是 Agent 发布事件时写入的毫秒时间戳。Desktop renderer 不参与 ASR/翻译耗时计算，只负责补上 `agentToRendererMs`，这样可以把“模型慢”和“桌面事件转发慢”拆开看。日志转换集中在 `apps/desktop/src/shared/realtime-telemetry.ts`，React 组件只注入 `electron-log/renderer`，避免日志胶水污染字幕状态机。

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

真实流式 ASR 常见第三种情况：供应商按词返回 delta，但单词前不一定带空格。当前策略对这种情况过于保守，会把 `"Hello, my name is" + "Eevee"` 判成替换，结果只剩 `"Eevee"`。

已完成第一轮优化：英文裸词 delta 在已有英文短语或标点上下文后会补空格追加；短 token 拼接和完整 rolling hypothesis 替换契约保持不变。后续如果接入更多供应商，再补最长重叠匹配，兼容局部重复和更复杂的 ASR 修订。

| 算法点 | 做法 | 目的 |
|--------|------|------|
| token-aware append | 当英文短语/标点上下文后出现裸词 delta 时补一个空格追加 | 已完成，兼容英文裸词 delta。 |
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

### P2：前端字幕显示缓冲目前不是主要瓶颈

`caption-display-buffer` 当前是 snapshot pass-through，不再做字素级慢放；`caption-store` 按接收时间选择当前字幕行。只要 Agent 发出完整源文/译文快照，前端不会再主动拖慢显示。

2026-06-06 追加：字幕窗口的 active-line 选择必须跟显示模式绑定。双语/主字幕模式继续优先显示最新源文草稿，保证识别打字机实时可见；翻译字幕模式改为优先选择最近一条有 `targetText` 的行，避免最新源文草稿抢焦点后主字幕区域空白。驻留/控制态历史区同样按显示模式过滤，翻译字幕模式不渲染源文-only 历史空行。

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

1. Desktop binary frame header 继续带 `sentAtMs`，再在 renderer debug log 里记录 resample/encode/send 耗时。
2. Agent 在 `TranscriptSegment.metrics` 里补 `asr_first_delta_ms` 或 provider 首 delta。
3. DeepSeek streaming 已拆出首 token 和 final 指标；后续需要把这些指标接入统一诊断面板。
4. `CaptionEventHub.publish()` 已带 `published_at_ms`，renderer 已能计算 UI 侧接收延迟；后续需要补 `overlay_rendered_at`。

## 已发现的断点

### 断点 1：producer 演示链路容易和真实链路混淆
**原因**：`/v1/caption/events` 可通过 `producer=run_demo_caption_pipeline` 推 mock 字幕，但真实链路应从 `/v1/realtime/sessions/{session_id}` 输入音频。
**处理**：文档中统一标明：demo producer 只用于 UI 验证，真实桌面链路必须发送实时音频 frame。

### 断点 2：混音和文件源仍是边界而非完整实现
**原因**：麦克风源已改用 `getUserMedia({ audio: true })`，Windows 系统声音走 `getDisplayMedia` loopback；Agent 端文件解码已经支持 ffmpeg 流式分帧，但 Desktop 文件回放入口和混音入口仍未形成完整产品链路。
**处理**：文档中区分“Agent 媒体解码能力”和“Desktop 文件回放 UI 能力”。混音和文件回放入口在 UI 中仍保持“后续/实验”口径，避免用户误以为完整可用。

### 断点 3：错误终止事件必须和正常完成事件互斥
**原因**：实时链路如果在 `audio.start` 时先启动 pipeline、再校验 ASR provider，mock + 真实 PCM 会先发 `realtime.error`，随后空 pipeline 正常退出又发 `realtime.done`，桌面端会看到矛盾状态。
**处理**：Agent 现在先应用会话级 ASR 配置和音频源校验，再启动 pipeline。`realtime.error` 表示终止态，启动失败或 pipeline 异常不再追加 `realtime.done`；用户停止时如果 pipeline 已经失败，会优先上报错误。Desktop 收到当前会话错误后会停止本地音频 client、回收主进程采集状态，并退回失败浮层。

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `transport/caption_ws.py` | `run_caption_server()` 传 producer；WS handler 每次连接重新运行 producer |
| `transport/realtime_ws.py` | 完整实时链路 WS 路由；启动前校验 mock/真实音频组合；支持 `audio.final` 控制帧；`realtime.error` 与 `realtime.done` 保持互斥 |
| `runtime/assembly.py` | `build_demo_pipeline()` 接受 `caption_event_bus` 参数，订阅字幕事件和可选 `tts.audio` |
| `services/media/ffmpeg_audio_source.py` | MP4/音频文件通过 ffmpeg stdout 流式读取并在线分帧，避免整文件解码阻塞首帧 |
| `services/asr/factory.py` | FunASR 与 Voxtral 都按 `asr_latency_mode` 映射实际推理窗口/目标延迟 |
| `desktop/src/main/main.ts` | 启动时连接 `CAPTION_WS_URL`，断线 5s 重连；应用退出时清理重连计时器并关闭 WS |
| `desktop/src/renderer/realtime-audio-client.ts` | 真实链路发送 `audio.start` + `pcm16.binary.v1` binary frame + `audio.final` 控制帧；只在用户显式选择时覆盖 ASR/翻译/TTS provider；麦克风走 `getUserMedia`，系统声走 `getDisplayMedia` |
| `desktop/src/renderer/tts-audio-playback.ts` | 拼接 `tts.audio` 分片并按 final 播放；`clear()` 后忽略旧播放器晚到回调，避免新队列并发播放 |
| `desktop/src/renderer/main.tsx` | 移除 demoEvents，新增 `hasRealEvents` 状态；收到当前会话 `realtime.error` 时停止本地音频并回收采集状态 |
| `desktop/src/shared/subtitle-style-state.ts` | 字幕显示模式迁移为双语、主字幕、翻译字幕三态，兼容旧 `line/split` 配置 |

## 下一步推进

### P0：真实 ASR 配置与健康检查
1. 启动 `8766` 完整同传服务。
2. 设置 `ECHOSYNC_ASR_PROVIDER=funasr` 或 `voxtral` 作为默认值，设置 `ECHOSYNC_TRANSLATOR_PROVIDER=deepseek` 作为真实翻译默认值；也可以由 Desktop 在 `audio.start.asr_provider` / `audio.start.translation_provider` / `audio.start.tts_provider` 中选择本次会话 provider。
3. Desktop 已在开始同传前读取 `/v1/realtime/capabilities`，并阻止 mock+真实音频、缺 key、缺 SDK 和未完整接入音频源这类组合；后续还需要把能力结果做成更细的设置页和诊断页。

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
