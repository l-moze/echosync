from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

from echosync_agent.domain import CorrectionContext, SegmentStatus, TranslationSegment
from echosync_agent.services.translation.deepseek_translator import (
    DeepSeekTranslator,
    should_flush_streaming_target,
)


def test_deepseek_streaming_target_waits_for_short_cjk_deltas() -> None:
    assert should_flush_streaming_target(previous_text="", next_text="大") is False
    assert should_flush_streaming_target(previous_text="", next_text="大家好") is False
    assert should_flush_streaming_target(previous_text="大家好", next_text="大家好呀") is False


def test_deepseek_streaming_target_flushes_on_enough_text_or_punctuation() -> None:
    assert should_flush_streaming_target(previous_text="", next_text="大家好呀") is True
    assert should_flush_streaming_target(previous_text="大家好呀", next_text="大家好呀今天") is True
    assert should_flush_streaming_target(previous_text="", next_text="大家好，欢迎") is True
    assert should_flush_streaming_target(previous_text="", next_text="大家好欢迎大家") is True
    assert should_flush_streaming_target(previous_text="大家好", next_text="大家好呀。") is True
    assert (
        should_flush_streaming_target(
            previous_text="大家好欢迎大家",
            next_text="大家好欢迎大家今天",
        )
        is True
    )


def test_deepseek_streaming_target_flushes_on_final_and_rewrite() -> None:
    assert should_flush_streaming_target(previous_text="旧译文", next_text="新") is True
    assert (
        should_flush_streaming_target(
            previous_text="大家好",
            next_text="大家好呀",
            is_final=True,
        )
        is True
    )


def test_deepseek_prompt_includes_current_segment_revision_context() -> None:
    translator = DeepSeekTranslator(
        api_key="test",
        base_url="https://example.invalid/v1",
        model="deepseek-test",
        target_lang="zh-CN",
    )
    previous = TranslationSegment(
        session_id="sess_prompt",
        segment_id="seg_live",
        rev=2,
        source_rev=2,
        start_ms=0,
        end_ms=1_200,
        source_lang="en",
        target_lang="zh-CN",
        source_text="I think this model",
        target_text="我认为这个模型",
        status=SegmentStatus.STABLE,
        stability=0.9,
    )
    context = CorrectionContext(
        recent_segments=(),
        current_segment_revisions=(previous,),
    )

    prompt = translator._build_user_prompt("I think this module", context)

    assert "<current_segment_revisions>" in prompt
    assert "<source>I think this model</source>" in prompt
    assert "<target>我认为这个模型</target>" in prompt
    assert "<source>I think this module</source>" in prompt


def test_deepseek_streaming_request_disables_thinking_and_reuses_client() -> None:
    client = FakeOpenAIClient([FakeChunk("大家好"), FakeChunk("", usage=FakeUsage(hit=9, miss=3))])
    factory = RecordingClientFactory({"https://api.deepseek.com/v1": client})
    translator = DeepSeekTranslator(
        api_key="test",
        base_url="https://api.deepseek.com/v1",
        client_factory=factory,
        model="deepseek-test",
        target_lang="zh-CN",
    )
    segment = transcript_segment(text="Hello everyone.")

    first = asyncio.run(collect(translator.stream_translate(segment, CorrectionContext(recent_segments=()))))
    second = asyncio.run(collect(translator.stream_translate(segment, CorrectionContext(recent_segments=()))))

    assert [item.target_text for item in first] == ["大家好"]
    assert second[-1].metrics["prompt_cache_hit_tokens"] == 9
    assert second[-1].metrics["prompt_cache_miss_tokens"] == 3
    assert factory.base_urls == ["https://api.deepseek.com/v1"]
    assert len(client.calls) == 2
    for call in client.calls:
        assert call["stream"] is True
        assert call["stream_options"] == {"include_usage": True}
        assert call["extra_body"] == {"thinking": {"type": "disabled"}}


def test_deepseek_streaming_emits_final_metrics_when_usage_arrives_after_text() -> None:
    client = FakeOpenAIClient(
        [
            FakeChunk("大家好呀"),
            FakeChunk("今天"),
            FakeChunk("", usage=FakeUsage(hit=11, miss=5)),
        ]
    )
    factory = RecordingClientFactory({"https://api.deepseek.com/v1": client})
    translator = DeepSeekTranslator(
        api_key="test",
        base_url="https://api.deepseek.com/v1",
        client_factory=factory,
        model="deepseek-test",
        target_lang="zh-CN",
    )

    results = asyncio.run(
        collect(
            translator.stream_translate(
                transcript_segment(text="Hello everyone today."),
                CorrectionContext(recent_segments=()),
            )
        )
    )

    assert [item.target_text for item in results] == ["大家好呀", "大家好呀今天", "大家好呀今天"]
    assert results[-1].metrics["prompt_cache_hit_tokens"] == 11
    assert results[-1].metrics["prompt_cache_miss_tokens"] == 5


