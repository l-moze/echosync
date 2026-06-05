from __future__ import annotations

from echosync_agent.pipeline import RealtimeInterpretationPipeline


class LiveKitAgentBridge:
    """LiveKit 集成边界。

    这个桥接层负责把 LiveKit 房间音频帧适配成 AudioFrame DTO，并通过房间数据通道
    发布字幕事件。同传管道保持与传输层无关。
    """

    def __init__(self, pipeline: RealtimeInterpretationPipeline) -> None:
        self.pipeline = pipeline

    async def run(self) -> None:
        raise NotImplementedError(
            "LiveKit 房间接线预留到凭据可用后的 MVP Day 1。"
        )
