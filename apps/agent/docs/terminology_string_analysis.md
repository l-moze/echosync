# 术语表字符串操作场景分析与优化方案

## 全路径梳理

```
音频流 → ASR → TranscriptSegment.text
              ↓
    ┌─ 路径 A: 流式窗口构建 (engine._context)
    │   " ".join(segments) + current_text  → source_window
    │   字符串拼接，~150-300 字符
    │
    └─ 路径 B: 术语匹配 ← ★ 核心瓶颈
    │   Regex: O(terms × text_len)
    │   AC:    O(text_len + matches)
    │
    └─ 路径 C: 排序 + overlap dedupe
        O(hits log hits) + O(selected²)，max_terms=12 上限 66 次比较
```

## 路径性能实测

| 路径 | 耗时 | 评价 |
|------|------|------|
| A: 窗口拼接 | ~0μs | 不需优化 |
| **B: 术语匹配** | 见下表 | **唯一需要算法优化的路径** |
| C: 排序+去重 | <10μs | 不需优化 |
| D: dict 推导 | <1μs | 不需优化 |
| E: prompt 构建 | <30μs | 被 LLM 延迟淹没 |
| F: mock 替换 | <20μs | 仅 mock 路径 |

## 性能对比实测（Regex vs AC）

| 词表规模 | Regex 耗时 | AC 耗时 | 加速比 |
|---------|-----------|---------|--------|
| 20 条 | 0.072ms | 0.036ms | 2.0× |
| 100 条 | 1.149ms | 0.199ms | 5.8× |
| 300 条 | 11.336ms | 0.941ms | 12.0× |
| 500 条 | 30.463ms | 1.329ms | 22.9× |

**结论：**
- ≤100 条：两者都足够快，选 regex（更成熟，支持 phrase 空格归一化）
- 100-300 条：AC 有明显优势（5-12×）
- >300 条：AC 是必须的（20×+）

## AC 实现要点

### 大小写混合处理

case-sensitive 和 case-insensitive 条目**分别构建独立 AC 自动机**：

- CS 自动机：用原始 source 文本做 key，搜索原始文本
- CI 自动机：用 lowercased source 做 key，搜索 lowercased 文本
- 两次扫描合并结果，去重后排序

### 边界检查

AC 输出的是 (entry, position) 元组，边界检查在命中后做：

```python
def _check_boundaries(text, start, end, mode):
    if mode == "word":
        return not (start > 0 and _is_word_char(text[start-1]) or
                    end < len(text) and _is_word_char(text[end]))
    elif mode == "literal":
        return not (start > 0 and _is_word_char(text[start-1]) or
                    end < len(text) and text[end].isalpha())
    return True
```

### phrase 模式空格归一化

AC 做精确匹配，不支持 phrase 模式的连续空格归一化。
这是 AC 的已知限制，MVP 场景下可接受：
- MVP 默认 ≤100 条，使用 RegexGlossaryMatcher
- 当术语数 >100 切换到 AC，此时用户需确保 CSV 中 phrase 术语的空格与源文本一致

### 自动选择策略

```python
class Glossary:
    def __init__(self, entries):
        if len(entries) > 100:
            self._matcher = AhoCorasickGlossaryMatcher(entries)
        else:
            self._matcher = RegexGlossaryMatcher(entries)
```

## 其他优化路径评估

| 路径 | 优化方案 | 结论 |
|------|---------|------|
| apply_glossary_replacements | 缓存 Glossary（frozenset key） | 已实现 |
| from_csv 解析 | try/except 容错 | 已实现 |
| _overlaps_any | 线段树/区间树 | 没必要（max_terms=12） |
| prompt 构建 | 预编译模板 | 没必要（<30μs） |
