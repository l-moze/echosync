"""轻量实时术语表（Glossary）模块。

负责术语加载、预编译匹配、以及为 ASR 侧提供短语列表出口。
小词表（≤100 条）使用 RegexGlossaryMatcher；大词表使用 AhoCorasickGlossaryMatcher。
"""

from __future__ import annotations

import csv
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

logger = logging.getLogger(__name__)

# 自动选择 matcher 的阈值：≤ 此值用 regex，> 此值用 AC
_AC_THRESHOLD = 100


# ── 数据结构 ─────────────────────────────────────────────


@dataclass(frozen=True)
class GlossaryEntry:
    """单个术语条目。"""

    source: str
    target: str
    category: str = ""
    priority: int = 0
    case_sensitive: bool = False
    match_mode: str = "auto"  # "word" | "phrase" | "literal" | "auto"
    constraint: str = "required"  # "required" | "preferred"


@dataclass(frozen=True)
class MatchedTerm:
    """匹配结果，带 span 和实际用于 prompt 的 source 文本。"""

    entry: GlossaryEntry
    start: int
    end: int
    source_for_prompt: str


# ── 匹配器接口 ─────────────────────────────────────────────


class GlossaryMatcher(Protocol):
    """术语匹配策略接口。初始化时绑定 entries，运行时只执行匹配。"""

    def match(
        self,
        text: str,
        *,
        max_terms: int = 12,
        unique_sources: bool = True,
    ) -> list[MatchedTerm]: ...


# ── 公共边界检查 ──────────────────────────────────────────


def _is_word_char(c: str) -> bool:
    """判断是否为 ASCII 单词字符（字母/数字/下划线）。"""
    return c == "_" or "0" <= c <= "9" or "A" <= c <= "Z" or "a" <= c <= "z"


def _is_ascii_alpha(c: str) -> bool:
    """判断是否为 ASCII 字母。"""
    return "A" <= c <= "Z" or "a" <= c <= "z"


def _check_boundaries(text: str, start: int, end: int, mode: str) -> bool:
    """检查匹配位置是否满足边界条件。"""
    # word: 左右 [A-Za-z0-9_] 边界
    if mode == "word" or mode == "phrase":
        if start > 0 and _is_word_char(text[start - 1]):
            return False
        if end < len(text) and _is_word_char(text[end]):
            return False
    # literal: 左 [A-Za-z0-9_]，右 [A-Za-z]（允许版本号、连字符等后缀）
    elif mode == "literal":
        if start > 0 and _is_word_char(text[start - 1]):
            return False
        if end < len(text) and _is_ascii_alpha(text[end]):
            return False
    # auto / 其他：不做边界检查
    return True


# ── RegexGlossaryMatcher ─────────────────────────────────


def _infer_match_mode(entry: GlossaryEntry) -> str:
    """根据 source 内容自动推断 match_mode（auto 模式下使用）。"""
    source = entry.source
    # 含空格 → phrase（先检查，避免被后面的符号判断捕获）
    if " " in source:
        return "phrase"
    # 含符号字符 → literal
    if any(c in source for c in "+.#/-"):
        return "literal"
    return "word"


def _compile_pattern(entry: GlossaryEntry) -> re.Pattern:
    """为单个 GlossaryEntry 预编译正则。"""
    mode = entry.match_mode if entry.match_mode != "auto" else _infer_match_mode(entry)
    source = re.escape(entry.source)
    flags = 0 if entry.case_sensitive else re.IGNORECASE

    if mode == "word":
        pat = rf"(?<![A-Za-z0-9_]){source}(?![A-Za-z0-9_])"
    elif mode == "phrase":
        # 连续空格编译为 \s+，不做分词/词形还原/语义扩展
        pat = r"\s+".join(re.escape(part) for part in entry.source.split())
        pat = rf"(?<![A-Za-z0-9_]){pat}(?![A-Za-z0-9_])"
    elif mode == "literal":
        # 只防止嵌入普通英文单词内部，不强行阻断版本号/连字符后缀
        pat = rf"(?<![A-Za-z0-9_]){source}(?![A-Za-z])"
    else:
        pat = source

    return re.compile(pat, flags)


