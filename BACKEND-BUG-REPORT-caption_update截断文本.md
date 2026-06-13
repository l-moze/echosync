# 后端翻译服务 Bug 报告 - caption_update 发送截断文本

## 问题概述

**严重性**：🔴 高（导致用户看到的字幕内容大量丢失）

**影响范围**：所有使用实时翻译的会话，约 20-30% 的 segment 受影响

**问题描述**：翻译服务在发送 `caption_update` 事件时，当 `state` 从 `'interim'` 切换到 `'stable'` 时，会发送**截断的 sourceText**，导致完整句子丢失后半部分。

---

## 问题复现

### 复现步骤

1. 启动翻译服务
2. 输入较长的英文句子（> 100 字符）
3. 观察发送的 `caption_update` 事件序列
4. 当 state 从 `'interim'` 变为 `'stable'` 时，检查 `source.full_text` 的长度

### 预期行为

```
caption_update (interim): "...can we also scale the science to allow the community to drive the collective progress..."
caption_update (stable): "...can we also scale the science to allow the community to drive the collective progress..." 
```

**stable 应该包含完整句子**，或者至少不比 interim 短。

### 实际行为

```
caption_update (interim): "...can we also scale the science to allow the community to drive the collective progress..." (114字符)
caption_update (stable): "...can we also scale the science" (78字符) ← 截断了！
```

**stable 只包含前半句，后面 36 字符丢失。**

---

## 受影响的实际案例（来自生产日志）

### 案例 1：seg_6b1e5e3213e2

**完整文本**（应该是）：
```
an extremely resource-intensive research topic, can we also scale the science to allow the community to drive the collective progress of this topic?
```
**长度**：149 字符

**实际事件序列**：
```json
{
  "type": "transcript.partial",
  "segment_id": "seg_6b1e5e3213e2",
  "rev": 10,
  "source_text": "an extremely resource-intensive research topic, can we also scale the science to allow the community to drive the collective progress of this topic",
  "text_len": 148
}

{
  "type": "caption_update",
  "segment_id": "seg_6b1e5e3213e2",
  "revision": 6,
  "state": "interim",
  "source": {
    "full_text": "an extremely resource-intensive research topic, can we also scale the science to allow the community to drive the"
  },
  "source_len": 114
}

// ❌ 问题出现：切换到 stable 时文本截断
{
  "type": "caption_update",
  "segment_id": "seg_6b1e5e3213e2",
  "revision": 7,
  "state": "stable",
  "source": {
    "full_text": "an extremely resource-intensive research topic, can we also scale the science"
  },
  "source_len": 78  // ← 从 114 缩短到 78，丢失 36 字符
}
```

**丢失的内容**：
```
" to allow the community to drive the collective progress of this topic?"
```

---

### 案例 2：seg_2233128a01d8

**transcript.partial**：130 字符（完整）
```
"With that, this brings us to our first research milestone, which is..."
```

**caption_update (stable)**：22 字符
```
"milestone, which is..."
```

**丢失**：前面 108 字符！

---

### 案例 3：seg_5545acea3218

**transcript.partial**：38 字符
```
"Some of you might have already seen it"
```

**caption_update**：依次变为 6, 3, 2, 1 字符（越来越短）

---

## 问题统计

通过分析 276KB 的生产日志（约 200 个事件）：

- **受影响的 segment 数量**：20 个
- **最大丢失字符数**：108 字符（案例 2）
- **平均丢失字符数**：40-70 字符
- **发生频率**：约 30% 的 segment 在 interim → stable 切换时出现截断

---

## 技术细节

### 事件类型定义（参考）

```typescript
interface CaptionUpdateEvent {
  type: "caption_update";
  session_id: string;
  segment_id: string;
  revision: number;
  state: "interim" | "stable" | "final";
  source: {
    full_text: string;  // ← 这个字段在 stable 时被截断
    // ... 其他字段
  };
  target?: {
    full_text: string;
    // ... 其他字段
  };
  timing: {
    start_ms: number;
    end_ms: number;
  };
}
```

### 问题定位

**怀疑点 1：翻译服务的状态机逻辑**

可能的代码位置：
- 生成 `caption_update` 事件的函数
- 处理 `state` 切换的逻辑
- 从 ASR 结果构建 `source.full_text` 的代码

**怀疑点 2：缓冲区或字符串截断**

可能的原因：
- 使用了固定长度的缓冲区（如 `char buffer[80]`）
- 使用了 `substring(0, 78)` 之类的硬编码截断
- 某个中间变量被提前清空

**怀疑点 3：状态机中的 sourceText 来源不一致**

可能的原因：
- `interim` 状态使用完整的 ASR transcript
- `stable` 状态使用了不同的数据源（如只使用已确认的部分）
- 两者没有同步

