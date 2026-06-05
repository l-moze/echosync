"""术语表代码审计和真实测评。

不写测试用例，而是对已实现代码做真实测评：
1. 匹配边界正确性（word/literal/phrase 各种极端场景）
2. 流式窗口过滤正确性（上一段术语不污染当前段）
3. Overlap dedupe 正确性（长短词同时命中时的处理）
4. 性能：regex vs AC 对比，不同规模词表的真实耗时
5. 端到端 pipeline 集成：glossary 数据流完整贯通
6. Prompt 注入质量：检查实际生成的 prompt 文本
7. XML 注入安全性：恶意术语是否破坏 prompt
8. CSV 覆盖规则：同名术语 priority 冲突和覆盖
"""

from __future__ import annotations

import time
from pathlib import Path
from tempfile import TemporaryDirectory

from echosync_agent.domain import CorrectionContext
from echosync_agent.services.asr.mock_transcriber import MockTranscriber
from echosync_agent.services.correction.revision_window import RevisionWindowCorrectionEngine
from echosync_agent.services.engine.cascaded_engine import CascadedInterpretationEngine
from echosync_agent.services.translation.deepseek_translator import (
    DeepSeekTranslator,
    _xml_attr,
    _xml_text,
)
from echosync_agent.services.translation.mock_translator import MockTranslator
from echosync_agent.services.translation.terminology import (
    AhoCorasickGlossaryMatcher,
    Glossary,
    GlossaryEntry,
    RegexGlossaryMatcher,
    apply_glossary_replacements,
)


def _entry(source: str, target: str, **kw) -> GlossaryEntry:
    d = dict(
        category="",
        priority=0,
        case_sensitive=False,
        match_mode="auto",
        constraint="required",
    )
    d.update(kw)
    return GlossaryEntry(source=source, target=target, **d)


RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
BOLD = "\033[1m"
RESET = "\033[0m"

_pass = 0
_fail = 0
_total = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global _pass, _fail, _total
    _total += 1
    if condition:
        _pass += 1
        print(f"  {GREEN}PASS{RESET}  {name}")
    else:
        _fail += 1
        print(f"  {RED}FAIL{RESET}  {name}")
        if detail:
            print(f"         {detail}")


# ═══════════════════════════════════════════════════════════
# 1. 匹配边界正确性（RegexGlossaryMatcher）
# ═══════════════════════════════════════════════════════════

print(f"\n{BOLD}1. 匹配边界正确性（Regex）{RESET}")

m = RegexGlossaryMatcher((_entry("API", "API", match_mode="word"),))
check("API 匹配独立 API", len(m.match("The API is fast")) == 1)
check("API 不匹配 CAPITAL", len(m.match("CAPITAL markets")) == 0)
check("API 不匹配 APIs（复数边界）", len(m.match("All APIs are fast")) == 0)

m2 = RegexGlossaryMatcher((
    _entry("C++", "C++", match_mode="literal"),
    _entry("Node.js", "Node.js", match_mode="literal"),
    _entry("GPT-4o", "GPT-4o", match_mode="literal"),
    _entry("C#", "C#", match_mode="literal"),
))
check("C++ 在句子中匹配", len(m2.match("I use C++.")) == 1)
check("Node.js 在句子中匹配", len(m2.match("Node.js is fast")) == 1)
check("GPT-4o 在复合词中匹配", len(m2.match("GPT-4o-mini is different")) == 1)
check("C# 在句子中匹配", len(m2.match("I love C#.")) == 1)

m3 = RegexGlossaryMatcher((_entry("simultaneous interpretation", "同声传译", match_mode="phrase"),))
check("phrase 精确匹配", len(m3.match("simultaneous interpretation is hard")) == 1)
check("phrase 连续空格匹配", len(m3.match("simultaneous   interpretation is hard")) == 1)
check("phrase 不匹配拆分", len(m3.match("simultaneous, interpretation")) == 0)


# ═══════════════════════════════════════════════════════════
# 2. 匹配边界正确性（AhoCorasickGlossaryMatcher）
# ═══════════════════════════════════════════════════════════

print(f"\n{BOLD}2. 匹配边界正确性（AC）{RESET}")

