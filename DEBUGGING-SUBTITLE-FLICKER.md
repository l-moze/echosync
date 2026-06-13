# 字幕闪烁和重复打字问题诊断指南

## 问题现象

1. **断行时内容闪烁**：新内容出现时，旧内容像被瞬间顶上去或重新排布，出现闪烁、跳动
2. **长字幕重新逐字弹出**：已经显示过的字符，在后续修订后又从头逐字重新出现

## 已添加的调试日志

### 1. `[caption-store] applyRealtimeEvent`
追踪所有进入的事件，检查：
- 事件类型和时序
- segment_id 和 rev 的稳定性
- 事件是否乱序

### 2. `[caption-store] segment.commit`
验证最终提交时的文本选择：
- `prev_source_len` vs `event_source_len`
- `used_previous`: 是否使用了累积的更长文本

### 3. `[caption-text-view] reconcileLaneState`
**最关键的日志**，追踪文本更新类型：
- `action: "EXTEND"` - 新文本是旧文本的扩展（正常）
- `action: "REVISE"` - 局部修订，保留稳定前缀（正常）
- `action: "RESET"` - 完全重置，丢失所有状态（**问题根源**）

关键指标：
- `is_extension`: 是否为扩展
- `stable_prefix_len`: 稳定前缀长度
- `will_reset_breaks`: 是否重置断行点（导致重新打字）

### 4. `[caption-text-view] buildBlocksFromEntry`
追踪块拆分：
- `block_count`: 块数量变化
- `block_ids`: 块 ID 是否稳定
- `source_breaks` / `target_breaks`: 断行点位置

## 验证步骤

### 步骤 1：运行应用并开始录制
```powershell
npm run dev
```

### 步骤 2：打开浏览器控制台
按 `F12` 或 `Ctrl+Shift+I`

### 步骤 3：播放测试音频或说话
观察控制台输出

### 步骤 4：分析日志模式

#### ✅ 正常模式（预期）
```
[caption-text-view] reconcileLaneState {
  prev_len: 50,
  new_len: 80,
  prev_preview: "Think about subtle behaviors...",
  new_preview: "Think about subtle behaviors like needing a doll...",
  is_extension: true,
  action: "EXTEND",
  will_reset_breaks: false
}
```

#### ⚠️ 修订模式（可接受）
```
[caption-text-view] reconcileLaneState {
  prev_len: 50,
  new_len: 52,
  is_extension: false,
  is_revision: true,
  stable_prefix_len: 45,
  action: "REVISE",
  will_reset_breaks: false
}
```

#### ❌ 问题模式（导致闪烁）
```
[caption-text-view] reconcileLaneState {
  prev_len: 50,
  new_len: 55,
  is_extension: false,
  is_revision: false,
  action: "RESET",  // ← 完全重置！
  will_reset_breaks: true,  // ← 丢失断行点！
  committed_breaks: 2  // ← 之前有断行，现在全丢了
}
```

## 根因假设验证

### 假设 1：`isLikelyStreamingRevision` 判断过严
如果看到大量 `action: "RESET"` 但文本明显是相关的，说明判断逻辑有问题。

**检查点**：
```typescript
// apps/desktop/src/shared/caption-text-view.ts 第275行
function isLikelyStreamingRevision(previousText, nextText) {
  // 这个函数的判断条件可能过严
}
```

### 假设 2：事件乱序
如果看到：
```
[caption-store] applyRealtimeEvent { rev: 5, ... }
[caption-store] applyRealtimeEvent { rev: 3, ... }  // ← 旧事件晚到
```
说明存在事件乱序。

### 假设 3：block_id 不稳定
如果看到：
```
[caption-text-view] buildBlocksFromEntry {
  block_ids: ["seg_123:visual:0", "seg_123:visual:1"]
}
// 下一次更新
[caption-text-view] buildBlocksFromEntry {
  block_ids: ["seg_123:visual:0"]  // ← 块数量变化
}
```
说明 React 会认为节点改变，触发 remount。

### 假设 4：committedBreaks 被错误重置
正常情况下，`committedBreaks` 应该逐渐累积：
```
committed_breaks: []
committed_breaks: [112]
committed_breaks: [112, 224]
```

如果看到突然归零：
```
committed_breaks: [112, 224]
committed_breaks: []  // ← 被重置了！
```
说明触发了 `RESET`，导致已断行的内容重新从头播放打字动画。

## 可能的修复方向

### 修复 1：放宽 `isLikelyStreamingRevision` 判断
如果两个文本有明显的公共前缀，应该视为修订而非重置。

### 修复 2：在 `upsertTranscriptDraft` 中强制使用扩展模式
如果 `event.rev` 递增且 segment_id 相同，新文本大概率是旧文本的扩展。

### 修复 3：稳定 block_id
使用 `line.id` 而不是 `line.id:visual:index`，避免块数量变化时 React remount。

### 修复 4：保护 committedBreaks
即使判定为 RESET，也应该尝试保留公共前缀内的 breaks。

## 下一步

1. 运行应用，收集日志
2. 确认哪个假设是正确的
3. 根据日志结果实施针对性修复
4. 验证修复后不再出现闪烁和重复打字

## 关键文件

- `apps/desktop/src/shared/caption-text-view.ts` - 文本块管理逻辑
- `apps/desktop/src/shared/caption-store.ts` - 事件处理和状态更新
- `apps/desktop/src/renderer/main.tsx` - 字幕渲染组件
