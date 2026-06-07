# DeepL Text 实时字幕翻译适配方案

## 1. 执行摘要

基于技术报告分析和现有架构审计，本方案将 **DeepL Text API 的非流式批量翻译能力** 适配到 EchoSync 的实时字幕链路。核心策略是在应用层实现 DeepL Voice 的 concluded/tentative 协议，而非期待 DeepL Text API 本身提供流式输出。

**关键判断：**
- DeepL Text API 是完整翻译端点，不是 token streaming
- 它会很快返回，但连续请求会因语序调整导致"字符乱跳"
- 解决方案不是让 DeepL 更快，而是在外层实现 local agreement + 状态机 + diff patch

**预期收益：**
- 利用 DeepL `latency_optimized` 模型的低延迟优势
- 避免 prefix instability 造成的字幕回滚
- 为批量/质量修正保留 `quality_optimized` 旁路

**风险：**
- DeepL Text 每次重翻译整个 mutable window，成本高于 LLM 增量流
- concluded/tentative 逻辑复杂，需要仔细处理版本化和乱序
- 当前仓库已有 DeepSeek 流式翻译，DeepL 定位需清晰

---

## 2. 现有架构映射

### 2.1 当前链路

```text
AudioFrame
  → ASR (FunASR/Voxtral/Deepgram)
  → TranscriptSegment (partial/stable/committed)
  → TranscriptAssembler
  → CascadedInterpretationEngine
    → Translator.stream_translate() (DeepSeek)
    → TranslationSegment (partial/stable/committed)
    → SubtitlePatch
    → SegmentCommit
  → EventSubtitleSink
  → CaptionEventHub
  → Desktop caption-store
```

**关键观察：**
1. `TranscriptAssembler` 已实现 partial/stable/committed 三态
2. `CascadedInterpretationEngine` 支持 StreamingTranslator 和非流式 Translator
3. Desktop `caption-store` 已有 `locked` / `mutable` 状态机
4. `SimulTranslationPolicy` 已实现 WAIT/DRAFT 调度

### 2.2 DeepL Text API 现状

当前 `DeepLTranslator` 只实现 `Translator` 协议：

```python
async def translate(
    segment: TranscriptSegment,
    context: CorrectionContext,
) -> TranslationSegment
```

它是**同步批量翻译**：
- 一次请求返回完整译文
- 不支持 `stream_translate()`
- 适合录播批量处理，不适合实时增量

---

## 3. 方案设计：DeepL Re-translation Engine

### 3.1 核心思想

不修改 DeepL Text API 本身，而是在 `CascadedInterpretationEngine` 和 Desktop 之间插入一层 **DeepL Re-translation Coordinator**：

```text
TranscriptAssembler
  → stable/committed checkpoint
  → DeepLRealtimeCoordinator
    Fast Lane: latency_optimized, 高频重翻译 mutable window
    Quality Lane: quality_optimized, 低频修正 concluded segments
    → Target Local Agreement (多次翻译结果稳定前缀)
    → SubtitleStateMachine (concluded/tentative)
    → DiffPatchRenderer
  → TranslationSegment + SubtitlePatch
  → Desktop
```

**与 DeepSeek 的区别：**
- DeepSeek: token streaming，首 token 快，增量追加
- DeepL: 完整翻译，返回快但每次可能结构不同，需要外层做 local agreement

### 3.2 Fast Lane：低延迟重翻译

**触发条件（wait-k 映射）：**
- ASR stable 新增
- 或 partial 累积到最小短语（英文 3-6 词 / 中文 6-12 字）
- 或弱边界（逗号、分号、冒号）
- 或距离上次请求 > 400-700ms

**WAIT 条件（避免过早翻译）：**
- source 太短（< 2 词 / < 4 字）
- 英文尾部悬空词（the/of/to/that/which/because/if）
- ASR partial 最近发生 rewrite
- 距离上次请求 < 250-300ms

**请求参数：**
```python
{
    "text": [mutable_source_window],  # 未 concluded 的源文窗口
    "source_lang": "EN",  # 必传，避免自动检测触发 next-gen
    "target_lang": "ZH",
    "context": concluded_source_history,  # 已稳定的上文
    "model_type": "latency_optimized",
    "split_sentences": "0",  # 防止 DeepL 再切句
    "preserve_formatting": True,
    "glossary_id": session_glossary_id
}
```

**Mutable Window 定义：**
- 最近未 concluded 的 source 段落
- 当前新增 source
- 典型大小：最近 10-20 秒的未稳定源文

**不翻译全历史的原因：**
1. 成本：每次重翻译整段历史
2. 延迟：长文本翻译慢
3. 已 concluded 部分不应再改