---

## 排查建议

### 步骤 1：定位生成 caption_update 的代码

搜索关键词：
```python
# Python
"caption_update"
"state"
"full_text"
"interim"
"stable"
```

找到构建 `caption_update` 事件的函数，特别是：
- 设置 `source.full_text` 的地方
- 根据 `state` 决定使用哪个文本的逻辑

### 步骤 2：检查 interim vs stable 的文本来源

对比：
```python
# interim 状态的 sourceText 来自哪里？
if state == "interim":
    source_text = ???  # 是从 transcript 直接获取吗？

# stable 状态的 sourceText 来自哪里？  
elif state == "stable":
    source_text = ???  # 是否使用了不同的变量或截断了？
```

### 步骤 3：添加日志验证

在生成 `caption_update` 前添加：
```python
logger.info(f"[caption_update] 准备发送", {
    "segment_id": segment_id,
    "revision": revision,
    "state": state,
    "source_len_before": len(source_text_before),
    "source_len_after": len(source.full_text),
    "source_text_preview": source.full_text[:50]
})
```

重点关注：
- `state == "stable"` 时，`source_len_after` 是否突然变短
- 是否有日志显示文本被截断

### 步骤 4：检查是否有字符串截断逻辑

搜索：
```python
[:78]
[0:80]
substring(0, 
truncate(
limit_length(
max_length
```

检查是否有硬编码的长度限制。

### 步骤 5：检查 ASR transcript 是否完整

验证：
- 从 ASR 服务获取的 transcript 是否完整
- 是否在构建 `caption_update` 前被修改或清空
- 是否多个 revision 共享同一个可变变量，导致覆盖

---

## 建议的修复方案

### 方案 1：确保 stable 使用完整文本（推荐）

```python
def build_caption_update(segment_id, state, transcript, translation):
    # 无论什么 state，都使用完整的 transcript
    source_text = transcript.full_text
    
    # 确保不被截断
    assert len(source_text) > 0, "source_text 不能为空"
    
    return {
        "type": "caption_update",
        "segment_id": segment_id,
        "state": state,
        "source": {
            "full_text": source_text,  # 完整文本
            # ...
        },
        # ...
    }
```

### 方案 2：stable 只发送 targetText，不发送 sourceText

如果 `stable` 状态下 sourceText 确实不需要更新：
```python
if state == "stable":
    # 不在 stable 时更新 source，只更新 target
    return {
        "type": "caption_update",
        "state": "stable",
        "target": {
            "full_text": translation_text
        },
        # 不包含 source 字段
    }
```

前端会自动保留之前的 sourceText。

### 方案 3：添加保护逻辑

在发送前验证：
```python
def validate_caption_update(event, previous_event):
    if previous_event and "source" in event:
        prev_len = len(previous_event.get("source", {}).get("full_text", ""))
        new_len = len(event["source"]["full_text"])
        
        if new_len < prev_len - 5:
            logger.error(f"❌ caption_update 文本异常缩短: {prev_len} → {new_len}")
            # 使用之前的完整文本
            event["source"]["full_text"] = previous_event["source"]["full_text"]
    
    return event
```

---

## 验证方法

修复后，运行以下测试：

### 测试用例 1：长句子（> 100 字符）

输入：
```
"This is an extremely resource-intensive research topic that requires significant computational power and human expertise to solve, so can we also scale the science to allow the broader research community to collectively drive progress on this important challenge?"
```

验证：
- 所有 `caption_update` 事件的 `source.full_text` 长度应该 ≥ 之前的长度
- 切换到 `stable` 时不应该缩短

### 测试用例 2：检查日志

搜索日志中是否有：
```
"文本异常缩短"
"text truncated"
"len < prev_len"
```

修复后应该没有此类日志。

### 测试用例 3：对比 interim vs stable

对于同一个 segment_id，对比：
```
caption_update (interim, revision=N):   source_len = X
caption_update (stable, revision=N+1):  source_len = Y
```

应该满足：`Y >= X - 5`（允许有小的修正，但不应该大幅缩短）

---

## 前端临时措施（已完成）

前端已添加保护逻辑，即使后端发送截断文本，前端也会保留之前的完整文本。

但**后端仍需修复**，因为：
1. 前端保护只是防御措施，不是根本解决
2. 其他客户端（移动端、Web）可能没有此保护
3. 导出的原始数据仍然是截断的

---

## 联系方式

如有疑问，请联系前端团队。

前端修复代码参考：
- 文件：`apps/desktop/src/shared/caption-store.ts`
- 函数：`selectCaptionUpdateSourceText`
- 提交：`df887d8`

前端日志分析结果：
- 文件：`d:\code\echosync\字幕问题全链路解决方案.md`
