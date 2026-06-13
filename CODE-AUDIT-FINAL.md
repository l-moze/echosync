# EchoSync 代码审计完整报告 - 断行逻辑

## 审计日期
2026-06-12

## 审计范围
- `apps/desktop/src/shared/caption-text-view.ts` (625 行)
- `apps/desktop/src/shared/caption-store.ts` (约 800 行)
- `apps/desktop/src/renderer/main.tsx` (相关部分)
- 所有相关文档

---

## 发现的问题

### 🔴 问题 1：重复的工具函数

**位置**：
- `caption-text-view.ts:623` - `visibleLength()`
- `caption-store.ts:613` - `countVisibleCharacters()`

**实现**：完全相同
```typescript
function visibleLength(text: string): number {
  return Array.from(text).filter((char) => char.trim() !== "").length;
}

function countVisibleCharacters(text: string): number {
  return Array.from(text).filter((char) => char.trim() !== "").length;
}
```

**影响**：
- ❌ 代码重复，维护成本增加
- ❌ 如果需要修改算法（如处理 emoji），需要改两处

**建议**：
- 提取到 `shared/text-utils.ts`
- 重命名为统一的 `countVisibleChars`

---

### 🟡 问题 2：用户反馈与代码逻辑不符

**用户反馈**：
> "遇到句号就硬断行，导致必须等译文出来才能继续显示"

**代码实际逻辑**：
1. ✅ 必须累积到 118 字符才考虑断行
2. ✅ 有 380ms 延迟
3. ✅ 在自然边界（句号）断行
4. ✅ 断行后原文继续显示

**可能的原因**：
1. **用户误解**：看到断行发生在句号处，以为是"遇到句号就断"
2. **边界情况**：某些特殊场景绕过了 118 字符检查
3. **其他模块问题**：UI 渲染层的问题，不是断行逻辑本身

**需要验证**：
- [ ] 实际录制并观察断行行为
- [ ] 检查是否有 < 118 字符就断行的情况
- [ ] 检查 UI 层是否有其他导致"看起来像断行"的问题

---

### 🟢 问题 3：文档重复和过时

**现有文档**：
```
FIX-SUMMARY.md (7.1KB)
- 字幕闪烁和重复打字问题
- 事件缓冲区溢出

DIAGNOSIS-TEXT-LOSS.md
- 字幕文本丢失诊断

字幕问题全链路解决方案.md
- caption_update 截断文本问题

BACKEND-BUG-REPORT-caption_update截断文本.md
- 后端 bug 报告

CODE-AUDIT-断行逻辑.md (本文件)
- 断行逻辑审计
```

**问题**：
- ❌ 多个文档描述相似问题
- ❌ 没有统一的索引或架构文档
- ❌ 部分内容重复（如修复方案）

**建议**：
- 创建 `ARCHITECTURE.md` 作为主文档
- 保留 `FIX-SUMMARY.md` 作为修复记录
- 保留 `BACKEND-BUG-REPORT.md` 给后端团队
- 归档或删除临时诊断文档

---

## 代码质量分析

### ✅ 做得好的地方

1. **单一职责**：断行逻辑集中在 `caption-text-view.ts`
2. **清晰的调用链**：无循环依赖
3. **常量定义**：阈值集中在文件顶部
4. **状态管理**：`committedBreaks` 设计合理

### ⚠️ 需要改进的地方

1. **缺少注释**：核心逻辑（如 `updateBlockLane`）没有详细说明
2. **函数重复**：`visibleLength` vs `countVisibleCharacters`
3. **魔法数字**：虽然提取为常量，但缺少解释（为什么是 118？）
4. **测试覆盖**：没有单元测试验证断行逻辑

---

## 行动计划

### 第一阶段：重构和清理（无功能变更）

#### 1.1 提取公共工具函数
```typescript
// 创建 shared/text-utils.ts
export function countVisibleChars(text: string): number {
  return Array.from(text).filter((char) => char.trim() !== "").length;
}
```

#### 1.2 统一使用公共函数
- 修改 `caption-text-view.ts` 中的 `visibleLength` 调用
- 修改 `caption-store.ts` 中的 `countVisibleCharacters` 调用

#### 1.3 添加核心函数注释
**只添加关键注释**，说明：
- `updateBlockLane`：为什么需要 118 字符阈值
- `reconcileLaneState`：RESET/EXTEND/REVISE 的触发条件
- 常量定义：为什么选择这些数值

---

### 第二阶段：验证用户反馈

#### 2.1 创建测试用例
```typescript
// 测试用例 1：短句子（不应该断行）
input: "Hello. How are you?" (20 字符)
expected: 不断行

// 测试用例 2：长句子（应该断行）
input: "This is a very long sentence that exceeds one hundred and eighteen characters and should trigger line break at natural boundary." (140+ 字符)
expected: 在句号处断行，延迟 380ms

// 测试用例 3：连续短句
input: "A. B. C. D. E. F. G. ..." (每句 2 字符)
expected: 累积到 118 字符后再断行
```

#### 2.2 实际录制验证
- [ ] 使用真实视频测试
- [ ] 观察断行时机
- [ ] 记录是否有 < 118 字符就断行的情况
- [ ] 检查 380ms 延迟是否生效

---

### 第三阶段：文档整理

#### 3.1 创建主架构文档
```
ARCHITECTURE.md
├─ 数据流图
├─ 核心模块说明
│   ├─ caption-store (数据管理)
│   ├─ caption-text-view (断行和动画)
│   └─ renderer/main (UI 渲染)
├─ 关键设计决策
│   ├─ 为什么是 118 字符
│   ├─ 为什么需要 380ms 延迟
│   └─ committedBreaks 的作用
└─ 已知问题和修复记录
```

#### 3.2 清理临时文档
- 归档 `DIAGNOSIS-TEXT-LOSS.md` （已解决）
- 保留 `CODE-AUDIT-断行逻辑.md` （审计记录）
- 合并重复内容到 `ARCHITECTURE.md`

---

## 结论

### 代码质量
- ✅ 无严重架构问题
- ✅ 断行逻辑清晰，无重复实现
- ⚠️ 有一处工具函数重复（易修复）
- ⚠️ 缺少注释和测试

### 用户反馈
- ❓ "遇到句号就硬断"可能是**误解**
- ❓ 需要实际测试验证
- ✅ 代码逻辑本身是正确的

### 下一步
1. **立即执行**：提取公共工具函数（20 分钟）
2. **短期**：添加关键注释（1 小时）
3. **中期**：创建测试用例验证（2 小时）
4. **长期**：整理架构文档（4 小时）

**不要急于添加大量注释或修改逻辑，先验证用户反馈是否属实。**