class RegexGlossaryMatcher:
    """基于预编译正则的术语匹配器。

    初始化时编译所有术语的正则模式，运行时对输入文本逐一搜索。
    时间复杂度 O(terms × text_length)，小词表（≤100 条）下亚毫秒到数毫秒。
    """

    def __init__(self, entries: tuple[GlossaryEntry, ...]) -> None:
        self._patterns: dict[GlossaryEntry, re.Pattern] = {}
        for entry in entries:
            self._patterns[entry] = _compile_pattern(entry)

    def match(
        self,
        text: str,
        *,
        max_terms: int = 12,
        unique_sources: bool = True,
    ) -> list[MatchedTerm]:
        """在文本中匹配术语，返回最多 max_terms 条结果（含 span 和 source_for_prompt）。

        去重策略：按 priority desc + source_len desc 排序，
        若 span 与已选术语重叠，则跳过低优先级/较短术语。
        """
        if not text or not self._patterns:
            return []

        # 收集所有命中
        hits: list[MatchedTerm] = []
        for entry, pattern in self._patterns.items():
            for m in pattern.finditer(text):
                hits.append(
                    MatchedTerm(
                        entry=entry,
                        start=m.start(),
                        end=m.end(),
                        source_for_prompt=m.group(),
                    )
                )

        return _dedupe_and_sort(hits, max_terms, unique_sources=unique_sources)


# ── AhoCorasickGlossaryMatcher ────────────────────────────


class _ACTrieNode:
    """AC 自动机节点。"""

    __slots__ = ("children", "fail", "output")

    def __init__(self) -> None:
        self.children: dict[str, _ACTrieNode] = {}
        self.fail: _ACTrieNode | None = None
        self.output: list[GlossaryEntry] = []  # 以该节点结尾的术语


def _build_ac_trie(entries: tuple[GlossaryEntry, ...]) -> _ACTrieNode:
    """构建 AC 自动机（trie + failure links）。"""
    root = _ACTrieNode()

    # 构建 trie
    for entry in entries:
        key = entry.source if entry.case_sensitive else entry.source.lower()
        node = root
        for ch in key:
            if ch not in node.children:
                node.children[ch] = _ACTrieNode()
            node = node.children[ch]
        node.output.append(entry)

    # 构建 failure links（BFS）
    root.fail = root
    queue: list[_ACTrieNode] = []
    for child in root.children.values():
        child.fail = root
        queue.append(child)

    head = 0
    while head < len(queue):
        current = queue[head]
        head += 1
        for ch, child in current.children.items():
            # 找 fail link
            fail_node = current.fail
            while fail_node is not root and ch not in fail_node.children:
                fail_node = fail_node.fail
            child.fail = fail_node.children.get(ch, root)
            # 合并 output
            if child.fail.output:
                child.output = child.output + child.fail.output
            queue.append(child)

    return root


class AhoCorasickGlossaryMatcher:
    """基于 Aho-Corasick 多模式匹配的术语匹配器。

    初始化时构建 AC 自动机，运行时对文本只做一次扫描。
    时间复杂度 O(text_length + matches)，大词表（>100 条）下稳定亚毫秒。

    注意：AC 做精确匹配，边界检查在命中后做（_check_boundaries）。
    phrase 模式不支持空格归一化（AC 匹配精确空格数）。

    case-sensitive 和 case-insensitive 条目分别构建独立的 AC 自动机，
    搜索时各跑一次，合并结果。
    """

    def __init__(self, entries: tuple[GlossaryEntry, ...]) -> None:
        self._entries = entries
        self._cs_entries = tuple(e for e in entries if e.case_sensitive)
        self._ci_entries = tuple(e for e in entries if not e.case_sensitive)

        # case-sensitive 自动机（用原始 source）
        self._cs_root = _build_ac_trie(self._cs_entries) if self._cs_entries else None
        # case-insensitive 自动机（用 lowercased source）
        self._ci_root = _build_ac_trie(self._ci_entries) if self._ci_entries else None

    def match(
        self,
        text: str,
        *,
        max_terms: int = 12,
        unique_sources: bool = True,
    ) -> list[MatchedTerm]:
        if not text or not self._entries:
            return []

        hits: list[MatchedTerm] = []

        # 扫描 case-sensitive 条目
        if self._cs_root is not None:
            hits.extend(self._scan_trie(self._cs_root, text, text))

        # 扫描 case-insensitive 条目
        if self._ci_root is not None:
            search_text = text.lower()
            hits.extend(self._scan_trie(self._ci_root, search_text, text))

        return _dedupe_and_sort(hits, max_terms, unique_sources=unique_sources)

    def _scan_trie(
        self,
        root: _ACTrieNode,
        search_text: str,
        original_text: str,
    ) -> list[MatchedTerm]:
        """在 AC trie 上扫描，返回匹配结果。

        search_text 是用于 trie 遍历的文本，original_text 是用于提取 span 的原始文本。
        """
        hits: list[MatchedTerm] = []
        node = root
        for i, ch in enumerate(search_text):
            while node is not root and ch not in node.children:
                node = node.fail  # type: ignore[assignment]
            node = node.children.get(ch, root)

            if node.output:
                for entry in node.output:
                    source_len = len(entry.source)
                    start = i - source_len + 1
                    end = i + 1

                    if start < 0:
                        continue

                    mode = entry.match_mode if entry.match_mode != "auto" else _infer_match_mode(entry)
                    if not _check_boundaries(original_text, start, end, mode):
                        continue

                    hits.append(
                        MatchedTerm(
                            entry=entry,
                            start=start,
                            end=end,
                            source_for_prompt=original_text[start:end],
                        )
                    )

        return hits


