from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from echosync_agent.domain import AudioFrame


class AudioSource(Protocol):
    """最小音频源接口。

    原则：接口隔离。管道只需要异步音频帧流，不依赖供应商特定的传输控制。
    Windows 系统声音、麦克风、混音或文件回放都必须先转换为 AudioFrame，
    不能让 WASAPI、Electron IPC 或浏览器设备 API 泄漏到 ASR/翻译管道。
    """

    def frames(self) -> AsyncIterator[AudioFrame]:
        raise NotImplementedError
