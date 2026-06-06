# 实时音频流式传输深度调研

日期：2026-06-05

## 结论先行

本文记录的是 2026-06-05 对实时音频链路的调研和改造依据。调研开始时，EchoSync 桌面链路虽然持续发送音频，但更准确地说是“主线程分块 + base64 JSON chunk”，还不是优秀的低延迟音频 streaming 方案。

截至本文后半部分“落地状态”，第一阶段已经改为 `audio.start` JSON 控制帧 + `pcm16.binary.v1` 二进制 PCM frame，frame 目标时长为 80ms。后文中“base64 JSON chunk”的描述保留为旧链路问题分析，不代表当前 Desktop 主链路。

行业里优秀的实时 ASR 输入链路通常具备这些特征：

1. 音频采集和 PCM 处理尽量在低延迟音频线程或原生音频层完成。
2. 音频以小而均匀的帧连续推送，常见区间是 20-100ms，AWS 建议 PCM chunk 为 50-200ms，Deepgram 建议 20-100ms，Flux 明确推荐 80ms。
3. 控制消息和音频数据分离：控制用 JSON/text，音频用 binary frame 或供应商 SDK 的 byte stream。
4. ASR 输出使用 interim hypothesis，然后通过稳定策略限制尾部可修订范围，最后输出 final/commit。
5. 延迟需要分层度量：采集缓冲、编码、WebSocket backlog、网络/IPC、ASR 首字、翻译首 token、字幕渲染。

## 资料要点

### Mistral Voxtral Realtime

Mistral 官方把 `voxtral-mini-transcribe-realtime-2602` 定位为 live transcription 模型，Python 示例的核心接口是 `client.audio.realtime.transcribe_stream(...)`，其中 `audio_stream` 是任意 `bytes` 迭代器，音频格式示例是 `pcm_s16le`、`16000Hz`。

官方示例里麦克风输入用 PyAudio 按 `chunk_duration_ms` 读取 PCM bytes 后直接 yield 给 SDK。文档示例使用 `chunk_duration_ms=480`，这说明供应商 SDK 接受 byte stream，但 chunk 时长仍是应用侧要权衡的参数。Voxtral 还提供 `target_streaming_delay_ms`，用于等待上下文提升准确性；Mistral 的 dual delay 示例用 fast stream 和 slow stream 平衡即时反馈和准确度。

来源：
- https://docs.mistral.ai/studio-api/audio/speech_to_text/realtime_transcription
- https://docs.mistral.ai/models/model-cards/voxtral-mini-transcribe-realtime-26-02
- https://arxiv.org/abs/2602.11298

### AWS Transcribe Streaming

AWS 明确说明 streaming 音频是连续 sequential chunks，并支持 SDK、HTTP/2、WebSockets。最佳实践建议：

- 尽量使用 PCM。
- stream 要接近实时速度。
- PCM chunk 建议 50ms 到 200ms。
- chunk size 保持均匀。
- 无语音时也发送等量 silence，而不是让流停掉。
- 16kHz 是质量和网络数据量之间的好折中。

AWS 的 partial result 文档也说明实时字幕会先返回 partial，随着上下文增加会修订，低延迟应用可以启用 partial-result stabilization，但准确率可能受影响。

来源：
- https://docs.aws.amazon.com/transcribe/latest/dg/streaming.html
- https://docs.aws.amazon.com/transcribe/latest/APIReference/API_streaming_StartStreamTranscription.html
- https://docs.aws.amazon.com/transcribe/latest/dg/streaming-partial-results.html

### Google Cloud Speech-to-Text

Google Cloud STT 的 Streaming Recognition 使用 gRPC bidirectional stream。第一条请求放配置，后续请求放连续 raw audio bytes；响应侧返回 interim 和 final 结果。Google 也强调 StreamingRecognize 的音频发送速度要近似实时。

这和 EchoSync 的目标模型一致：不是攒完整句子再请求，而是音频输入和识别输出双向连续流动。

来源：
- https://docs.cloud.google.com/speech-to-text/docs/v1/speech-to-text-requests
- https://docs.cloud.google.com/speech-to-text/docs/v1/quotas
- https://docs.cloud.google.com/speech-to-text/docs/streaming-recognize