# ── 公共去重/排序逻辑 ─────────────────────────────────────


def _dedupe_and_sort(
    hits: list[MatchedTerm],
    max_terms: int,
    *,
    unique_sources: bool = True,
) -> list[MatchedTerm]:
    """排序 + 重叠去重。"""
    if max_terms <= 0:
        return []

    # 排序：priority desc + source length desc
    hits.sort(key=lambda h: (-h.entry.priority, -len(h.entry.source)))

    # 重叠去重
    selected: list[MatchedTerm] = []
    seen_sources: set[str] = set()
    for hit in hits:
        source_key = _term_identity(hit.entry)
        if unique_sources and source_key in seen_sources:
            continue
        if _overlaps_any(hit, selected):
            continue
        selected.append(hit)
        seen_sources.add(source_key)
        if len(selected) >= max_terms:
            break

    return selected


def _term_identity(entry: GlossaryEntry) -> str:
    """用于 prompt 限流的术语身份。"""
    source = entry.source.strip()
    return source if entry.case_sensitive else source.lower()


def _overlaps_any(candidate: MatchedTerm, selected: list[MatchedTerm]) -> bool:
    """检查 candidate 的 span 是否与已选术语重叠。"""
    for s in selected:
        if candidate.start < s.end and candidate.end > s.start:
            return True
    return False


# ── Glossary ──────────────────────────────────────────────


