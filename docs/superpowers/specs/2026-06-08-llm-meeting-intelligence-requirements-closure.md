# EchoSync LLM 会议智能增强需求收口

## 背景

本文档明确 EchoSync 的 LLM 会议智能方向、当前状态、核心缺口和优先级边界。目标是把"发散想法"收敛为"可执行需求"，确保后续开发不跑偏。

**核心定位**：EchoSync 的 LLM 会议智能应该是 **evidence-first**（证据优先、可追溯、可审计），而不是通用聊天机器人或黑盒会议纪要生成器。

**核心原则**：

- 每个 AI 结论必须能回链到源片段、时间戳和原文/译文。
- 摘要/行动项/风险/决策不是"AI 说了算"，而是"用户可以验证"。
- 会议智能应消费已保存的 session record / committed segments / audio index，不阻塞实时 ASR partial 或字幕发布。
- fail-open：LLM 失败不影响会话记录保存和音频回放。

## 当前所有权

### Desktop main 本地后端（当前已实现）

- 会话记录持久化：`apps/desktop/src/main/session-record-store.ts`。
- 会话摘要生成：`apps/desktop/src/main/session-summary-generator.ts` 和 `session-summary-runner.ts`。
- 使用 OpenAI-compatible/DeepSeek 接口，基于保存后的双语片段生成摘要、关键词、行动项、主题、风险、术语建议。
- 详情页右侧展示摘要字段，支持手动重新生成。

### Python Agent（当前未实现）

- Python Agent 当前不拥有会议智能 API。
- 没有 `/v1/session-summary`、`/v1/minutes`、`/v1/meeting-qa` 等接口。
- 未来如果需要 Web、多端、服务端部署，可以再抽象为 Agent/Server API，但不在当前阶段。

## 已闭环能力

1. 本地记录存储：`session.json` 和音频文件持久化到 `{userData}/echosync-data/sessions/{sessionId}/`。
2. 记录列表/详情：首页和会议记录窗口读取真实 `sessionRecords.list()`，详情页支持查看、删除、重命名、导出 TXT/SRT/Markdown。
3. 音频回放：播放音频、点击片段 seek、高亮当前片段。
4. 摘要生成器：Desktop main 后台调用 OpenAI-compatible/DeepSeek 接口，生成摘要、关键词、行动项、主题、风险、术语建议。
5. 摘要展示与重试：详情页右侧展示摘要字段，支持手动重新生成摘要。

## 核心缺口

### 缺口 1：Evidence anchors（证据锚点）

**当前状态**：

- `SessionRecordSummary` 的 `actionItems`、`topics`、`risks`、`terminologySuggestions` 是字符串数组。
- 不绑定到具体 segment/time range/原文证据。
- 用户无法点击摘要条目跳转到对应音频片段。

**目标**：

每个摘要结论都应绑定到源片段和时间戳：

```ts
type ActionItem = {
  id: string;
  text: string;
  owner?: string;
  dueDate?: string;
  confidence?: number;
  evidence: EvidenceAnchor[];
};

type EvidenceAnchor = {
  segmentId: string;
  startMs: number;
  endMs: number;
  quote: string;
  relevance: number;
};
```

**验收标准**：

- 用户点击行动项/风险/决策后，复盘页跳转到对应音频片段并高亮原文/译文。
- 每个 evidence anchor 显示引用文本片段和相关度。
- 摘要生成失败不影响会话记录保存和音频回放（fail-open）。

### 缺口 2：结构化摘要输出

**当前状态**：

- 摘要生成器使用简单 JSON 解析，只验证字符串/字符串数组。
- `actionItems` 没有 owner/dueDate/priority/status 等字段。
- `risks` 没有 severity/mitigation 等字段。

**目标**：

扩展摘要 schema 为结构化对象：

```ts
type MeetingSummary = {
  status: "pending" | "ready" | "failed";
  text?: string;
  keywords?: string[];
  actionItems?: ActionItem[];
  topics?: Topic[];
  risks?: Risk[];
  decisions?: Decision[];
  terminologySuggestions?: TerminologySuggestion[];
  errorMessage?: string;
  updatedAt?: string;
};

type Topic = {
  id: string;
  name: string;
  summary: string;
  evidence: EvidenceAnchor[];
};

type Risk = {
  id: string;
  description: string;
  severity: "low" | "medium" | "high";
  mitigation?: string;
  evidence: EvidenceAnchor[];
};

type Decision = {
  id: string;
  description: string;
  rationale?: string;
  owner?: string;
  evidence: EvidenceAnchor[];
};

type TerminologySuggestion = {
  source: string;
  target: string;
  context: string;
  confidence: number;
  evidence: EvidenceAnchor[];
};
```

**验收标准**：

- 摘要生成器输出符合结构化 schema。
- UI renderer 展示结构化字段（owner、severity、dueDate）。
- 模型输出不符合 schema 时，摘要状态为 `failed`，不静默降级为空数组。

### 缺口 3：摘要输入增强

**当前状态**：

- 摘要输入只来自最终 `SessionRecord.segments`。
- 没有和 Agent diagnostics、术语命中、翻译缺口等后端诊断自动合并。

**目标**：

摘要 prompt 应包含更丰富上下文：

- 最终双语片段（已有）。
- 聚合 diagnostics flag：`hasTimingAnomaly`、`hasTranslationGap`。
- 术语命中/缺失统计：required terms missing、preferred terms hit rate。
- 翻译缺口标记：哪些片段翻译失败或超时。
- 可选会话 metadata：场景（技术分享/课程/会议）、语言方向、质量模式。

**验收标准**：

- 摘要 prompt 包含 diagnostics 和 glossary metrics。
- 摘要能识别并标注"翻译质量存疑"或"关键术语缺失"的片段。
- 不阻塞实时字幕链路：diagnostics 只在会话结束后合并。