### Deepgram Streaming

Deepgram 的延迟文档非常适合指导 EchoSync 的 telemetry 设计。它把 streaming latency 拆成：

- transcript latency：字幕落后音频的程度，适合 live captioning。
- end-of-turn latency：用户停顿后多久拿到 turn end，适合 voice agent。
- network latency：连接建立和单消息往返。
- transcription latency：服务端模型处理时间。
- buffer size：客户端缓冲导致的固有延迟。
- client-side processing：编码、WebSocket、响应处理造成的延迟。

Deepgram 建议 streaming buffer 为 20-100ms；其 Flux 快速入门明确推荐 80ms chunk。低层 WebSocket 文档还把 `SendBinary(audio)` 和 `SendMessage(JSON control)` 分开，这正是我们应该借鉴的协议形态。

来源：
- https://developers.deepgram.com/docs/measuring-streaming-latency
- https://developers.deepgram.com/docs/lower-level-websockets
- https://developers.deepgram.com/docs/flux/quickstart

### 浏览器/Electron 音频采集

Electron 官方 `desktopCapturer` 示例支持 `setDisplayMediaRequestHandler` 返回 `{ video: sources[0], audio: "loopback" }`，说明我们现在用 Electron getDisplayMedia loopback 作为 MVP 系统声入口是合理的。

但当前 renderer 使用 `ScriptProcessorNode`。MDN 明确标记 `ScriptProcessorNode` 已废弃，并建议使用 `AudioWorkletNode`；AudioWorklet 在独立 Web Audio thread 中运行，适合 very low latency audio processing。对 EchoSync 来说，这意味着：

- 当前主线程 PCM 处理容易受 React/UI/GC 抖动影响。
- 迁移到 AudioWorklet 是浏览器/Electron 路线的正确下一步。
- 如果追求 Windows 桌面产品级延迟，最终还可以下沉到原生 WASAPI loopback。

来源：
- https://www.electronjs.org/docs/latest/api/desktop-capturer
- https://www.electronjs.org/docs/latest/api/session
- https://developer.mozilla.org/en-US/docs/Web/API/ScriptProcessorNode/audioprocess_event
- https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet

### WebSocket 传输形态

MDN 的 `WebSocket.send()` 支持 `ArrayBuffer`、`Blob`、`TypedArray`、`DataView` 作为 binary frame，并且 `bufferedAmount` 可以反映待发送队列。EchoSync 旧链路把 PCM 转成 base64 塞进 JSON，会带来：

- base64 约 33% 体积膨胀。
- 每包 JSON stringify/parse。
- Python 侧 base64 decode。
- 无法直接用 `bufferedAmount` 做音频级背压策略。

更好的 MVP 协议是：JSON 只承载 `audio.start` / `audio.end` / ping / error 这类控制消息；PCM 音频帧直接用二进制 WebSocket frame。

来源：
- https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/send
- https://developer.mozilla.org/en-US/docs/Web/API/WebSocketStream

### Windows WASAPI

Microsoft 官方 Core Audio APIs 支持低延迟、抗 glitch 的音频 streaming；WASAPI loopback 可以捕获渲染端点正在播放的音频流。Microsoft 还提供 Application Loopback sample，可以捕获系统音频或按进程过滤音频。

这意味着长期生产路线可以考虑：

- Electron 继续负责 UI 和悬浮窗。
- Windows 音频采集交给 native sidecar / Node native addon / Python extension。
- 原生层输出 16k mono PCM 小帧给 Agent。

但这比当前 MVP 多出 C++/Rust/打包/权限复杂度，不建议作为下一步第一刀。

来源：
- https://learn.microsoft.com/en-us/windows/win32/coreaudio/about-the-windows-core-audio-apis
- https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording
- https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/

## 对 EchoSync 当前方案的判断

调研时的旧链路：

```text
Electron getDisplayMedia(loopback)
  -> ScriptProcessorNode(4096)
  -> downmix/resample
  -> audio-gate 240ms chunk
  -> PCM16 base64
  -> JSON WebSocket
  -> Python receive_json
  -> base64 decode
  -> AudioFrame
  -> Voxtral/FunASR stream
```

