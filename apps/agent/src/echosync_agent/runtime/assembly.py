from __future__ import annotations

import logging

from echosync_agent.pipeline.realtime_pipeline import RealtimeInterpretationPipeline
from echosync_agent.runtime.event_bus import InMemoryEventBus
from echosync_agent.runtime.settings import Settings
from echosync_agent.services.asr.factory import build_transcriber_from_settings
from echosync_agent.services.correction.revision_window import RevisionWindowCorrectionEngine
from echosync_agent.services.subtitle.event_sink import EventSubtitleSink
from echosync_agent.services.translation.deepseek_translator import DeepSeekTranslator
from echosync_agent.services.translation.mock_translator import MockTranslator
from echosync_agent.services.translation.terminology import Glossary

logger = logging.getLogger(__name__)


def build_demo_pipeline(
    settings: Settings | None = None,
) -> tuple[RealtimeInterpretationPipeline, InMemoryEventBus]:
    """用供应商适配器组装管道。

    原则：依赖倒置。只有装配层知道具体供应商。
    """

    resolved = settings or Settings.from_env()
    event_bus = InMemoryEventBus()
    glossary = _load_glossary(resolved)
    pipeline = RealtimeInterpretationPipeline(
        transcriber=_build_transcriber(resolved),
        translator=_build_translator(resolved),
        correction_engine=RevisionWindowCorrectionEngine(),
        subtitle_sink=EventSubtitleSink(event_bus),
        target_lang=resolved.target_lang,
        glossary=glossary,
    )
    return pipeline, event_bus


def _build_transcriber(settings: Settings):
    return build_transcriber_from_settings(settings)


def _build_translator(settings: Settings):
    if settings.translator_provider == "mock":
        return MockTranslator(target_lang=settings.target_lang)
    if settings.translator_provider == "deepseek":
        if not settings.deepseek_api_key:
            raise ValueError("使用 DeepSeek 翻译器时必须配置 DEEPSEEK_API_KEY。")
        return DeepSeekTranslator(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
            model=settings.deepseek_model,
            target_lang=settings.target_lang,
        )
    raise ValueError(f"不支持的翻译供应商：{settings.translator_provider}")


def _load_glossary(settings: Settings) -> Glossary:
    """根据 settings 加载术语表。

    - glossary_enabled=false → 空 Glossary()
    - glossary_domain="" → 空 Glossary()
    - glossary_domain="default" → 加载 terms/default.csv
    - glossary_domain="tech" → 加载 terms/default.csv + terms/tech.csv，后者覆盖前者
    - CSV 文件不存在 → logger.warning 后返回空 Glossary()，不中断 pipeline
    """
    if not settings.glossary_enabled:
        return Glossary()

    domain = settings.glossary_domain
    if not domain:
        return Glossary()

    # 确定术语目录
    if settings.glossary_terms_dir:
        terms_dir = settings.glossary_terms_dir
    else:
        from pathlib import Path

        terms_dir = str(Path(__file__).resolve().parents[3] / "terms")

    # 加载文件列表
    from pathlib import Path

    paths: list[str] = []
    default_csv = Path(terms_dir) / "default.csv"
    if default_csv.exists():
        paths.append(str(default_csv))
    else:
        logger.warning("默认术语文件不存在：%s", default_csv)

    # 如果 domain != "default"，尝试加载 domain-specific CSV
    if domain != "default":
        domain_csv = Path(terms_dir) / f"{domain}.csv"
        if domain_csv.exists():
            paths.append(str(domain_csv))
        else:
            logger.warning("领域术语文件不存在：%s", domain_csv)

    if not paths:
        return Glossary()

    return Glossary.from_csv_files(paths)
