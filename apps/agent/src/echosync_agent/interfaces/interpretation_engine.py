from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from echosync_agent.domain import AudioFrame, InterpretationEvent, ModelProfile


class InterpretationEngine(Protocol):
    """统一听译引擎边界，兼容级联模型和端到端模型。"""

    @property
    def profile(self) -> ModelProfile:
        raise NotImplementedError

    def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[InterpretationEvent]:
        raise NotImplementedError