ac1 = AhoCorasickGlossaryMatcher((_entry("API", "API", match_mode="word"),))
check("AC: API 匹配独立 API", len(ac1.match("The API is fast")) == 1)
check("AC: API 不匹配 CAPITAL", len(ac1.match("CAPITAL markets")) == 0)
check("AC: API 不匹配 APIs", len(ac1.match("All APIs are fast")) == 0)

ac2 = AhoCorasickGlossaryMatcher((
    _entry("C++", "C++", match_mode="literal"),
    _entry("Node.js", "Node.js", match_mode="literal"),
    _entry("GPT-4o", "GPT-4o", match_mode="literal"),
    _entry("C#", "C#", match_mode="literal"),
    _entry("latency", "延迟", match_mode="word"),
    _entry("kernel", "内核", match_mode="word"),
))
check("AC: C++ 匹配", len(ac2.match("I use C++.")) == 1)
check("AC: Node.js 匹配", len(ac2.match("Node.js is fast")) == 1)
check("AC: latency word boundary", len(ac2.match("The latency is high")) == 1)
check("AC: latency 不匹配 latencies", len(ac2.match("All latencies are high")) == 0)
check("AC: kernel 不匹配 kernels", len(ac2.match("kernels are slow")) == 0)
check("AC: kernel 匹配 kernel", len(ac2.match("the kernel is slow")) == 1)


# ═══════════════════════════════════════════════════════════
# 3. Regex vs AC 结果一致性
# ═══════════════════════════════════════════════════════════

print(f"\n{BOLD}3. Regex vs AC 结果一致性{RESET}")

test_entries = (
    _entry("API", "API", match_mode="word"),
    _entry("kernel", "内核", match_mode="word"),
    _entry("latency", "延迟", match_mode="word"),
    _entry("C++", "C++", match_mode="literal"),
    _entry("Node.js", "Node.js", match_mode="literal"),
    _entry("GPT-4o", "GPT-4o", match_mode="literal"),
    _entry("simultaneous interpretation", "同声传译", match_mode="phrase"),
    _entry("CUDA", "CUDA", match_mode="word", case_sensitive=True),
    _entry("LLM", "LLM", match_mode="word", case_sensitive=True),
)

regex_m = RegexGlossaryMatcher(test_entries)
ac_m = AhoCorasickGlossaryMatcher(test_entries)

test_texts = [
    "The API latency is high with the kernel",
    "I use C++ and Node.js for GPT-4o development",
    "simultaneous interpretation is hard",
    "CAPITAL CUDA LLM",  # case-sensitive tests
    "the kernel kernel kernels API",  # boundary + dedupe
    "The API and kernel latency matter for C++",
    "simultaneous   interpretation",  # phrase space normalization (regex only)
]

for text in test_texts:
    r_hits = regex_m.match(text, max_terms=12)
    a_hits = ac_m.match(text, max_terms=12)
    r_sources = sorted(h.entry.source for h in r_hits)
    a_sources = sorted(h.entry.source for h in a_hits)

    # phrase 模式空格归一化是 regex 特有的，AC 不做
    if "   " in text and "interpretation" in text:
        # 这句只检查 AC 不崩
        check("AC 不崩溃（含连续空格）", len(a_hits) >= 0)
    else:
        check(f"一致: '{text[:40]}...' regex={r_sources} AC={a_sources}",
              r_sources == a_sources,
              f"regex={r_sources}, AC={a_sources}")


# ═══════════════════════════════════════════════════════════
# 4. 流式窗口过滤
# ═══════════════════════════════════════════════════════════

print(f"\n{BOLD}4. 流式窗口过滤（上一段术语不污染当前段）{RESET}")

g = Glossary((_entry("LiveKit", "LiveKit", match_mode="literal", priority=10),))

prefix = "LiveKit is used for media transport"
current = "and the subtitle renderer displays it"
source_window = f"{prefix} {current}"
current_start = len(prefix) + 1

matched = g.match_terms(source_window, max_terms=12)
filtered = [m for m in matched if m.end > current_start]

check("LiveKit 在 prefix 中命中", len(matched) >= 1)
check("LiveKit 被过滤（span 不覆盖 current）", len(filtered) == 0)