### 3.3 Local Agreement：稳定前缀提取

每次 DeepL Fast Lane 返回新译文后，不直接显示，而是做稳定前缀判断：

```python
def local_agreement(prev_target: str, curr_target: str) -> tuple[str, str]:
    """
    返回 (stable_prefix, unstable_suffix)
    """
    # 按 token/短语边界找最长公共前缀
    tokens_prev = tokenize(prev_target)
    tokens_curr = tokenize(curr_target)

    lcp_length = 0
    for i, (t1, t2) in enumerate(zip(tokens_prev, tokens_curr)):
        if t1 != t2:
            break
        lcp_length = i + 1

    stable_prefix = "".join(tokens_prev[:lcp_length])
    unstable_suffix = "".join(tokens_curr[lcp_length:])

    return stable_prefix, unstable_suffix
```

**提升为 concluded 的条件：**
1. 连续两次 DeepL 返回相同前缀（字符级或 token 级）
2. 或 ASR committed + DeepL 返回稳定
3. concluded 前缀锁定，后续不再修改

**Tokenization 策略：**
- 中文：按 jieba / 标点 / 短语块
- 英文：按词边界
- 日文：按 mecab / 字符块
- 最简单 MVP：按字符 LCP，但 UI 会显得机械

### 3.4 字幕状态机

```typescript
type SubtitleState = {
  concludedSourceEnd: number;      // 已稳定源文边界
  concludedTarget: string;         // 已稳定译文（不再改）
  tentativeSourceStart: number;    // 临时源文起点
  tentativeSourceEnd: number;      // 临时源文终点
  tentativeTarget: string;         // 临时译文（可修正）
  lastTranslations: TranslationCandidate[];  // 最近 N 次翻译结果
};

type TranslationCandidate = {
  requestId: string;
  sourceVersion: number;
  targetText: string;
  createdAt: number;
};
```

**状态转换：**
```text
ASR partial → source append (tentative only)
ASR stable + DeepL fast → tentative update
Local agreement 命中 → tentative → stable_draft
连续两次一致 / ASR committed → stable_draft → concluded
```

**显示规则：**
- `concluded`：正常亮度，固定显示
- `tentative`：略低透明度，可变区域
- `revision`：只局部 diff patch，不整行闪烁

### 3.5 请求版本化（解决乱序返回）

DeepL 请求必须带 metadata：

```python
@dataclass
class DeepLRequest:
    request_id: str
    lane: Literal["fast", "quality"]
    source_version: int
    source_span_start: int
    source_span_end: int
    source_text: str
    created_at: float
```

**响应接受规则：**
```python
def accept_response(resp: DeepLResponse, state: SubtitleState) -> bool:
    # 丢弃过旧版本（已被更新版本覆盖）
    if resp.source_version < state.current_source_version - 1:
        return False

    # 丢弃已 concluded 区域的翻译
    if resp.source_span_end <= state.concluded_source_end:
        return False

    # 丢弃晚到的旧请求
    if resp.created_at < state.last_accepted_response_at:
        return False

    return True
```

**典型场景：**
```text
请求 A: source 前 5 词 → 延迟 800ms
请求 B: source 前 10 词 → 延迟 400ms
B 先返回 → 字幕显示
A 后返回 → 版本丢弃，不回滚字幕
```

### 3.6 Quality Lane：低频高质量修正

**触发条件：**
- 距离上次 Quality 请求 > 1.5-3s
- 最近 mutable window 有新稳定内容

**请求参数：**
```python
{
    "text": [recent_mutable_window],  # 最近 5-15 秒 mutable 内容
    "source_lang": "EN",
    "target_lang": "ZH",
    "context": full_concluded_history,  # 完整上文
    "model_type": "quality_optimized",
    "glossary_id": session_glossary_id
}
```

**处理策略：**
- 不抢 Fast Lane 的首屏
- 只修正最近窗口
- 如果 Quality 返回的译文和 Fast Lane 不同，做局部 diff patch
- 如果差异很大，仍保留 Fast Lane 结果，避免"修正后更差"

### 3.7 Diff Patch Renderer

**目标：** 只修改变化部分，不整行替换

**算法：**
```python
def compute_diff_patch(old: str, new: str) -> list[Patch]:
    """
    返回 [(start, end, replacement), ...]
    """
    # 使用 difflib 或最长公共子序列
    patches = []

    # 找到变化的 span
    for span in diff_spans(old, new):
        patches.append(Patch(
            start=span.start,
            end=span.end,
            replacement=span.new_text
        ))

    return patches
```

**UI 效果：**
- 新增内容：平滑出现
- 修正内容：淡入替换
- 删除内容：淡出
- 不改内容：保持不变