主要问题：

1. `ScriptProcessorNode(4096)` 在 48kHz 下约 85ms 才触发一次，并且在 renderer 主线程上执行。
2. `audio-gate` 默认 240ms，把传输 chunk 和 VAD/final 判断混在一起，制造固定缓冲延迟。
3. base64 JSON 不是低延迟音频传输的优秀形态。
4. 后端每个 audio chunk 打 INFO 日志，会放大实时链路噪声和开销。
5. `VOXTRAL_TARGET_DELAY_MS=1000` 是 ASR 稳定性延迟，不应和网络传输延迟混为一谈。

当前 Desktop 主链路已经更新为：

```text
Electron getDisplayMedia(loopback) / getUserMedia(microphone)
  -> ScriptProcessorNode(2048)
  -> downmix/resample
  -> audio-gate 80ms chunk
  -> pcm16.binary.v1 WebSocket binary frame
  -> audio.final JSON control frame on silence boundary
  -> Python receive_bytes
  -> AudioFrame
  -> Voxtral/FunASR stream
```

`audio-gate` 已把音频正文发送和 final/turn 边界拆开：活跃音频 chunk 立即发送，连续静音后用 `audio.final` 控制消息触发 Agent 侧 ASR flush。当前仍然存在的问题是 `ScriptProcessorNode` 还在 renderer 主线程运行、混音和文件回放源还不是完整生产能力。云端 ASR 的 silence/keepalive 不能和本地 FunASR 一刀切：Voxtral realtime 路径已在 Agent 适配器内部补最小 PCM silence keepalive，避免用户暂停视频时让 provider 误判流超时。

## 推荐演进路线

### 第一阶段：低风险真流式 MVP

目标：把“JSON chunk”改成“binary audio frame stream”，同时加延迟证据。

建议参数：

- PCM：16kHz、mono、signed int16 little-endian。
- frame duration：先用 80ms；如果 FunASR/Voxtral 表现不稳，再试 100ms 或 120ms。
- WebSocket：控制消息 JSON text frame，音频 binary frame。
- silence：本地 FunASR 路径可以静音停发并用 `audio.final` 表达 endpoint；Voxtral 这类云端 streaming provider 需要按供应商要求发送 silence frame 或 KeepAlive，不要让 ASR 误以为流断了。当前 Voxtral 已在 Agent 侧补 PCM silence keepalive，其他云端 ASR 接入时也必须按 provider 单独实现。
- telemetry：前端记录 capture time、encode time、send time、`bufferedAmount`；后端记录 receive time、queue depth、frame duration、p50/p95 transport latency。

协议草案：

```text
text frame:
{
  "type": "audio.start",
  "protocol": "pcm16.binary.v1",
  "sample_rate": 16000,
  "channels": 1,
  "frame_duration_ms": 80,
  "source_kind": "windows_system"
}

binary frame:
header + pcm payload

text frame:
{ "type": "audio.end" }
```

2026-06-06 更新：当前协议已增加 `audio.final` JSON 控制帧，用于把 endpoint/final 从 binary PCM payload 中拆出来：

```text
binary frame:
header + speech pcm payload

text frame:
{ "type": "audio.final", "seq": 42, "start_ms": 1840, "end_ms": 1840 }
```

Agent 将 `audio.final` 转为空 PCM 的 `AudioFrame(is_final=True)`，这样 FunASR 可以 flush pending buffer，但不会把静音正文继续送入 ASR。

header 可以先用 24 bytes 固定小头：

```text
u32 magic          "ESAF"
u16 version        1
u16 flags          bit0=is_final, bit1=silence
u32 seq
u32 start_ms
u32 end_ms
u32 sent_at_ms_low
... pcm bytes
```

如果为了更快落地，也可以先用 JSON `audio.start` 声明元信息，binary frame 不带 header，只要求后端按收到顺序累加音频时钟。缺点是定位丢包/乱序/延迟会弱一些。

### 第二阶段：AudioWorklet

