from __future__ import annotations

from echosync_agent.pipeline import RealtimeInterpretationPipeline


class LiveKitAgentBridge:
    """LiveKit integration boundary.

    The bridge will adapt LiveKit room audio frames into AudioFrame DTOs and publish subtitle
    events through the room data channel. The interpretation pipeline remains transport-agnostic.
    """

    def __init__(self, pipeline: RealtimeInterpretationPipeline) -> None:
        self.pipeline = pipeline

    async def run(self) -> None:
        raise NotImplementedError(
            "LiveKit room wiring is scheduled for MVP Day 1 after credentials are available."
        )