---

## 4. 实现计划

### 4.1 Phase 1: 基础 Fast Lane (P0)

**目标：** 验证 DeepL Text 能否用于实时字幕，建立基础链路

**实现：**
1. 新建 `DeepLRealtimeCoordinator`
   - 位置：`apps/agent/src/echosync_agent/services/translation/`
   - 文件：`deepl_realtime_coordinator.py`

2. 实现核心组件：
   - `MutableSourceWindow`: 管理未 concluded 的源文窗口
   - `LocalAgreementDetector`: 检测稳定前缀
   - `RequestVersionManager`: 版本化和乱序丢弃
   - `FastLaneTriggerPolicy`: wait-k 映射

3. 集成到 `CascadedInterpretationEngine`
   - 新增 `deepl_realtime` 翻译模式
   - 保持向后兼容

4. Desktop 字幕状态机增强
   - 区分 `concluded` / `tentative`
   - 实现 diff patch 渲染

**验证指标：**
- Fast Lane 请求频率：每秒 1-2 次（不是每个 token）
- 字幕回滚次数：< 5% 的 segment
- concluded 提升延迟：< 2s after ASR committed

**测试：**
```python
# apps/agent/tests/test_deepl_realtime_coordinator.py
async def test_fast_lane_basic():
    # ASR stable 触发 Fast Lane
    # 连续两次返回相同前缀 → concluded
    pass

async def test_request_version_discard():
    # 模拟乱序返回
    # 验证旧版本被丢弃
    pass
```

### 4.2 Phase 2: Local Agreement 优化 (P1)

**目标：** 减少字幕抖动，提升 concluded 质量

**实现：**
1. Token-aware LCP（不是字符级硬切）
2. 中文 jieba 分词 + 短语边界
3. 英文词边界
4. 连续 N 次一致性判断（不只是两次）

**验证指标：**
- LCP 精度：> 90% 匹配真实语义边界
- concluded 误判率：< 3%

### 4.3 Phase 3: Quality Lane (P1)

**目标：** 低频修正 Fast Lane 的不自然译文

**实现：**
1. Quality Lane 调度器
2. Diff patch 生成
3. UI 局部修正动画

**验证指标：**
- Quality 请求频率：每 1.5-3s 一次
- 修正采纳率：> 60%（用户不觉得修正后更差）

### 4.4 Phase 4: 成本优化 (P2)

**目标：** 降低重翻译成本

**实现：**
1. Mutable window 自适应大小
2. 智能跳过明显不变的请求
3. DeepL 缓存（相同 source + context）

---

## 5. 与现有系统集成

### 5.1 与 DeepSeek 的定位

| 维度 | DeepSeek | DeepL Fast Lane | DeepL Quality Lane |
|------|----------|-----------------|-------------------|
| 延迟 | 首 token ~700ms p50 | 完整翻译 ~300-500ms (预估) | ~1-2s |
| 增量 | Token streaming | 无，每次完整翻译 | 无 |
| 成本 | 按 token 计费，增量便宜 | 按字符计费，重翻译贵 | 同左 |
| 质量 | 可调 prompt，上下文灵活 | DeepL 机翻，上下文受限 | 同左，model 更好 |
| 适合场景 | 实时低延迟，LLM 风格可控 | 专业机翻，准确但成本高 | 批量修正/录播 |

**建议：**
- 默认保持 DeepSeek 作为主翻译器
- DeepL 作为可选 provider，用于对翻译质量要求极高的场景
- 用户在 Desktop 设置中选择 `deepseek` / `deepl`

### 5.2 与 SimulTranslationPolicy 的关系

当前 `SimulTranslationPolicy` 已实现 WAIT/DRAFT 调度，它控制**何时翻译**。

DeepL Re-translation 控制**如何重翻译 + 何时 concluded**。

**协同方式：**
- `SimulTranslationPolicy.should_wait()` → 跳过 DeepL Fast Lane
- `SimulTranslationPolicy.should_commit()` → 触发 concluded 提升
- Local Agreement 独立判断稳定前缀

**不冲突：**
- SimulTranslationPolicy: 源文侧调度（WAIT 半句）
- DeepL Re-translation: 译文侧稳定化（concluded/tentative）

### 5.3 配置接口

```python
# .env
ECHOSYNC_TRANSLATOR_PROVIDER=deepl  # 或 deepseek / mock
DEEPL_API_KEY=xxx
DEEPL_BASE_URL=https://api-free.deepl.com
DEEPL_FAST_LANE_MODEL=latency_optimized
DEEPL_QUALITY_LANE_MODEL=quality_optimized
DEEPL_REALTIME_MODE=enabled  # 或 disabled (fallback to batch)
```

