# 会话级 ASR 切换与 FunASR 优化实施计划

> **给执行 agent 的要求：** 按任务逐项执行，优先使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`。使用 `- [ ]` / `- [x]` 维护进度。

**目标：** 支持桌面端按会话选择 ASR provider，并让 FunASR 在内部把 80ms 传输帧聚合成更合适的推理窗口，避免低延迟传输直接变成低效率的 80ms 模型调用。

**架构：** Desktop 在 `audio.start` 中声明用户选择的 ASR provider 和延迟模式；Agent 在创建 pipeline 前应用会话级 settings override。FunASR 保持现有 `Transcriber` 抽象边界不变，在适配器内部把多个 `AudioFrame` 聚合为 provider 适合的窗口后再调用 `AutoModel.generate()`。文档同步说明当前可用 provider 和后续候选。

**技术栈：** Python 3.11+、FastAPI WebSocket、FunASR AutoModel、TypeScript/Electron renderer、Vitest、pytest。

---

## 文件

- 修改 `apps/desktop/src/renderer/realtime-audio-client.ts`：接受 `asrProvider` 和 `asrLatencyMode`，并写入 `audio.start`。
- 修改 `apps/desktop/tests/realtime-audio-client.test.ts`：覆盖 start message 中的 provider 字段。
- 修改 `apps/agent/src/echosync_agent/runtime/settings.py`：增加 ASR override helper 和延迟模式校验。
- 修改 `apps/agent/src/echosync_agent/transport/realtime_ws.py`：在 pipeline 创建前读取 `audio.start` 的会话级 ASR override。
- 修改 `apps/agent/src/echosync_agent/services/asr/funasr_transcriber.py`：把 80ms frame 聚合成 `chunk_ms` 推理窗口，并在 final/end 时 flush。
- 修改 `apps/agent/tests/test_realtime_caption_websocket_contracts.py`：证明会话级 ASR override 会进入 pipeline settings。
- 修改 `apps/agent/tests/test_asr_media_contracts.py` 或新增聚焦测试：证明小帧聚合和 final remainder flush。
- 修改 `README.md`、`doc/architecture-mvp.md`、`doc/技术路线与库调研.md`、`docs/caption-chain-audit.md`：同步会话级 ASR 切换和 FunASR buffering 说明。

---

### 任务 1：Desktop 发送 ASR 会话选项

- [x] 写 Vitest，验证 `createRealtimeAudioClient({ asrProvider: "funasr", asrLatencyMode: "balanced" })` 会在 `audio.start` 中携带 `asr_provider` 和 `asr_latency_mode`。
- [x] 运行 `npm --prefix apps/desktop test -- realtime-audio-client.test.ts`，确认新增测试先失败。
- [x] 给 `RealtimeAudioClientOptions` 增加 `asrProvider?: "mock" | "funasr" | "voxtral"` 和 `asrLatencyMode?: "low_latency" | "balanced" | "accuracy"`。当前后续实现已把 `deepgram` 也纳入可选 ASR provider。
- [x] 只有用户显式选择 ASR provider 时才发送 `asr_provider`；始终发送 `asr_latency_mode`。`server-default` 保留 Agent `.env` 默认语义；Desktop 通过 capabilities/preflight 阻止真实音频的无效组合，不再静默强制 FunASR。
- [x] 运行聚焦桌面端测试并确认通过。

### 任务 2：Agent 应用会话级 ASR override

- [x] 写 pytest：发送带 `asr_provider="funasr"` 的 `audio.start`，断言传给 `build_demo_pipeline()` 的 settings 使用 `funasr`，即使服务端默认是 `mock`。
- [x] 运行聚焦 pytest，确认当前实现会因为 pipeline 早于 `audio.start` 创建而失败。
- [x] 将 pipeline 创建移动到 `audio.start` 处理之后，或在第一帧音频到达前惰性创建。
- [x] 增加小型 settings override 函数，校验 provider 是否在支持集合内，未知 provider 以 `realtime.error` 返回。
- [x] 保持 API key 只在服务端：会话 override 可以选择 `voxtral`，但凭据仍来自 `.env`。
- [x] 运行聚焦 pytest 并确认通过。

### 任务 3：FunASR 聚合小传输帧

- [x] 写 fake model pytest：输入六个 100ms frame，`chunk_ms=300`，断言 `model.generate()` 被调用两次，每次 300ms 窗口。
- [x] 再写一个 fake model pytest：输入 final 100ms remainder，断言 remainder 会以 `is_final=True` flush。
- [x] 运行聚焦 pytest，确认当前 FunASR 每个 input frame 都直接调用模型导致测试失败。
- [x] 在 `FunAsrTranscriber.stream()` 内实现 buffer：累计 PCM bytes 和 frame 元数据，达到 `chunk_ms` 后合并为一个 `AudioFrame` 再调用 `_recognize_frame()`。
- [x] 输入 frame 带 `is_final=True` 或 frame iterator 结束时 flush 剩余内容。
- [x] 保留 session id、source language、source kind、device id，并使用第一个 start / 最后一个 end 作为合并帧时间。
- [x] 运行聚焦 pytest 并确认通过。

### 任务 4：文档同步

- [x] 更新 README 本地测试说明：ASR 可以按会话选择，`.env` 仍是默认。
- [x] 更新架构文档：传输 frame 是 80ms，但 FunASR 推理窗口由 provider 内部决定，默认约 600ms。
- [x] 更新技术路线文档 provider 候选：FunASR 本地、Voxtral 云端、Deepgram/Azure 下一批、OpenAI Realtime 作为端到端候选。当前后续实现已接入 Deepgram Streaming STT，Azure 仍是下一批候选。
- [x] 搜索并修正“Desktop 不能选择 ASR”或“FunASR 每 80ms frame 调一次模型”等过期表述。

---

## 自审

- 没有剩余占位任务。
- 范围限定在会话级 provider 选择、FunASR buffering 和文档同步；该计划执行时不实现 Deepgram/Azure 网络适配。当前后续实现已补充 Deepgram Streaming STT，Azure 仍未接入。
- 测试覆盖 Desktop start payload、Agent 会话 override 和 FunASR buffering 行为。
