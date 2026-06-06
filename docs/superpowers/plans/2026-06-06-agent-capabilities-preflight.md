# Agent 能力发现与启动预检实施计划

> **给执行 agent 的要求：** 按任务逐项执行，优先使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`。使用 `- [ ]` / `- [x]` 维护进度。

**目标：** Desktop 在开始实时采集前读取 Agent capabilities，安全选择 ASR / 翻译 provider，避免先打开媒体流再因为缺密钥、缺 SDK 或 provider 不适配而失败。

**架构：** Agent 根据 `Settings` 暴露小型 HTTP capabilities endpoint。Desktop main/preload 把该 endpoint 桥接到 renderer。Renderer 保存 ASR provider、ASR 延迟模式和翻译 provider 选择，在打开媒体采集前进行预检，通过后再在 `audio.start` 中发送显式会话 override。

**技术栈：** Python 3.11、FastAPI、pytest、TypeScript、Electron、React、Vitest。

---

### 任务 1：Agent capabilities 契约

**文件：**
- 新建：`apps/agent/src/echosync_agent/runtime/capabilities.py`
- 测试：`apps/agent/tests/test_runtime_capabilities.py`
- 修改：`apps/agent/src/echosync_agent/transport/caption_ws.py`
- 测试：`apps/agent/tests/test_realtime_caption_websocket_contracts.py`

- [x] 增加 provider readiness 和 HTTP endpoint 测试。
- [x] 实现 `build_realtime_capabilities(settings, dependency_available=...)`。
- [x] 增加 `GET /healthz` 和 `GET /v1/realtime/capabilities`。
- [x] 运行聚焦 pytest。

### 任务 2：Desktop provider 状态与预检

**文件：**
- 新建：`apps/desktop/src/shared/asr-provider-catalog.ts`
- 新建：`apps/desktop/src/shared/agent-capabilities.ts`
- 新建：`apps/desktop/src/shared/realtime-preflight.ts`
- 测试：`apps/desktop/tests/realtime-preflight.test.ts`
- 修改：`apps/desktop/src/shared/desktop-api.ts`
- 修改：`apps/desktop/src/preload/index.ts`
- 修改：`apps/desktop/src/main/main.ts`

- [x] 增加 Vitest，覆盖预检失败和有效真实 provider 选择。
- [x] 实现共享 provider/catalog/capabilities 类型。
- [x] 通过 main 和 preload 桥接 `agent:get-capabilities`。
- [x] 运行聚焦 Vitest。

### 任务 3：Renderer UI 接线

**文件：**
- 修改：`apps/desktop/src/renderer/main.tsx`
- 修改：`apps/desktop/src/renderer/realtime-audio-client.ts`
- 测试：`apps/desktop/tests/realtime-audio-client.test.ts`

- [x] 将 ASR provider 类型移动到共享 catalog。
- [x] 在 Idle dashboard 增加 ASR provider 和延迟模式选择。
- [x] 启动前刷新 capabilities，并阻止无效选择。
- [x] 将显式 provider 选择传入 `createRealtimeAudioClient`。
- [x] 运行桌面端 typecheck 和聚焦测试。

### 任务 4：文档与审计

**文件：**
- 修改：`README.md`
- 修改：`doc/architecture-mvp.md`
- 修改：`docs/caption-chain-audit.md`
- 修改：`docs/superpowers/plans/2026-06-06-session-asr-switching-funasr-optimization.md`

- [x] 更新 capabilities/preflight 文档。
- [x] 修正过期的“默认 funasr”表述。
- [x] 搜索并修正过期口径。
- [x] 运行 Agent/Desktop 验证。
