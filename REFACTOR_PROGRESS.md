# EchoSync 前端重构进度跟踪

## 当前状态

- **重构分支**: `feat/prompt-contract-ab-eval`
- **当前阶段**: 阶段 1 - 纯展示组件抽离
- **开始时间**: 2026-06-08
- **最后更新**: 2026-06-08

## 整体目标

将 `apps/desktop/src/renderer/main.tsx` 从 5099 行重构为清晰、可维护的模块化结构（目标 < 500 行）。

## 基线状态

### 代码基线
- **初始行数**: 5099 行（main.tsx）
- **当前行数**: 5023 行（main.tsx）
- **已减少**: 76 行（1.5%）

### 测试基线
- **TypeScript 类型检查**: 2 个基线错误
  - `src/main/main.ts:18` - SessionRecordSegmentUpdate 导入错误
  - `src/main/main.ts:340` - updateSegment 不存在
- **测试状态**: 未运行完整测试套件

## 阶段 1：纯展示组件抽离

**目标**: 抽离 10-15 个纯展示组件，建立清晰的组件边界

### 已完成小批次

#### 第一小批次 ✅
- **提交**: `a8bb6f3` - 重构前端：抽离通用展示组件（AudioLoadingBars、PreferenceRow、HealthMetric）
- **组件数**: 3 个
- **新增目录**: `components/common/`
- **行数变化**: 5099 → 5079（-20 行）

#### 第二小批次 ✅
- **提交**: `97eef88` - 重构前端：抽离首页展示组件（LauncherRow、PreferenceMiniCard）
- **组件数**: 2 个
- **新增目录**: `components/home/`
- **行数变化**: 5079 → 5045（-34 行）

#### 第三小批次 ✅
- **提交**: `1e3705a` - 重构前端：抽离会议记录展示组件（RecordSummaryList）
- **组件数**: 1 个
- **新增目录**: `components/records/`
- **行数变化**: 5045 → 5030（-15 行）

#### 第四小批次 ✅
- **提交**: `1305392` - 重构前端：抽离设置面板展示组件（StyleSection）
- **组件数**: 1 个
- **新增目录**: `components/settings/`
- **行数变化**: 5030 → 5023（-7 行）

### 累计成果

**已抽离组件**: 7 个
- `AudioLoadingBars` - 音频加载动画
- `PreferenceRow` - 偏好设置行
- `HealthMetric` - 健康指标
- `LauncherRow` - 启动器行
- `PreferenceMiniCard` - 偏好设置小卡片
- `RecordSummaryList` - 记录摘要列表
- `StyleSection` - 样式区域容器

**目录结构**:
```
src/renderer/components/
├── common/           # 通用组件（3 个）
│   ├── AudioLoadingBars.tsx
│   ├── HealthMetric.tsx
│   └── PreferenceRow.tsx
├── home/             # 首页组件（2 个）
│   ├── LauncherRow.tsx
│   └── PreferenceMiniCard.tsx
├── records/          # 会议记录组件（1 个）
│   └── RecordSummaryList.tsx
└── settings/         # 设置组件（1 个）
    └── StyleSection.tsx
```

### 下一步计划

#### 第五小批次（待评估）
**候选组件**:
1. `PreflightAudioVisualizer` - 音频预检可视化（9 行）
2. `SessionSummaryPanel` - 会话摘要面板（15 行）

**风险评估**:
- ⚠️ 需要检查 `SessionUiState` 类型依赖
- ⚠️ 需要确认无反向依赖 main.tsx

## 阶段 2：Hooks 抽离（未开始）

**目标**: 抽离 5-8 个自定义 hooks

**候选 Hooks**:
- `useOverlayLock` - 悬浮窗锁定状态
- `useSubtitleStyle` - 字幕样式管理
- `useSessionLifecycle` - 会话生命周期
- `useLanguageDirection` - 语言方向管理

**约束**:
- ❌ 阶段 1 未完成前不进入阶段 2
- ❌ 不能在阶段 1 中抽离 hooks

## 阶段 3：Services/Adapters 抽离（未开始）

**目标**: 抽离 3-5 个服务模块

**候选 Services**:
- `desktop-api.ts` - IPC 调用适配层
- `realtime-service.ts` - 实时通信服务
- `storage-service.ts` - 本地存储服务

**风险**:
- ⚠️ 高风险阶段
- ⚠️ 需要仔细测试所有副作用

## 阶段 4：Types/Constants 抽离（未开始）

**目标**: 抽离类型定义和常量

## 约束和原则

### 当前阶段约束（阶段 1）

**允许**:
- ✅ 抽离纯展示组件
- ✅ 保持 className 完全不变
- ✅ 保持 JSX 渲染结构等价
- ✅ 保持 props 语义不变

**禁止**:
- ❌ 抽 hooks
- ❌ 抽 services
- ❌ 抽工具函数
- ❌ 抽复杂常量
- ❌ 改状态流
- ❌ 改业务逻辑
- ❌ 改 CSS 视觉效果
- ❌ 改后端代码
- ❌ 改 IPC/API/LiveKit/WebSocket 协议
- ❌ 改实时字幕流
- ❌ 改字幕滚动逻辑
- ❌ 改窗口锁定/解锁
- ❌ 改语言切换
- ❌ 改翻译模型切换
- ❌ 改鼠标悬停设置模式

### 组件抽离标准

**优先抽离**:
- 有明确业务语义的展示块
- JSX 行数较多的静态区域（10+ 行）
- 重复出现的展示结构
- Props 边界清晰的 UI 片段
- 可以形成稳定目录边界的组件

**暂时不抽离**:
- 只有几行 children wrapper 的组件
- 只包一层 div 的组件
- 业务语义不明确的组件
- 需要传入大量零散 props 的组件
- 抽出来后反而让阅读链路变长的组件

### 验证原则

**每批次必须执行**:
1. `git diff --stat`
2. `git diff --name-only`
3. `npm run typecheck`
4. 确认只改前端路径
5. 区分基线错误和新增错误

**错误处理**:
- 基线已有错误：2 个（TypeScript）
- 本次新增错误：必须 = 0

### 提交规范

- 提交信息必须以"重构前端："开头
- 必须使用中文
- 必须描述抽离的组件
- 每个小批次完成后立即提交

## 里程碑

- [ ] 阶段 1 完成（10-15 个组件）
- [ ] main.tsx < 4500 行
- [ ] 阶段 2 完成（5-8 个 hooks）
- [ ] main.tsx < 4000 行
- [ ] 阶段 3 完成（3-5 个 services）
- [ ] main.tsx < 3000 行
- [ ] 阶段 4 完成（types/constants）
- [ ] main.tsx < 500 行

## 风险和问题

### 已识别风险
1. ⚠️ `SessionUiState` 类型依赖 - 需要设计共享类型策略
2. ⚠️ `createInitialSessionUiState` 函数依赖 - 禁止反向依赖
3. ⚠️ 工具函数依赖 - 阶段 1 不抽离，需要保持导入

### 已解决问题
- ✅ 基线类型错误已记录，每次验证时区分
- ✅ 目录结构已建立（common、home、records、settings）

## 参考资料

- **Skill 文档**: `.claude/skills/frontend-refactor-maintainer/SKILL.md`
- **重构计划**: `C:\Users\24787\.claude\plans\moonlit-stargazing-porcupine.md`