目标：把 PCM 处理从 renderer 主线程挪到 Web Audio rendering thread。

建议做法：

- `AudioWorkletProcessor` 内部累计 80ms PCM 帧。
- processor 只做 downmix、简单 resample、float-to-int16。
- 用 `postMessage(..., [buffer])` 把 ArrayBuffer 转给主线程 WebSocket 发送。
- 主线程只做连接管理、背压、错误显示。

### 第三阶段：原生 WASAPI sidecar

目标：Windows 生产级系统声采集。

建议在 MVP 稳定后再做，因为它会引入：

- C++/Rust/Node native/Python extension 之一。
- Windows 音频设备枚举和重采样。
- 打包和权限问题。
- 多设备、蓝牙、音量、增强效果等兼容问题。

## 落地状态

截至 2026-06-05，第一阶段已开始落地：

- Desktop realtime client 在 `audio.start` 声明 `protocol="pcm16.binary.v1"` 和 `frame_duration_ms=80`。
- 音频正文改为 WebSocket binary frame，固定 24 bytes header 后接 PCM16 payload。
- 连续静音后的 final/turn 边界改为 `audio.final` JSON 控制帧，活跃音频不再为了 final 标记额外等待一帧。
- Agent `/v1/realtime/sessions/{session_id}` 同时兼容旧 JSON `audio.chunk` 和新 binary frame。
- Agent 每秒聚合打印 `audio_stream_metrics`，包含 frames、audio_ms、bytes、avg/p95 transport latency 和 queue depth。
- Desktop renderer 按聚合窗口以 `info` 级别打印 `realtime_audio_capture_metrics`，包含 Web Audio callback 数、输入/重采样样本、发出的 PCM frame 数、编码字节数、平均/p95 callback 间隔、平均/p95 处理耗时、平均/p95 PCM 编码耗时和最大 `socket.bufferedAmount`。这条日志用于证明迁移 AudioWorklet 前后的采集端收益，避免每个 callback 打日志污染主线程。
- Voxtral 云端 streaming 路径已加入 silence keepalive 第一版：桌面端静音停发时，Agent 侧会按配置向 Voxtral realtime audio stream 补 PCM silence，避免云端流误判断开。FunASR 仍走本地 `audio.final` flush 语义。
- Voxtral 指标已拆分：`asr_stream_elapsed_ms` / `asr_audio_lag_ms` / `asr_stream_rtf` 是流累计口径，不再伪装为 FunASR 那种单次推理 `asr_latency_ms`。

仍未落地：

- AudioWorklet 采集/重采样。
- 云端 provider 的 silence frame / KeepAlive 策略需要按供应商继续细化；Voxtral 已有最小 PCM silence keepalive，其他云端 ASR 尚未接入。
- Windows 原生 WASAPI sidecar。

## 建议的下一步实现顺序

1. 跑真实视频，比较旧协议和新协议的首字幕时间、ASR 首字时间、翻译首 token 时间。
2. 用 `realtime_audio_capture_metrics` 判断主线程是否真的抖动：重点看 `p95ProcessingMs`、`p95CallbackIntervalMs` 和 `maxWebsocketBufferedAmount`。如果 p95 callback 明显高于 `2048 / inputSampleRate` 理论值，或处理耗时接近 callback 间隔的一半，再迁移 AudioWorklet。
3. 如果后续新增云端 ASR，对照供应商协议补 silence frame 或 keepalive 策略；不要把 FunASR 的静音停发策略直接复用到所有 provider。
4. 如果 Electron/WebAudio 仍无法满足预期，再评估 WASAPI sidecar。

## 这轮调研对当前决策的影响

我建议不再只做 `240ms -> 120ms` 这种调参式优化。正确的第一刀应该是：

```text
JSON control + binary PCM frame + 80ms frame + latency telemetry
```

这一步复杂度仍可控，但方向已经和 AWS、Google、Deepgram、Voxtral 的 streaming 模式对齐。AudioWorklet 是下一步，不建议和 binary protocol 同时做，避免一次改动覆盖采集线程、协议、后端解析、日志四个变量。