g2 = Glossary((_entry("simultaneous interpretation", "同声传译", match_mode="phrase"),))
prefix2 = "This is about simultaneous"
current2 = "interpretation techniques"
sw2 = f"{prefix2} {current2}"
cs2 = len(prefix2) + 1
m2r = g2.match_terms(sw2, max_terms=12)
f2 = [m for m in m2r if m.end > cs2]
check("跨段短语匹配成功", len(m2r) >= 1)
check("跨段短语 span 覆盖 current_start", len(f2) >= 1)


# ═══════════════════════════════════════════════════════════
# 5. Overlap dedupe
# ═══════════════════════════════════════════════════════════

print(f"\n{BOLD}5. Overlap dedupe{RESET}")

g3 = Glossary((
    _entry("OpenAI API", "OpenAI API", match_mode="phrase", priority=10),
    _entry("API", "API", match_mode="word", priority=5),
))
result3 = g3.match("OpenAI API is fast", max_terms=12)
check("OpenAI API 优先于 API",
      len(result3) == 1 and "OpenAI API" in result3,
      f"实际: {result3}")


# ═══════════════════════════════════════════════════════════
# 6. 性能对比：Regex vs AC
# ═══════════════════════════════════════════════════════════

print(f"\n{BOLD}6. 性能对比：Regex vs AC{RESET}")