Desktop 前端：
```typescript
// apps/desktop/src/shared/translation-provider-catalog.ts
{
  id: "deepl",
  label: "DeepL 实时",
  description: "专业机翻，concluded/tentative 双轨",
  providerId: "deepl"
}
```

---

## 6. 风险与缓解

### 6.1 成本风险

**问题：** 每次重翻译整个 mutable window，成本高于 DeepSeek 增量

**缓解：**
1. Mutable window 控制在 10-20 秒
2. Fast Lane 触发频率限制（最多 1-2 次/秒）
3. Quality Lane 低频（1 次/1.5-3s）
4. 用户显式选择 DeepL，不作为默认

### 6.2 复杂度风险

**问题：** concluded/tentative + local agreement + 版本化逻辑复杂

**缓解：**
1. 分阶段实现，Phase 1 只做基础 Fast Lane
2. 充分测试乱序、回滚、版本丢弃场景
3. 保留 DeepSeek 作为 fallback

### 6.3 质量风险

**问题：** DeepL 不如 LLM 灵活，上下文受限

**缓解：**
1. 充分利用 `context` 参数（最多 128 KiB）
2. 术语表 `glossary_id` 必选
3. Quality Lane 作为兜底

### 6.4 延迟风险

**问题：** 如果 DeepL 实际延迟 > 500ms，不如 DeepSeek

**缓解：**
1. Phase 1 先测量真实延迟
2. 如果 p50 > 800ms，不作为默认推荐
3. 保留 `DEEPL_REALTIME_MODE=disabled` 回退

---

## 7. 测试计划

### 7.1 单元测试

```python
# test_local_agreement.py
def test_lcp_chinese_phrase():
    prev = "今天我们将讨论实时字幕"
    curr = "今天我们将讨论实时语音翻译"
    stable, unstable = local_agreement(prev, curr)
    assert stable == "今天我们将讨论实时"
    assert unstable == "语音翻译"

def test_request_version_discard():
    # 模拟乱序返回，验证丢弃逻辑
    pass

def test_fast_lane_trigger():
    # 验证 wait-k 触发条件
    pass
```

### 7.2 集成测试

```python
# test_deepl_realtime_integration.py
async def test_end_to_end_concluded_promotion():
    # 输入 ASR stable 序列
    # 验证 DeepL Fast Lane 触发
    # 验证 Local Agreement 提取稳定前缀
    # 验证 concluded 提升时机
    pass
```

### 7.3 真实视频测试

使用 `vido/videoplayback.mp4` 跑真实链路：

```bash
# 启动 Agent with DeepL
export ECHOSYNC_TRANSLATOR_PROVIDER=deepl
export DEEPL_API_KEY=xxx
python -m echosync_agent.transport.caption_ws

# Desktop 选择 DeepL provider
# 播放视频，观察字幕
```

**观察指标：**
- 字幕回滚次数
- concluded 延迟（相对 ASR committed）
- Fast Lane 请求频率
- DeepL API 成本

---

## 8. 后续优化方向

### 8.1 Adaptive Mutable Window

根据语速动态调整 mutable window 大小：
- 快语速：缩小窗口，降低成本
- 慢语速：扩大窗口，减少请求

### 8.2 DeepL 缓存

相同 `source + context` 命中缓存，避免重复请求

### 8.3 Hybrid DeepSeek + DeepL

- DeepSeek 负责首屏（低延迟）
- DeepL Quality Lane 负责修正（高质量）

### 8.4 真正的 Multi-Stream

如果 Phase 1-3 验证成功，可以考虑：
- Source stream: ASR
- Draft stream: DeepL Fast Lane
- Commit stream: Local Agreement + Policy
- Revision stream: DeepL Quality Lane

---

## 9. 决策点

**Go / No-go 判断：**

Phase 1 完成后，测量：
1. DeepL Text API p50 延迟 < 600ms
2. 字幕回滚率 < 5%
3. concluded 提升延迟 < 2s after ASR committed

如果**任一指标不达标**，不继续 Phase 2-3，保持 DeepSeek 作为主方案。

**用户选择建议：**
- DeepSeek: 默认推荐，低延迟 + 灵活
- DeepL: 专业场景，对翻译质量要求极高，愿意承担更高成本

---

## 10. 一句话总结

**DeepL Text 实时字幕的核心是"外层 local agreement + concluded/tentative 状态机 + 版本化请求管理"，而不是期待 DeepL 本身提供流式能力。成功的关键在于 Phase 1 验证真实延迟和稳定性，而非过早优化复杂的 Quality Lane 和 diff patch。**
