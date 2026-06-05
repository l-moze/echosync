from __future__ import annotations

from dataclasses import asdict
from enum import Enum
from typing import Any

from echosync_agent.domain import SegmentCommit, SubtitlePatch, TranslationSegment
from echosync_agent.interfaces import EventBus, SubtitleSink


class EventSubtitleSink(SubtitleSink):
    """把字幕事件追加到事件总线的输出端。

    原则：观察者模式和事件溯源。UI 数据通道、测试和日志可以观察同一批事件，
    管道不需要耦合到任何具体传输。
    """

    def __init__(self, event_bus: EventBus) -> None:
        self.event_bus = event_bus

    async def publish_translation(self, segment: TranslationSegment) -> None:
        if segment.target_text == "":
            await self.event_bus.publish(
                "transcript.partial",
                _payload("transcript.partial", segment),
            )
            return
        await self.event_bus.publish(
            "translation.partial",
            _payload("translation.partial", segment),
        )

    async def publish_patch(self, patch: SubtitlePatch) -> None:
        await self.event_bus.publish("translation.patch", _payload("translation.patch", patch))

    async def publish_commit(self, commit: SegmentCommit) -> None:
        await self.event_bus.publish("segment.commit", _payload("segment.commit", commit))


def _payload(event_type: str, value: object) -> dict[str, Any]:
    data = _jsonable(asdict(value))
    data["type"] = event_type
    return data


def _jsonable(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_jsonable(item) for item in value]
    return value