def test_deepseek_prefix_completion_extends_append_only_current_segment_revision() -> None:
    normal_client = FakeOpenAIClient([FakeChunk("普通翻译")])
    beta_client = FakeOpenAIClient([FakeChunk("个模块")])
    factory = RecordingClientFactory(
        {
            "https://api.deepseek.com/v1": normal_client,
            "https://api.deepseek.com/beta": beta_client,
        }
    )
    translator = DeepSeekTranslator(
        api_key="test",
        base_url="https://api.deepseek.com/v1",
        client_factory=factory,
        model="deepseek-test",
        target_lang="zh-CN",
    )
    previous = translation_segment(source_text="I think this", target_text="我认为这")
    context = CorrectionContext(recent_segments=(), current_segment_revisions=(previous,))
    segment = transcript_segment(text="I think this module")

    results = asyncio.run(collect(translator.stream_translate(segment, context)))

    assert [item.target_text for item in results] == ["我认为这个模块"]
    assert factory.base_urls == ["https://api.deepseek.com/beta"]
    assert normal_client.calls == []
    assert beta_client.calls[0]["messages"][-1] == {
        "role": "assistant",
        "content": "我认为这",
        "prefix": True,
    }


def test_deepseek_prefix_completion_is_not_used_when_source_revision_rewrites_prefix() -> None:
    normal_client = FakeOpenAIClient([FakeChunk("我认为这个模块")])
    beta_client = FakeOpenAIClient([FakeChunk("错误前缀")])
    factory = RecordingClientFactory(
        {
            "https://api.deepseek.com/v1": normal_client,
            "https://api.deepseek.com/beta": beta_client,
        }
    )
    translator = DeepSeekTranslator(
        api_key="test",
        base_url="https://api.deepseek.com/v1",
        client_factory=factory,
        model="deepseek-test",
        target_lang="zh-CN",
    )
    previous = translation_segment(source_text="I think this model", target_text="我认为这个模型")
    context = CorrectionContext(recent_segments=(), current_segment_revisions=(previous,))
    segment = transcript_segment(text="I think this module")

    results = asyncio.run(collect(translator.stream_translate(segment, context)))

    assert [item.target_text for item in results] == ["我认为这个模块"]
    assert factory.base_urls == ["https://api.deepseek.com/v1"]
    assert beta_client.calls == []
    assert all(message.get("prefix") is None for message in normal_client.calls[0]["messages"])


def transcript_segment(text: str):
    from echosync_agent.domain import TranscriptSegment

    return TranscriptSegment(
        session_id="sess_deepseek",
        segment_id="seg_deepseek",
        rev=1,
        start_ms=0,
        end_ms=1_000,
        source_lang="en",
        text=text,
        status=SegmentStatus.STABLE,
        stability=0.9,
    )


def translation_segment(source_text: str, target_text: str) -> TranslationSegment:
    return TranslationSegment(
        session_id="sess_deepseek",
        segment_id="seg_deepseek",
        rev=1,
        source_rev=1,
        start_ms=0,
        end_ms=1_000,
        source_lang="en",
        target_lang="zh-CN",
        source_text=source_text,
        target_text=target_text,
        status=SegmentStatus.STABLE,
        stability=0.9,
    )


async def collect(items: AsyncIterator[TranslationSegment]) -> list[TranslationSegment]:
    return [item async for item in items]


class RecordingClientFactory:
    def __init__(self, clients: dict[str, "FakeOpenAIClient"]) -> None:
        self.clients = clients
        self.base_urls: list[str] = []

    def __call__(self, *, api_key: str, base_url: str) -> "FakeOpenAIClient":
        assert api_key == "test"
        if base_url not in self.base_urls:
            self.base_urls.append(base_url)
        return self.clients[base_url]


class FakeOpenAIClient:
    def __init__(self, chunks: list["FakeChunk"]) -> None:
        self.calls: list[dict[str, Any]] = []
        self.chat = FakeChat(self)
        self._chunks = chunks

    async def create(self, **kwargs: Any) -> AsyncIterator["FakeChunk"]:
        self.calls.append(kwargs)
        for chunk in self._chunks:
            yield chunk


class FakeChat:
    def __init__(self, client: FakeOpenAIClient) -> None:
        self.completions = FakeCompletions(client)


class FakeCompletions:
    def __init__(self, client: FakeOpenAIClient) -> None:
        self.client = client

    async def create(self, **kwargs: Any) -> AsyncIterator["FakeChunk"]:
        return self.client.create(**kwargs)


class FakeChunk:
    def __init__(self, content: str, usage: "FakeUsage | None" = None) -> None:
        self.choices = [FakeChoice(content)] if content else []
        self.usage = usage


class FakeChoice:
    def __init__(self, content: str) -> None:
        self.delta = FakeDelta(content)


class FakeDelta:
    def __init__(self, content: str) -> None:
        self.content = content


class FakeUsage:
    def __init__(self, *, hit: int, miss: int) -> None:
        self.prompt_cache_hit_tokens = hit
        self.prompt_cache_miss_tokens = miss
