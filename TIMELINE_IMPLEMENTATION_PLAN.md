# 时间线静音折叠功能实施计划

## 当前进展（2026-06-13）

### ✅ 已完成
1. **类型定义更新** - `apps/desktop/src/shared/session-records.ts`
   - ✅ 将 `SessionRecordTimelineMode` 改为 `SessionRecordTimelineSourceType`
   - ✅ 扩展支持场景：`"meeting" | "video" | "course" | "file" | "microphone"`
   - ✅ `SessionRecordTimeline.mode` → `SessionRecordTimeline.sourceType`

2. **数据迁移逻辑** - `apps/desktop/src/main/session-record-store.ts`
   - ✅ 添加 `normalizeStoredRecord()` 中的 timeline 迁移逻辑
   - ✅ 自动将旧的 `mode` 字段转换为 `sourceType`

### 🔄 进行中
- **分支**: `feat/review-timeline-silence-compression`
- **基于**: `refactor/frontend` (c65f155)

---

## 待实施任务

### 第二步：实现时间线构建逻辑（高优先级）

**文件**: `apps/desktop/src/main/session-record-store.ts`

需要添加的函数：

```typescript
function buildSessionRecordTimeline(
  durationMs: number,
  sourceId?: string,
  activityRanges?: Array<{ startMs: number; endMs: number }>,
  segments?: SessionRecordSegment[]
): SessionRecordTimeline | undefined {
  // 1. 推断 sourceType
  const sourceType = inferSourceTypeFromAudioSource(sourceId);
  
  // 2. 确定压缩策略
  const compressionEnabled = shouldEnableCompression(sourceType);
  
  // 3. 构建 activity ranges（如果没有提供）
  const ranges = activityRanges || buildActivityRangesFromSegments(segments);
  
  // 4. 使用 buildReviewTimeline 生成 spans
  const reviewTimeline = buildReviewTimeline(
    ranges,
    durationMs,
    compressionEnabled ? 2500 : Infinity, // silenceThresholdMs
    500 // compactGapMs
  );
  
  // 5. 返回完整的 timeline
  return {
    rawDurationMs: durationMs,
    contentDurationMs: calculateContentDuration(ranges),
    reviewDurationMs: reviewTimeline.totalMs,
    sourceType,
    compressionEnabled,
    spans: reviewTimeline.spans.map(span => ({
      kind: span.type === 'active_audio' ? 'content' : 'silence',
      rawStartMs: span.rawStartMs,
      rawEndMs: span.rawEndMs,
      reviewStartMs: span.reviewStartMs,
      reviewEndMs: span.reviewEndMs
    }))
  };
}

function inferSourceTypeFromAudioSource(sourceId?: string): SessionRecordTimelineSourceType {
  if (!sourceId) return "meeting";
  if (sourceId.includes("microphone") || sourceId.includes("mixed")) return "microphone";
  if (sourceId.includes("file")) return "file";
  if (sourceId.includes("windows-system")) return "video";
  return "meeting";
}

function shouldEnableCompression(sourceType: SessionRecordTimelineSourceType): boolean {
  // 视频/课程/文件默认压缩，会议/麦克风默认不压缩
  return sourceType === "video" || sourceType === "course" || sourceType === "file";
}
```

**集成点**: 在 `saveDraft()` 中调用
```typescript
const timeline = input.timeline || buildSessionRecordTimeline(
  input.durationMs,
  input.audioSource,
  input.activityRanges,
  normalizedTiming.segments
);
```

**依赖**: 需要从 `review-timeline.ts` 导入 `buildReviewTimeline`

---

### 第三步：创建 ReviewTimelineRail 组件

**文件**: `apps/desktop/src/renderer/components/ReviewTimelineRail.tsx` (新建)

**功能**:
- 渲染分段时间线轨道（内容段 + 静音段）
- Hover tooltip 显示时间映射
- 点击/拖动 seek

**样式**: `apps/desktop/src/renderer/styles.css`
- `.reviewTimelineRail`
- `.timelineSegment.content`
- `.timelineSegment.silence`
- `.timelineMarker`

---

### 第四步：创建 useReviewPlaybackTimeline Hook

**文件**: `apps/desktop/src/renderer/hooks/useReviewPlaybackTimeline.ts` (新建)

**功能**:
- `reviewMs ↔ rawMs` 双向时间映射
- 监听音频播放，自动更新当前位置
- 计算静音跳过信息
- 支持压缩/原始模式切换

**返回接口**:
```typescript
{
  compressionEnabled: boolean;
  toggleCompression: () => void;
  displayTimeline: ReviewTimeline;
  scrubToReview: (ms: number) => void;
  skippedSilenceMs: number | null;
}
```

---

### 第五步：更新记录详情页 UI

**文件**: `apps/desktop/src/renderer/main.tsx`

**变更**:
1. 顶部添加三项时长指标（复盘时长/原始录制/有效内容）
2. 用 `ReviewTimelineRail` 替换普通进度条
3. 添加模式切换按钮
4. 添加静音跳过提示

---

### 第六步：编写测试

**文件**: `apps/desktop/tests/`
- `session-record-store.test.ts` - timeline 持久化测试
- `renderer-timeline-contract.test.ts` - UI 渲染契约测试
- `review-timeline.test.ts` - 时间映射逻辑测试

---

## 验收标准

### P0：让能力可见
- [ ] 普通进度条已替换为分段时间线
- [ ] 记录详情页显示三项时长
- [ ] 播放进入压缩静音时显示"已压缩 X 静音"
- [ ] SRT 导出使用原始时间戳

### P1：允许用户控制
- [ ] 压缩/原始模式 toggle 存在并工作
- [ ] 视频/网课默认压缩，会议默认不压缩
- [ ] 用户选择即时生效

---

## 参考文档

- 设计规范：`docs/superpowers/specs/2026-06-07-review-timeline-silence-compression-ui-design.md`
- 数据契约：第 152-190 行
- 核心交互：第 42-108 行
- MVP 实施顺序：第 237-242 行

---

## 提交策略

1. **Commit 1**: 类型定义更新 + 数据迁移（当前进度）
2. **Commit 2**: 后端时间线构建逻辑
3. **Commit 3**: ReviewTimelineRail 组件 + 样式
4. **Commit 4**: useReviewPlaybackTimeline hook
5. **Commit 5**: 记录详情页 UI 集成
6. **Commit 6**: 测试编写
7. **Final**: 合并到 main

---

## 注意事项

### 低耦合原则
- 时间线构建逻辑独立于 UI
- UI 组件不直接依赖 session-record-store
- 数据流：Store → Record → UI Props

### 高内聚原则
- 时间线相关代码集中在专门的模块
- 不混入无关的摘要/诊断逻辑
- 每个组件职责单一

### 向后兼容
- 旧记录自动迁移 `mode` → `sourceType`
- `timeline` 缺失时回退到普通进度条
- 不破坏现有的记录列表和详情功能

---

## 当前状态总结

**完成度**: 15%（2/13 个子任务）

**下一步行动**: 实现 `buildSessionRecordTimeline()` 函数

**阻塞项**: 无

**预计完成时间**: 需要 4-6 小时开发时间
