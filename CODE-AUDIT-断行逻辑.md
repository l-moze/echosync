# EchoSync 代码审计 - 断行逻辑分析

## 审计目标

用户反馈：
1. "遇到句号就硬断行" - 需要验证是否属实
2. 代码有重复逻辑 - 需要找出并整合
3. 文档有重复内容 - 需要合并
4. 可能存在 bug - 需要定位

## 第一步：现有文档梳理

### 1.1 已有文档
```
FIX-SUMMARY.md (7101 bytes)
- 字幕闪烁和重复打字问题
- 事件缓冲区溢出
- 修复方案和验证清单

DIAGNOSIS-TEXT-LOSS.md (?)
- 字幕文本丢失诊断

字幕问题全链路解决方案.md (?)
- caption_update 截断文本问题

BACKEND-BUG-REPORT-caption_update截断文本.md (?)
- 后端 bug 详细报告
```

### 1.2 文档重复问题
- ❓ 是否有多个文档描述相同问题
- ❓ 是否应该合并为一个主文档

## 第二步：断行逻辑代码分析

### 2.1 核心常量（caption-text-view.ts:44-50）
```typescript
const SOURCE_SOFT_BLOCK_CHARS = 112;      // 软断行：112 字符
const TARGET_SOFT_BLOCK_CHARS = 44;
const SOURCE_HARD_BLOCK_CHARS = 148;      // 硬断行：148 字符
const TARGET_HARD_BLOCK_CHARS = 64;
const SOURCE_PENDING_CHARS = 118;         // 开始考虑断行：118 字符
const TARGET_PENDING_CHARS = 68;
const SOURCE_HARD_PENDING_CHARS = 230;
```

### 2.2 核心函数调用链

```
updateBlockLane
  ├─ reconcileLaneState (调和状态)
  ├─ shouldStartPendingSplit (是否达到断行阈值？)
  │   └─ findNextCommittedBreak (查找断行位置)
  │       └─ splitDisplayBlocks
  │           ├─ splitByStrongBoundaries (句号、问号)
  │           ├─ splitByDiscourseBoundary (连词)
  │           └─ splitLongBlock (强制切分)
  └─ 计算 graceMs 延迟 (380ms)
```

### 2.3 关键判断点

**Q1: "遇到句号就硬断行" 是否属实？**

检查 `shouldStartPendingSplit`:
```typescript
function shouldStartPendingSplit(text: string, lane: "source" | "target"): boolean {
  const limit = lane === "source" ? SOURCE_PENDING_CHARS : TARGET_PENDING_CHARS;
  return visibleLength(text) > limit && findNextCommittedBreak(text, 0, lane) < text.length;
}
```

**结论待验证**：
- 前提条件：`visibleLength(text) > 118`
- 说明：只有累积到 118 字符后才会考虑断行
- **如果用户反馈属实，说明这个逻辑有 bug**

**Q2: graceMs 延迟是否生效？**

检查 `updateBlockLane`:
```typescript
const pendingSinceMs = base.pendingSinceMs ?? nowMs;
const graceMs = shouldHardSplit(tail, lane) ? HARD_SPLIT_GRACE_MS : SOFT_SPLIT_GRACE_MS;
if (nowMs - pendingSinceMs < graceMs) {
  return { ...base, pendingSinceMs };  // 延迟中，不断行
}
```

**结论待验证**：
- 有 380ms 延迟
- **需要确认 nowMs 是否正确传递**

## 第三步：查找重复逻辑

### 3.1 文本长度计算

搜索关键词：
- `visibleLength`
- `countVisibleCharacters`
- `.length`

**待查找**：是否有多个地方计算文本长度？

### 3.2 文本分割逻辑

搜索关键词：
- `split`
- `break`
- `boundary`

**待查找**：
- `splitDisplayBlocks` vs 其他分割函数
- 是否有逻辑重复？

### 3.3 状态更新逻辑

搜索关键词：
- `reconcile`
- `update`
- `commit`

**待查找**：
- `reconcileLaneState` vs `upsertTranscriptDraft` vs `upsertCaptionUpdate`
- 是否有状态更新逻辑重复？

## 第四步：可能的 Bug 定位

### 4.1 用户反馈："遇到句号就硬断"

**假设 1**：`SOURCE_PENDING_CHARS` 设置过小
- 当前：118 字符
- 用户感觉：遇到句号就断
- **可能原因**：短句子（如 "Hello. How are you?"）在第一个句号时刚好达到 118 字符？

**假设 2**：`findNextCommittedBreak` 逻辑问题
- 是否总是选择第一个句号，而不是最合适的？
- 是否没有考虑句子完整性？

**假设 3**：`graceMs` 延迟未生效
- `nowMs` 是否正确传递？
- `pendingSinceMs` 是否被意外重置？

### 4.2 需要验证的场景

创建测试用例：
```
场景 1：短句子（< 118 字符）
输入："Hello. How are you? I'm fine."
预期：不应该断行
实际：？

场景 2：长句子（> 118 字符）但无标点
输入："This is a very long sentence without any punctuation marks..."
预期：达到 148 字符后强制断行
实际：？

场景 3：长句子有多个句号
输入："First sentence. Second sentence. Third sentence..."
预期：在第一个句号断行，延迟 380ms
实际：？
```

## 第五步：行动计划

### 5.1 立即行动（不写代码）
1. ✅ 回滚刚才的注释提交
2. ⏳ 阅读所有现有文档，标记重复内容
3. ⏳ 追踪 `updateBlockLane` 的所有调用点
4. ⏳ 验证 `nowMs` 的传递链路
5. ⏳ 检查是否有其他断行逻辑（如分区模式）

### 5.2 代码审查清单
- [ ] `caption-text-view.ts` 中的所有 split* 函数
- [ ] `caption-store.ts` 中的状态更新逻辑
- [ ] 是否有其他文件也实现了类似逻辑
- [ ] `reconcileLaneState` 的 RESET 触发条件

### 5.3 文档整理清单
- [ ] 合并重复的修复总结文档
- [ ] 创建统一的架构文档
- [ ] 删除过时或临时的诊断文档

## 第六步：待解答的问题

1. **用户说"遇到句号就硬断"，但代码有 118 字符阈值，为什么？**
   - 是否有其他路径绕过了这个检查？
   - 是否分区模式有不同的逻辑？

2. **是否有多个地方实现断行？**
   - 逐行模式 vs 分区模式
   - 实时显示 vs 复盘显示

3. **`committedBreaks` 的管理是否一致？**
   - 谁设置？谁清空？谁过滤？

4. **现有的修复是否完整？**
   - FIX-SUMMARY.md 中提到的修复 3 和 4
   - 是否还有遗漏的边界情况？

---

## 下一步

**不写任何代码，先完成：**
1. 追踪 `updateBlockLane` 的所有调用点
2. 找出是否有其他断行逻辑
3. 验证用户反馈的真实性（可能是误解）
4. 整理文档，标记重复内容
