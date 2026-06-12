# 字幕截断问题修复报告

**日期**：2026-06-12  
**严重性**：🔴 高  
**影响范围**：约 20-30% 的 segment  
**状态**：✅ 已修复并测试通过

---

## 问题总结

**现象**：字幕在从 interim 切换到 stable 状态时会突然变短，丢失后半部分内容。

**案例**：
```
用户看到：
1. "...to allow the community to drive the collective progress" (133 chars) ✓
2. 几秒后变成："...to allow the community to drive the" (77 chars) ✗
3. 丢失了 56 个字符
```

---

## 根本原因

### 🎯 真正的 Bug：HypothesisUpdatePolicy

**文件**：`apps/agent/src/echosync_agent/services/realtime/hypothesis_update_policy.py`  
**行号**：第 34-35 行

```python
# 修复前的错误代码
if _has_meaningful_common_prefix(current_text, incoming_trimmed):
    return HypothesisUpdate(text=incoming_trimmed, mode="replace_hypothesis")
    # ↑ Bug: 只要有共同前缀，就用新文本替换，即使新文本更短！
```

### Bug 原理

**错误假设**：新来的 ASR 文本总是比当前文本更好。

**实际情况**：
- **ASR PARTIAL（预测）**：133 字符（激进预测，包含不确定尾部）
- **ASR COMMITTED（确认）**：77 字符（保守确认，只保留高置信度部分）

当两者有共同前缀（前 77 个字符相同）时，Bug 会直接用 77 字符替换 133 字符。

### 数据流

```
ASR 服务（正常行为）
  ↓ PARTIAL: 133 chars
TranscriptAssembler
  ↓
HypothesisUpdatePolicy ← Bug 在这里！
  ↓ 检测到共同前缀
  ↓ 用 77 chars 替换 133 chars ❌
翻译器（被动接收截断文本）
  ↓
caption_update
  ↓
前端显示（字幕丢失）
```

---

## 修复方案

### 修复 1：HypothesisUpdatePolicy（根本修复）

**文件**：`hypothesis_update_policy.py` 第 34-37 行

```python
# 修复后：只在新文本更长或相等时才替换
if _has_meaningful_common_prefix(current_text, incoming_trimmed):
    if len(incoming_trimmed) >= len(current_text):
        return HypothesisUpdate(text=incoming_trimmed, mode="replace_hypothesis")
    # Incoming is shorter - preserve current text
    return HypothesisUpdate(text=current_text, mode="replace_hypothesis")
```

**效果**：
- ✅ 新文本更长或相等 → 使用新文本（正常情况）
- ✅ 新文本更短 → 保留当前文本（防止截断）

### 修复 2：DeepSeekTranslator（第二层防御）

**文件**：`deepseek_translator.py`

**新增方法**：`_protect_source_text()` (69 行)

**作用**：
- 检查 revision 历史中的最长文本
- 如果当前文本明显缩短（>5 字符），保留历史文本
- 记录 metrics 用于监控

### 修复 3：前端保护（已存在，兜底）

**文件**：`caption-store.ts`

**作用**：最后一道防线，确保即使后端有问题也能保护用户体验。

---

## 测试验证

### 单元测试结果

| 测试套件 | 新增测试 | 结果 |
|---------|---------|------|
| hypothesis_update_policy | 3 个 | ✅ 11/11 passed |
| deepseek_translator_protection | 7 个 | ✅ 7/7 passed |
| deepseek_translator_contracts | 0 个 | ✅ 15/15 passed |

### 验证场景

**修复前**：
```python
current = "...drive the collective progress"  # 133 chars
incoming = "...scale the science"  # 77 chars
result = policy.apply(current, incoming)
# → 返回 77 chars ❌
```

**修复后**：
```python
current = "...drive the collective progress"  # 133 chars
incoming = "...scale the science"  # 77 chars
result = policy.apply(current, incoming)
# → 返回 133 chars ✅
```

---

## 修改文件清单

### 核心修复
1. ✅ `apps/agent/src/echosync_agent/services/realtime/hypothesis_update_policy.py` (3 行修改)
2. ✅ `apps/agent/src/echosync_agent/services/translation/deepseek_translator.py` (69 行新增)

### 测试文件
3. ✅ `apps/agent/tests/test_hypothesis_update_policy.py` (3 个新测试)
4. ✅ `apps/agent/tests/test_deepseek_translator_source_text_protection.py` (新文件，7 个测试)

---

## 监控指标

### 新增 Metrics

**翻译器层**：
- `source_text_protected`：保护触发次数（1.0 表示触发）
- `source_text_shrink_chars`：防止丢失的字符数

### 日志示例

```
WARNING source_text_truncation_detected 
  segment_id=seg_xxx rev=7 
  prev_len=133 curr_len=77 shrink=56 
  action=preserved
```

---

## 三层防御体系

```
┌──────────────────────────────────┐
│ 1. HypothesisUpdatePolicy        │ ← 根本修复（主要）
│    防止文本被截断                │
└──────────────────────────────────┘
            ↓ 如果失败
┌──────────────────────────────────┐
│ 2. DeepSeekTranslator            │ ← 第二道防线
│    利用 revision 历史保护        │
└──────────────────────────────────┘
            ↓ 如果失败
┌──────────────────────────────────┐
│ 3. 前端保护（caption-store.ts） │ ← 兜底
│    检查长度变化                  │
└──────────────────────────────────┘
```

---

## 关键教训

### 1. 不要急于甩锅
最初分析认为是 ASR 服务的问题，但深入排查后发现**问题在本地代码**。

### 2. ASR 的正常行为
ASR 服务的 PARTIAL（激进）→ COMMITTED（保守）行为是标准设计，所有主流 ASR 服务（Google/Azure/AWS/Qwen）都这样。

### 3. 多层防御
不应该只在一个地方修复：
- 根本修复（消除 Bug）
- 防御层（防止类似问题）
- 兜底（保护用户体验）

---

## 相关文档

- **Bug 分析**：`真正的根本原因-HypothesisUpdatePolicy的Bug.md`
- **ASR 行为分析**：`ASR截断问题根本原因分析.md`
- **原始 Bug 报告**：`BACKEND-BUG-REPORT-caption_update截断文本.md`
- **前端修复**：`字幕问题全链路解决方案.md`

---

## 状态

- ✅ 代码修复完成
- ✅ 单元测试通过
- ✅ 日志分析无新问题
- ⏳ 等待代码审查
- ⏳ 准备部署到测试环境

**修复完成，准备合并到主分支。** 🎉