class Glossary:
    """术语表。加载时编译匹配器，运行时只匹配。

    自动选择策略：
    - ≤ 100 条 → RegexGlossaryMatcher（regex 在小词表下足够快，支持 phrase 空格归一化）
    - > 100 条 → AhoCorasickGlossaryMatcher（O(text_len) 扫描，不依赖术语数量）

    对外提供两个接口：
    - match() -> dict[str, str]：给 pipeline / translator 使用
    - match_terms() -> list[MatchedTerm]：给流式窗口过滤和 telemetry 使用
    """

    def __init__(self, entries: tuple[GlossaryEntry, ...] = ()) -> None:
        self.entries = entries
        if len(entries) > _AC_THRESHOLD:
            self._matcher: GlossaryMatcher = AhoCorasickGlossaryMatcher(entries)
        else:
            self._matcher = RegexGlossaryMatcher(entries)

    @classmethod
    def from_dict(cls, terms: dict[str, str], category: str = "") -> Glossary:
        """从简单字典构造 Glossary（仅 source + target）。"""
        entries = tuple(
            GlossaryEntry(source=src, target=tgt, category=category)
            for src, tgt in terms.items()
        )
        return cls(entries)

    @classmethod
    def from_csv(cls, path: str) -> Glossary:
        """从单个 CSV 文件加载 Glossary。

        CSV 格式：有表头，source/target 强制，其余列 optional：
        source,target,aliases,category,case_sensitive,match_mode,priority,constraint
        """
        entries: list[GlossaryEntry] = []
        path_obj = Path(path)
        if not path_obj.exists():
            logger.warning("术语 CSV 文件不存在：%s", path)
            return cls()

        with open(path_obj, encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                source = (row.get("source") or "").strip()
                target = (row.get("target") or "").strip()
                if not source or not target:
                    continue

                aliases_raw = (row.get("aliases") or "").strip()
                aliases = [a.strip() for a in aliases_raw.split("|") if a.strip()] if aliases_raw else []

                category = (row.get("category") or "").strip()
                try:
                    priority_raw = row.get("priority")
                    priority = int(priority_raw) if priority_raw else 0
                except (ValueError, TypeError):
                    priority = 0
                case_sensitive_raw = row.get("case_sensitive")
                case_sensitive = (
                    case_sensitive_raw.lower() in ("true", "1", "yes")
                    if case_sensitive_raw
                    else False
                )
                match_mode = (row.get("match_mode") or "").strip() or "auto"
                constraint = (row.get("constraint") or "").strip() or "required"

                # 主 entry
                entries.append(
                    GlossaryEntry(
                        source=source,
                        target=target,
                        category=category,
                        priority=priority,
                        case_sensitive=case_sensitive,
                        match_mode=match_mode,
                        constraint=constraint,
                    )
                )

                # 别名展开为独立 entry（同一 target，不同 source）
                for alias in aliases:
                    entries.append(
                        GlossaryEntry(
                            source=alias,
                            target=target,
                            category=category,
                            priority=priority,
                            case_sensitive=case_sensitive,
                            match_mode=match_mode,
                            constraint=constraint,
                        )
                    )

        return cls(tuple(entries))

    @classmethod
    def from_csv_files(cls, paths: list[str]) -> Glossary:
        """从多个 CSV 文件加载，后加载文件的同名术语覆盖前面的。

        覆盖规则：按 source.lower().strip() 去重，priority 高者优先；
        priority 相同时后加载文件覆盖前加载文件。
        """
        seen: dict[str, GlossaryEntry] = {}  # normalized source -> entry

        for path in paths:
            glossary = cls.from_csv(path)
            for entry in glossary.entries:
                norm = entry.source.lower().strip()
                if norm in seen:
                    existing = seen[norm]
                    if entry.priority > existing.priority:
                        seen[norm] = entry
                    else:
                        # priority 相同或更低时，后加载覆盖
                        if entry.priority == existing.priority:
                            seen[norm] = entry
                else:
                    seen[norm] = entry

        return cls(tuple(seen.values()))

    def match(self, text: str, *, max_terms: int = 12) -> dict[str, str]:
        """返回匹配到的术语 {source_for_prompt: target}，按 priority 和长度排序。"""
        matched = self._matcher.match(text, max_terms=max_terms)
        return {m.source_for_prompt: m.entry.target for m in matched}

    def match_terms(
        self,
        text: str,
        *,
        max_terms: int = 12,
        unique_sources: bool = True,
    ) -> list[MatchedTerm]:
        """返回带 span 的匹配结果，供流式窗口过滤和 telemetry 使用。"""
        return self._matcher.match(text, max_terms=max_terms, unique_sources=unique_sources)

    def as_asr_phrases(self) -> list[str]:
        """返回所有术语 source 列表，用于 ASR 侧 phrase list / custom vocabulary。

        未来可接 FunASR、Voxtral、Azure Speech、Google Speech-to-Text 等的 phrase bias。
        """
        return list({e.source for e in self.entries})


# ── 公共替换函数（仅用于 MockTranslator 和测试） ─────────────


# apply_glossary_replacements 的 Glossary 缓存（key = 冻结的 glossary 项集合）
_apply_glossary_cache: dict[frozenset, Glossary] = {}


def apply_glossary_replacements(text: str, glossary: dict[str, str]) -> str:
    """基于 word-boundary 匹配的术语替换。仅用于 mock 和测试。

    注意：真实 LLM 翻译不是简单的 search-replace，DeepL 等成熟翻译
    glossary 会根据目标语言语法适配。

    缓存：同一 glossary 字典只构造一次 Glossary/Matcher，避免重复预编译。
    """
    if not text or not glossary:
        return text

    cache_key = frozenset(glossary.items())
    if cache_key not in _apply_glossary_cache:
        _apply_glossary_cache[cache_key] = Glossary.from_dict(glossary)
    runtime_glossary = _apply_glossary_cache[cache_key]

    matches = runtime_glossary.match_terms(
        text,
        max_terms=max(1, len(text)),
        unique_sources=False,
    )

    # 按 span 从右往左替换，避免替换后索引偏移
    for match in sorted(matches, key=lambda m: m.start, reverse=True):
        text = text[: match.start] + match.entry.target + text[match.end:]

    return text


# ── 内置域预设 ─────────────────────────────────────────────

# 项目根目录下的 terms/ 目录
_DEFAULT_TERMS_DIR = Path(__file__).resolve().parents[4] / "terms"

DOMAIN_PRESETS: dict[str, Glossary] = {}


def _load_domain_presets() -> None:
    """懒加载内置域预设。"""
    global DOMAIN_PRESETS
    if DOMAIN_PRESETS:
        return

    if _DEFAULT_TERMS_DIR.is_dir():
        for csv_file in _DEFAULT_TERMS_DIR.glob("*.csv"):
            domain = csv_file.stem
            DOMAIN_PRESETS[domain] = Glossary.from_csv(str(csv_file))


def get_domain_preset(domain: str) -> Glossary | None:
    """获取指定域名的术语预设，不存在则返回 None。"""
    _load_domain_presets()
    return DOMAIN_PRESETS.get(domain)
