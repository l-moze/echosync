# EchoSync 前端重构基线记录

**记录日期**: 2026-06-08  
**分支**: refactor/frontend  
**提交**: 4c8ef01

## 代码统计

### 主要文件行数
- `apps/desktop/src/renderer/main.tsx`: **5099 行**
- `apps/desktop/src/renderer/styles.css`: **4499 行**
- 总计组件数: 40+
- 总计函数数: 202
- React hooks 使用: 135 处
- IPC 调用: 60 处

## TypeScript 类型检查基线

**状态**: ❌ 有错误（2 个）

```
src/main/main.ts(18,3): error TS2724: '"../shared/session-records"' has no exported member named 'SessionRecordSegmentUpdate'. Did you mean 'SessionRecordSegment'?
src/main/main.ts(340,45): error TS2339: Property 'updateSegment' does not exist on type 'SessionRecordStore'.
```

**说明**: 这些是重构前已存在的类型错误，不是本次重构引入的。

## 测试基线

**状态**: ❌ 有失败（2/测试总数）

### 失败的测试
1. `tests/renderer-record-window-contract.test.ts`
   - `停止会话保存记录不依赖采集状态快照成功返回`
   - `详情页音频回放使用记录时长自绘进度，避免 WebM 原生时长误导`

**说明**: 这些是重构前已存在的测试失败，不是本次重构引入的。

## 重构目标

### 代码目标
- [x] main.tsx 从 5099 行 → < 500 行
- [ ] 组件平均行数 < 300 行
- [ ] hooks 平均行数 < 100 行
- [ ] 服务模块平均行数 < 200 行
- [ ] 目录结构按 feature 组织

### 质量目标
- [ ] 类型检查错误不增加（保持 2 个）
- [ ] 测试失败不增加（保持 2 个）
- [ ] 无循环依赖
- [ ] 无未使用导出

### 功能目标
- [ ] 所有功能与重构前一致
- [ ] 性能无明显下降
- [ ] 无新增控制台错误
- [ ] 用户体验无变化

## 重构原则

1. ✅ **渐进式重构** - 每个阶段保持代码可运行
2. ✅ **小步提交** - 每次只改一类内容
3. ✅ **行为不变** - 重构前后功能完全一致
4. ✅ **向后兼容** - 不破坏现有 API 和数据结构
5. ✅ **测试先行** - 每次修改后运行测试验证
6. ❌ **禁止修改后端** - 不碰 main/、agent/、wasapi-sidecar/

## 验证方式

每次修改后运行：
```bash
# 类型检查
npm run typecheck:desktop

# 测试
cd apps/desktop && npm run test

# 构建
npm run build:desktop

# 运行
npm run dev:desktop
```

## 注意事项

- 类型检查和测试的现有错误不能增加
- 每个阶段独立提交
- 提交信息使用中文，格式："重构前端：xxx"
- 高风险修改需要充分测试
- 发现问题立即回滚
