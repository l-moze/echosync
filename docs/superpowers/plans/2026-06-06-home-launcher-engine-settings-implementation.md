# 首页同传启动器与引擎设置实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Desktop Idle 首页从模型卡片控制台改成产品化同传启动器，并把模型选择迁移到“引擎与性能”设置区域。

**Architecture:** 新增共享文案与设置结构 helper，Idle UI 只消费产品化字段；现有 provider selection state 和启动 payload 不变。首页默认隐藏模型供应商名称，设置抽屉继续使用现有 ASR/翻译选项，Mock 只在开发者区域出现。

**Tech Stack:** React 19、TypeScript、Electron renderer、Vitest、CSS。

---

### Task 1: 首页文案与设置结构 helper

**Files:**
- Create: `apps/desktop/src/shared/home-launcher-copy.ts`
- Create: `apps/desktop/tests/home-launcher-copy.test.ts`

- [x] **Step 1: Write failing tests**

验证首页文案不包含普通首页禁止术语，状态摘要使用产品语言，引擎设置页使用“引擎与性能”和“开发者”分组。

- [x] **Step 2: Run test and verify failure**

Run: `npm --prefix apps/desktop test -- --run tests/home-launcher-copy.test.ts`

- [x] **Step 3: Implement helper**

导出 `HOME_LAUNCHER_COPY`、`HOME_FORBIDDEN_TERMS`、`buildHomeReadinessSummary()`、`ENGINE_SETTINGS_NAV`。

- [x] **Step 4: Verify tests pass**

Run: `npm --prefix apps/desktop test -- --run tests/home-launcher-copy.test.ts`

### Task 2: 重构 Idle 首页

**Files:**
- Modify: `apps/desktop/src/renderer/main.tsx`

- [x] **Step 1: Replace model cards**

删除 Idle 首页上的 ASR provider 卡片、翻译 provider 卡片和 Mock 可见入口。

- [x] **Step 2: Add launcher controls**

首页保留音频源、目标语言、质量模式、开始同传、字幕窗预览和一行状态摘要。

- [x] **Step 3: Add engine settings panel**

新增“引擎与性能”设置抽屉，迁移语音识别、翻译和开发者 Mock 选择。

- [x] **Step 4: Productize visible runtime copy**

把顶栏、启动取消弹窗和 Active 右栏残留的 `Agent`、`ASR`、`翻译模型`、`会话驾驶舱` 改成“同传服务”“语音识别”“翻译”“正在同传”等用户语言；代码层类型名和 provider 状态变量保持不变。

### Task 3: 样式升级

**Files:**
- Modify: `apps/desktop/src/renderer/styles.css`

- [x] **Step 1: Add launcher layout styles**

增加单主面板、双语字幕预览、状态摘要、设置抽屉和列表式引擎设置样式。

- [x] **Step 2: Reduce dashboard-card look**

Idle 页面避免 provider card grid 和准备就绪大卡片；保留 Active/Finished 既有结构。

### Task 4: 验证与文档同步

**Files:**
- Modify: `docs/superpowers/specs/2026-06-06-home-launcher-engine-settings-design.md`

- [x] **Step 1: Run focused tests**

Run:

```powershell
npm --prefix apps/desktop test -- --run tests/home-launcher-copy.test.ts tests/realtime-audio-client.test.ts
```

最新验证：

```powershell
npm --prefix apps/desktop test -- --run tests/home-launcher-copy.test.ts tests/realtime-audio-client.test.ts tests/caption-store.test.ts tests/caption-text-view.test.ts
```

结果：4 个测试文件、41 个测试通过。

- [x] **Step 2: Run desktop typecheck**

Run:

```powershell
npm --prefix apps/desktop run typecheck
```

结果：通过。

- [x] **Step 2.5: Run desktop builds**

Run:

```powershell
npm --prefix apps/desktop run build:renderer
npm --prefix apps/desktop run build:main
```

结果：通过。

- [x] **Step 3: Run diff check**

Run:

```powershell
git diff --check
```

结果：无空白错误，仅有既有 CRLF 转换提示。

- [ ] **Step 4: Commit**

暂不提交：`apps/desktop/src/renderer/main.tsx` 同时包含并发的 overlay resize / 字幕阴影改动，整文件提交会混入其他任务。

Commit message:

```text
优化首页同传启动器与引擎设置
```
