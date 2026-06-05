# Agent → Desktop 字幕链路审计

## 链路全貌

```
┌─────────────────────────────────────────────────────────────────┐
│ Agent (Python)                                                   │
│                                                                  │
│  /v1/realtime/sessions/{session_id}                              │
│    Desktop 发送 audio.start + pcm16.binary.v1 binary frame       │
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

当前 Desktop 已经不只是被动接收 `/v1/caption/events`。renderer 会在开始同传时采集音频，先发送 JSON 控制帧 `audio.start`，声明 `asr_provider`、`asr_latency_mode`、采样率和源信息，再把音频正文转成 `pcm16.binary.v1` 二进制 WebSocket frame 发送到 `/v1/realtime/sessions/{session_id}`，Agent 再通过同一个 `CaptionEventHub` 推字幕事件。

后端仍兼容旧 JSON `audio.chunk` / `pcm_base64`，主要用于旧测试、纯 ASR 调试和过渡期兼容；当前 Desktop 真实链路默认不走 base64 JSON。

仍需注意：默认 `mock` ASR 只适合文本帧演示。真实 PCM 音频必须使用 `funasr` 或 `voxtral`，否则 Agent 会在启动 pipeline 前返回 `realtime.error` 并结束会话。`audio.start.asr_provider` 可以做会话级切换；密钥和模型配置仍来自 Agent 端 `.env`。

`8765` 与 `8766` 的边界：

```text
8765 /v1/asr/sessions/{session_id}       # 纯 ASR 调试，只返回 asr.segment
8766 /v1/realtime/sessions/{session_id}  # 完整同传输入
8766 /v1/caption/events                  # 完整同传输出
```

## 已发现的断点

### 断点 1：producer 演示链路容易和真实链路混淆
**原因**：`/v1/caption/events` 可通过 `producer=run_demo_caption_pipeline` 推 mock 字幕，但真实链路应从 `/v1/realtime/sessions/{session_id}` 输入音频。
**处理**：文档中统一标明：demo producer 只用于 UI 验证，真实桌面链路必须发送实时音频 frame。

### 断点 2：混音和文件源仍是边界而非完整实现
**原因**：麦克风源已改用 `getUserMedia({ audio: true })`，Windows 系统声音走 `getDisplayMedia` loopback；但混音和文件回放仍主要是目录/边界，不能按生产能力宣传。
**处理**：混音和文件源在 UI 与文档中保持“后续/实验”口径，避免用户误以为完整可用。

### 断点 3：错误终止事件必须和正常完成事件互斥
**原因**：实时链路如果在 `audio.start` 时先启动 pipeline、再校验 ASR provider，mock + 真实 PCM 会先发 `realtime.error`，随后空 pipeline 正常退出又发 `realtime.done`，桌面端会看到矛盾状态。
**处理**：Agent 现在先应用会话级 ASR 配置和音频源校验，再启动 pipeline。`realtime.error` 表示终止态，启动失败或 pipeline 异常不再追加 `realtime.done`；用户停止时如果 pipeline 已经失败，会优先上报错误。

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `transport/caption_ws.py` | `run_caption_server()` 传 producer；WS handler 每次连接重新运行 producer |
| `transport/realtime_ws.py` | 完整实时链路 WS 路由；启动前校验 mock/真实音频组合；`realtime.error` 与 `realtime.done` 保持互斥 |
| `runtime/assembly.py` | `build_demo_pipeline()` 接受 `caption_event_bus` 参数并订阅 |
| `desktop/src/main/main.ts` | 启动时连接 `CAPTION_WS_URL`，断线 5s 重连 |
| `desktop/src/renderer/realtime-audio-client.ts` | 真实链路发送 `audio.start` + `pcm16.binary.v1` binary frame；麦克风走 `getUserMedia`，系统声走 `getDisplayMedia` |
| `desktop/src/renderer/main.tsx` | 移除 demoEvents，新增 `hasRealEvents` 状态 |

## 下一步推进

### P0：真实 ASR 配置与健康检查
1. 启动 `8766` 完整同传服务。
2. 设置 `ECHOSYNC_ASR_PROVIDER=funasr` 或 `voxtral` 作为默认值，或由 Desktop 在 `audio.start.asr_provider` 中选择本次会话 provider。
3. Desktop 开始同传前检查 Agent 是否可连接，避免 UI 进入“同传中”但后端未启动。

### P1：音频源分支补实
1. Windows 系统声音继续使用 Electron display media loopback。
2. 麦克风已改用 `getUserMedia({ audio: true })`，后续重点是权限错误和设备缺失提示。
3. 混音和文件回放未实现前标记为不可用或实验状态。
4. 后续把 `ScriptProcessorNode` 迁移到 `AudioWorklet`。

### P2：术语表 UI 集成
后端 Glossary 已完成，前端需要：
1. 术语快加面板（ActiveDashboard）
2. Pin 模式下展示当前命中术语
3. 术语注入到 Agent 管道
