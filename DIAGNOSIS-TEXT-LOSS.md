# 字幕文本丢失问题完整诊断

## 问题现象

1. **实时显示时内容完整，保存后只剩几个词**
2. **长句子被截断，只保留最后几个词**
3. **字幕闪烁和重复打字**

## 已验证的事实

### ✅ 后端没有问题

通过分析 `main.log` 中的 `[transcript.partial] 后端发送` 日志，确认：
- 后端发送的文本是**完整累积的**
- 同一 segment_id 的文本从短到长逐步增加（2 → 5 → 10 → 17...）
- **没有发现文本异常缩短的情况**

示例（seg_3b851cb42c48）：
```
rev 1: "It" (2字符)
rev 2: "It is" (5字符)
rev 3: "It is also" (10字符)
...
rev 10: "It is also a very, very lossy one" (33字符)
```

### ✅ 主进程接收正常

- 事件缓冲区已扩容到 10000
- 没有发现大量事件被删除的情况
- IPC 传输没有问题

## 可疑的数据丢失点

### 1. caption_update 事件（⚠️ 高度可疑）

**位置**：`apps/desktop/src/shared/caption-store.ts:upsertCaptionUpdate`

**问题**：
```typescript
// 第 630 行
function selectCaptionUpdateSourceText(previousLine, event) {
  if (event.state === "final" || !previousLine) {
    return event.source.full_text;  // ❌ 直接覆盖，不保护
  }
  return selectTranslationSourceText(previousLine, event.source.full_text);
}
```

如果 `caption_update` 的 `state === "final"` 且 `source.full_text` 比 `previousLine.sourceText` 短，会导致内容丢失。

**验证方法**：
查看 `main.log` 中的 `[caption_update] 后端发送` 日志，检查：
- `state === "final"` 的事件
- `source_len` 是否比之前的 `transcript.partial` 短

### 2. 缓冲区事件丢失导致的序列不连续

**场景**：
```
后端发送：
- segment A: rev 1-15 逐步累积到 71 字符
- segment A: rev 16 继续累积...

缓冲区满，删除 rev 2-14

前端收到：
- segment A: rev 1 (2字符)
- segment A: rev 15 (71字符)  ← 正常
- segment A: rev 16 (73字符)  ← 正常
```

**已修复**：
- 缓冲区扩容到 10000 ✅
- `upsertTranscriptDraft` 添加文本长度保护 ✅

### 3. caption-text-view 的 reconcileLaneState 触发 RESET

**位置**：`apps/desktop/src/shared/caption-text-view.ts:reconcileLaneState`

**问题**：
如果 `isLikelyStreamingRevision` 返回 false，会触发 `RESET`，清空 `committedBreaks`，导致字幕重新打字。

**已修复**：
- 放宽短文本修订判断 ✅
- 保护 committedBreaks ✅

### 4. segment.commit 使用错误的文本

**位置**：`apps/desktop/src/shared/caption-store.ts:segment.commit`

**已修复**：
优先使用 `previousLine` 中累积的更长文本 ✅

## 下一步诊断计划

### 步骤 1：重新运行应用，收集新日志

需要的日志：
1. `[transcript.partial] 后端发送` - 后端发送的原始数据
2. `[caption_update] 后端发送` - **关键：可能是问题根源**
3. `[transcript.partial] 最终写入状态` - 前端最终写入 React 状态的数据

### 步骤 2：对比分析

对于同一个 segment_id，对比：
- `transcript.partial` 的最后一次 `text_full`
- `caption_update` 的 `source_full`
- `segment.commit` 使用的文本（通过 session.json）

### 步骤 3：定位根因

如果发现：
- **caption_update 的 source_full 比 transcript.partial 短** → 后端问题或翻译服务问题
- **caption_update 的 source_full 完整，但最终保存的文本不完整** → segment.commit 逻辑问题
- **所有事件文本都完整，但 UI 显示不完整** → caption-text-view 或渲染层问题

## 临时解决方案（如果 caption_update 是根源）

修改 `selectCaptionUpdateSourceText`：

```typescript
function selectCaptionUpdateSourceText(previousLine, event) {
  if (!previousLine) {
    return event.source.full_text;
  }
  
  // 即使 state === "final"，也要保护已有的更长文本
  const newText = event.source.full_text;
  if (previousLine.sourceText.length > newText.length + 10) {
    console.warn("[caption_update] 检测到 final 文本异常缩短", {
      segment_id: event.segment_id,
      state: event.state,
      prev_len: previousLine.sourceText.length,
      new_len: newText.length
    });
    return previousLine.sourceText;
  }
  
  return newText;
}
```

## 验证清单

运行应用后，检查：
- [ ] main.log 中是否有 `[caption_update]` 日志
- [ ] caption_update 的 source_full 是否完整
- [ ] 是否有 state='final' 且文本较短的情况
- [ ] 浏览器控制台是否有 `⚠️ 检测到文本异常缩短` 警告
- [ ] 最终保存的 session.json 中文本是否完整
