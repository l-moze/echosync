# ASR Provider Voxtral Design

## Goal

让 EchoSync 可以在同一个 `Transcriber` 契约下切换多个 ASR 供应商，并新增 Voxtral Realtime 作为实时多语言 ASR 适配器。

## Current Context

现有管道已经把 ASR 边界抽象为：

```text
AsyncIterator[AudioFrame] -> Transcriber.stream() -> AsyncIterator[TranscriptSegment]
```

`FunAsrTranscriber` 已经封装了 FunASR 的 `AutoModel.generate()`、流式 `cache` 和 `is_final` 语义。`asr_websocket.py` 只负责协议和 `AudioFrame` 转换，`RealtimeInterpretationPipeline` 只依赖 `Transcriber`。

## Design

采用轻量 ASR provider registry，不引入复杂插件系统。

```text
Settings / CLI args
  -> AsrProviderConfig
  -> build_transcriber()
  -> MockTranscriber | FunAsrTranscriber | VoxtralRealtimeTranscriber
  -> Transcriber.stream()
```

新增 `apps/agent/src/echosync_agent/services/asr/factory.py`，集中创建 ASR 适配器。`runtime.assembly` 和 `asr_demo.py` 都使用同一工厂，避免 provider 选择逻辑重复。

## Voxtral Adapter

新增 `apps/agent/src/echosync_agent/services/asr/voxtral_transcriber.py`。

职责：

- 接收任意 `AsyncIterator[AudioFrame]`。
- 将 frame 的 `pcm` 转成 Mistral realtime 需要的 bytes audio stream。
- 使用 Mistral realtime transcription API。
- 将 `TranscriptionStreamTextDelta` 归一为内部 `TranscriptSegment`。
- 忽略 session-created 这类供应商内部事件。
- 将 realtime error 转为 `RuntimeError`，由调用层决定如何关闭会话。

默认配置：

```text
provider: voxtral
model: voxtral-mini-transcribe-realtime-2602
audio encoding: pcm_s16le
sample_rate: 16000
channels: 1
target_streaming_delay_ms: 1000
source_lang: auto
```

Voxtral 适配器不负责翻译、摘要、字幕 UI、术语处理或音频采集架构。

## Configuration

新增环境变量：

```text
MISTRAL_API_KEY=
VOXTRAL_MODEL=voxtral-mini-transcribe-realtime-2602
VOXTRAL_TARGET_DELAY_MS=1000
```

`ECHOSYNC_ASR_PROVIDER=voxtral` 时必须配置 `MISTRAL_API_KEY`。

CLI 新增：

```text
--provider voxtral
--mistral-api-key
--voxtral-delay-ms
```

## Testing

测试只验证内部契约，不依赖真实 Mistral 网络调用：

- provider factory 能创建 `mock`、`funasr`、`voxtral`。
- `voxtral` 缺少 API key 时抛出清晰错误。
- Voxtral adapter 会把 frame PCM 直接送入 SDK audio stream。
- text delta 会产出 `TranscriptSegment`。
- done/unknown/session 事件不会污染下游。
- CLI 能接受 `--provider voxtral` 和 delay 参数。

## Deliberate Non-Goals

- 不新增完整 ASR 事件层。当前 MVP 下游只需要 `TranscriptSegment`。
- 不把 Voxtral vLLM 自部署塞进 Windows 桌面进程。
- 不让 WebSocket 协议出现 provider 特殊消息。
- 不改变翻译、修正、字幕、TTS 接口。

## Self Review

- 没有 TBD/TODO。
- 设计只覆盖多 ASR 选择和 Voxtral 接入，不跨入字幕或翻译。
- 抽象边界与现有 `Transcriber`、`AudioFrame`、`TranscriptSegment` 保持一致。
- provider registry 是静态工厂，避免过度工程。
