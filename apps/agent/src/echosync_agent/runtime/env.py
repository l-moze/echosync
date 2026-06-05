from __future__ import annotations

from pathlib import Path


def load_project_dotenv() -> None:
    """加载仓库根目录 .env，缺失 python-dotenv 时保持无副作用。"""

    try:
        from dotenv import load_dotenv
    except ImportError:
        return

    root = Path(__file__).resolve().parents[5]
    load_dotenv(root / ".env")