### 缺口 4：Unsupported claim 校验

**当前状态**：

- 摘要生成器不校验结论是否有源片段支持。
- 模型可能编造不存在的行动项或风险。

**目标**：

增加 post-generation 校验：

- 每个 `ActionItem`、`Risk`、`Decision` 必须至少有一个 `EvidenceAnchor`。
- 每个 `EvidenceAnchor.segmentId` 必须存在于 `SessionRecord.segments`。
- 每个 `EvidenceAnchor.quote` 必须是对应 segment 的子串或近似匹配。

**验收标准**：

- 校验失败的条目被标记为 `unsupported: true` 或从输出中移除。
- 日志记录 unsupported claim rate。
- UI 显示"部分结论缺少证据支持"警告。

## P0：当前阶段必须完成

1. **Evidence anchors 数据模型**：扩展 `SessionRecordSummary` 为结构化对象，增加 `EvidenceAnchor` 类型。
2. **结构化摘要输出**：`ActionItem`、`Topic`、`Risk`、`Decision` 包含 id/text/evidence/confidence 等字段。
3. **UI citation renderer**：用户点击摘要条目跳转到对应音频片段和原文/译文。
4. **Unsupported claim 校验**：post-generation 校验每个结论是否有源片段支持。
5. **摘要输入增强**：合并 diagnostics、glossary metrics 到摘要 prompt。
6. **Fail-open**：LLM 失败不影响会话记录保存和音频回放。

## P1：重要增强，但不阻塞 P0

1. **实时追赶（Realtime Catchup）**：用户中途加入或短暂离开后，快速追上进度。可以是"最近 N 分钟摘要"或"重点片段快速回放"。
2. **会后可验证问答（Meeting QA）**：基于 transcript/audio/evidence 回答用户问题，每个答案带 evidence anchors。
3. **轻量 ContextPack**：用户可以为会话添加背景资料（课程大纲、项目文档、专业术语表），摘要生成时参考这些上下文。

## P2：后续阶段能力

1. **多源资料对齐**：将字幕、PPT、文档、聊天记录等资料与会议时间线对齐。
2. **课程学习助手**：从课程复盘延伸出知识点、练习题、笔记整理等教育场景能力。
3. **外部任务系统集成**：将行动项同步到 Notion、Jira、Trello 等任务管理系统。
4. **多人协作复盘**：支持团队成员共同编辑摘要、标注片段、添加评论。

## 非目标

以下内容不应在当前阶段实现，避免开发跑偏：

- **通用聊天机器人**：不做"跟 AI 聊天"功能，只做 evidence-first 会议智能。
- **每个 ASR partial 的复杂 LLM 推理**：LLM 会议智能应消费已保存的 committed segments，不阻塞实时字幕热路径。
- **默认 TTS 总结播报**：不把摘要自动转成语音播报，避免增加延迟和复杂度。
- **精准说话人承诺**：当前不承诺精准多人说话人分离和 speaker-level 归因。
- **普通用户模型选择 UI**：摘要模型配置仍通过 `.env` 或高级设置，不在首页/偏好设置常规面板暴露。
- **会议机器人入会**：EchoSync 是个人听译层，不是会议平台本身，不做入会机器人。

## 输入输出契约

### 输入

- **最终 session record segments**：不直接读实时 event stream，避免阻塞字幕发布。
- **可选 diagnostics summary**：聚合 flag、术语命中、翻译缺口。
- **可选 glossary metrics**：required terms missing、preferred terms hit rate。
- **可选 translation gaps**：哪些片段翻译失败或超时。

### 输出

- **结构化 `MeetingSummary`**：包含 `actionItems`、`topics`、`risks`、`decisions`、`terminologySuggestions`。
- **每个结论带 `EvidenceAnchor[]`**：绑定到 segment/time range/quote。
- **fail-open**：生成失败时 `status: "failed"`，保留 `errorMessage`，不影响会话记录保存。

## 与其他文档关系

- 引用 `2026-06-07-unimplemented-feature-gap-audit.md` 作为当前实现缺口审计。
- 引用 `2026-06-06-session-record-review-translation-reliability-design.md` 作为会话记录与复盘设计规格。
- 引用 `doc/architecture-mvp.md` 作为系统架构入口。
- 当前所有权：Desktop main 本地摘要生成，不是 Python Agent API。长期可抽象到 Agent/Server，但不在当前阶段。

## 实施边界

**当前阶段必须做**：

- Evidence anchors 数据模型。
- 结构化摘要输出。
- UI citation click-through。
- Unsupported claim 校验。
- 摘要输入增强（diagnostics/glossary metrics）。

**当前阶段不要做**：

- Agent 侧会议智能 API（除非 Web、多端部署真的需要）。
- 实时追赶、会后问答、多源资料对齐、课程学习助手（P1/P2）。
- 通用聊天机器人、每个 ASR partial 的复杂 LLM 推理、默认 TTS 总结播报。

**哪些地方只能预留接口，不能展开实现**：

- 多源资料对齐：当前只预留 `ContextPack` 数据模型，不实现 PPT/文档解析和时间线对齐。
- 外部任务系统：当前只预留 `ActionItem` 的 `externalId` 和 `syncStatus` 字段，不实现 Notion/Jira 集成。

**哪些地方必须先确认后再开发**：

- 摘要 prompt 策略：是否需要多轮推理、chain-of-thought、self-critique？先在小样本上验证效果再决定。
- Evidence anchor 匹配算法：精确子串匹配 vs fuzzy matching vs semantic similarity？先用精确匹配验证可行性。
- UI citation renderer 交互：点击跳转 vs hover preview vs 侧边栏展开？需要 UX 确认。
