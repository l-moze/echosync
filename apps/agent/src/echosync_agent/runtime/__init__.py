from __future__ import annotations

from typing import Any

__all__ = ["build_demo_pipeline"]


def __getattr__(name: str) -> Any:
    if name == "build_demo_pipeline":
        from echosync_agent.runtime.assembly import build_demo_pipeline

        return build_demo_pipeline
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