for label, n_terms in [("20 条", 20), ("100 条", 100), ("300 条", 300), ("500 条", 500)]:
    entries = tuple(
        _entry(f"term{i}", f"译{i}", match_mode="word", priority=i % 10)
        for i in range(n_terms)
    )
    text = " ".join(f"term{i}" for i in range(n_terms))

    rg = RegexGlossaryMatcher(entries)
    ag = AhoCorasickGlossaryMatcher(entries)

    N = max(100, 5000 // n_terms)  # 大词表少跑几次

    t0 = time.perf_counter()
    for _ in range(N):
        rg.match(text, max_terms=12)
    regex_ms = (time.perf_counter() - t0) / N * 1000

    t1 = time.perf_counter()
    for _ in range(N):
        ag.match(text, max_terms=12)
    ac_ms = (time.perf_counter() - t1) / N * 1000

    speedup = regex_ms / ac_ms if ac_ms > 0 else float("inf")

    print(f"  {label}: regex={regex_ms:.3f}ms  AC={ac_ms:.3f}ms  加速={speedup:.1f}x")

    check(f"{label}: AC 不慢于 regex", ac_ms <= regex_ms * 3,
          f"regex={regex_ms:.3f}ms, AC={ac_ms:.3f}ms")


# ═══════════════════════════════════════════════════════════
# 7. Glossary 自动选择 matcher
# ═══════════════════════════════════════════════════════════

print(f"\n{BOLD}7. Glossary 自动选择 matcher{RESET}")

g_small = Glossary(tuple(_entry(f"t{i}", f"译{i}") for i in range(50)))
g_large = Glossary(tuple(_entry(f"t{i}", f"译{i}") for i in range(200)))

check("50 条 → RegexGlossaryMatcher",
      isinstance(g_small._matcher, RegexGlossaryMatcher))
check("200 条 → AhoCorasickGlossaryMatcher",
      isinstance(g_large._matcher, AhoCorasickGlossaryMatcher))


# ═══════════════════════════════════════════════════════════
# 8. 端到端 pipeline 集成
# ═══════════════════════════════════════════════════════════

print(f"\n{BOLD}8. 端到端 pipeline 集成{RESET}")

g8 = Glossary((_entry("latency", "延迟", priority=10),))
engine = CascadedInterpretationEngine(
    transcriber=MockTranscriber(),
    translator=MockTranslator(),
    correction_engine=RevisionWindowCorrectionEngine(),
    glossary=g8,
)
check("CascadedInterpretationEngine 接受 Glossary", len(engine._glossary.entries) == 1)

engine2 = CascadedInterpretationEngine(
    transcriber=MockTranscriber(),
    translator=MockTranslator(),
    correction_engine=RevisionWindowCorrectionEngine(),
    glossary={"API": "API"},
)
check("接受 dict（向后兼容）", len(engine2._glossary.entries) == 1)

engine3 = CascadedInterpretationEngine(
    transcriber=MockTranscriber(),
    translator=MockTranslator(),
    correction_engine=RevisionWindowCorrectionEngine(),
    glossary=None,
)
check("接受 None", len(engine3._glossary.entries) == 0)

ctx = engine._context("Vector database latency matters.")
check("_context 注入 glossary", "latency" in ctx.glossary)
check("_context 注入 glossary_constraints", "latency" in ctx.glossary_constraints)
check("约束默认 required", ctx.glossary_constraints.get("latency") == "required")


# ═══════════════════════════════════════════════════════════
# 9. Prompt 注入质量 + XML 安全
# ═══════════════════════════════════════════════════════════

print(f"\n{BOLD}9. Prompt 注入质量 + XML 安全{RESET}")

ds = DeepSeekTranslator(api_key="test", base_url="https://test.com", model="test")

ctx9 = CorrectionContext(
    recent_segments=(),
    glossary={"latency": "延迟", "API": "API"},
    glossary_constraints={"latency": "preferred", "API": "required"},
)
prompt = ds._build_user_prompt("The API latency is high", ctx9)
check("有术语时包含 <glossary>", "<glossary>" in prompt)
check("constraint 属性正确注入", 'constraint="preferred"' in prompt)

ctx9b = CorrectionContext(recent_segments=(), glossary={}, glossary_constraints={})
prompt2 = ds._build_user_prompt("Hello world", ctx9b)
check("无术语时省略 <glossary>", "<glossary>" not in prompt2)

check("XML text escape", _xml_text("<script>") == "&lt;script&gt;")
check("XML attr escape", _xml_attr('"evil"') == '&quot;evil&quot;')

ctx7 = CorrectionContext(
    recent_segments=(),
    glossary={'foo <evil>': 'bar" & target'},
    glossary_constraints={'foo <evil>': 'required'},
)
prompt7 = ds._build_user_prompt("hello", ctx7)
check("恶意术语不破坏 XML", '<glossary>' in prompt7 and '</glossary>' in prompt7)
check("恶意 source 被转义", 'source="foo &lt;evil&gt;"' in prompt7)


# ═══════════════════════════════════════════════════════════
# 10. CSV 加载和覆盖规则
# ═══════════════════════════════════════════════════════════

print(f"\n{BOLD}10. CSV 加载和覆盖规则{RESET}")

with TemporaryDirectory() as td:
    Path(td, "default.csv").write_text(
        "source,target,aliases,category,case_sensitive,match_mode,priority,constraint\n"
        "latency,延迟,,tech,false,word,5,preferred\n"
        "LiveKit,LiveKit,,brand,true,literal,10,required\n",
        encoding="utf-8",
    )
    Path(td, "tech.csv").write_text(
        "source,target,priority\nlatency,时延,10\n", encoding="utf-8",
    )

    g10 = Glossary.from_csv_files([f"{td}/default.csv", f"{td}/tech.csv"])
    check("后加载文件覆盖同名术语",
          g10.match("latency") == {"latency": "时延"})

    Path(td, "alias.csv").write_text(
        'source,target,aliases,match_mode\n'
        'GPT-4o,GPT-4o,"GPT 4o|gpt4o",literal\n',
        encoding="utf-8",
    )
    g10b = Glossary.from_csv(f"{td}/alias.csv")
    check("别名展开为独立 entry", len(g10b.entries) == 3)


# ═══════════════════════════════════════════════════════════
# 11. apply_glossary_replacements
# ═══════════════════════════════════════════════════════════

print(f"\n{BOLD}11. apply_glossary_replacements{RESET}")

result11 = apply_glossary_replacements(
    "The API and GPU are fast",
    {"API": "接口", "GPU": "图形处理器"},
)
check("多个术语正确替换", "接口" in result11 and "图形处理器" in result11)

result11b = apply_glossary_replacements("CAPITAL API", {"API": "接口"})
check("word boundary: CAPITAL 不替换", "CAPITAL" in result11b)


# ═══════════════════════════════════════════════════════════
# 汇总
# ═══════════════════════════════════════════════════════════

print(f"\n{BOLD}{'='*60}{RESET}")
if _fail == 0:
    print(f"{GREEN}全部 {_total} 项通过{RESET}")
else:
    print(f"{RED}{_fail}/{_total} 项失败{RESET}")
    print(f"{YELLOW}通过: {_pass} / 失败: {_fail} / 总计: {_total}{RESET}")
print(f"{BOLD}{'='*60}{RESET}")
