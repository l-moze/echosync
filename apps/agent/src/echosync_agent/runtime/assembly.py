from __future__ import annotations

import logging

from echosync_agent.pipeline.engine_pipeline import EngineDrivenInterpretationPipeline
from echosync_agent.pipeline.realtime_pipeline import RealtimeInterpretationPipeline
from echosync_agent.runtime.event_bus import InMemoryEventBus
from echosync_agent.runtime.settings import Settings
from echosync_agent.services.asr.factory import build_transcriber_from_settings
from echosync_agent.services.correction.semantic_repair import DeepSeekTranslationRepairEngine
from echosync_agent.services.correction.revision_window import RevisionWindowCorrectionEngine
from echosync_agent.services.subtitle.event_sink import EventSubtitleSink
from echosync_agent.services.translation.deepseek_translator import DeepSeekTranslator
from echosync_agent.services.translation.mock_translator import MockTranslator
from echosync_agent.services.translation.terminology import Glossary
from echosync_agent.services.tts.event_audio_sink import EventTranslatedAudioSink
from echosync_agent.services.tts.factory import build_tts_synthesizer_from_settings
from echosync_agent.services.tts.utterance_splitter import TtsUtteranceSplitter

logger = logging.getLogger(__name__)


def build_demo_pipeline(
    settings: Settings | None = None,
    caption_event_bus: object | None = None,
) -> tuple[RealtimeInterpretationPipeline, InMemoryEventBus]:
    """用供应商适配器组装管道。

    原则：依赖倒置。只有装配层知道具体供应商。

    caption_event_bus: 可选的字幕事件推送中枢（CaptionEventHub），
    用于向 Desktop 端实时推送字幕事件。
    """

    resolved = settings or Settings.from_env()
    event_bus = InMemoryEventBus()

    # 订阅事件总线，推送事件到 Desktop
    if caption_event_bus is not None:
        _subscribe_caption_pusher(event_bus, caption_event_bus)

    if resolved.asr_provider == "qwen-livetranslate":
        pipeline = _build_qwen_livetranslate_pipeline(
            resolved,
            event_bus=event_bus,
        )
        return pipeline, event_bus

    glossary = _load_glossary(resolved)
    pipeline = RealtimeInterpretationPipeline(
        transcriber=_build_transcriber(resolved),
        translator=_build_translator(resolved),
        correction_engine=RevisionWindowCorrectionEngine(),
        subtitle_sink=EventSubtitleSink(event_bus),
        target_lang=resolved.target_lang,
        glossary=glossary,
        tts_synthesizer=build_tts_synthesizer_from_settings(resolved),
        audio_sink=EventTranslatedAudioSink(event_bus),
        tts_utterance_splitter=TtsUtteranceSplitter(
            max_chars=resolved.tts_utterance_max_chars,
            min_chars=resolved.tts_utterance_min_chars,
        ),
        translation_repair_engine=_build_translation_repair_engine(resolved),
        translation_repair_timeout_ms=resolved.translation_repair_timeout_ms,
        translation_repair_max_concurrency=resolved.translation_repair_max_concurrency,
        translation_repair_mode=resolved.translation_repair_mode,
        tts_prefetch_concurrency=resolved.tts_prefetch_concurrency,
    )
    return pipeline, event_bus


def _subscribe_caption_pusher(event_bus: InMemoryEventBus, caption_event_bus: object) -> None:
    """将事件总线的字幕事件转发到 WebSocket 推送中枢。"""

    async def _push(event_type: str, payload: object) -> None:
        await caption_event_bus.publish(event_type, payload)  # type: ignore[attr-defined]

    for event_type in (
        "transcript.partial",
        "translation.partial",
        "caption_update",
        "translation.patch",
        "segment.commit",
        "tts.audio",
        "tts.error",
    ):
        event_bus.subscribe(event_type, _push)


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
    if settings.translator_provider == "deepl":
        if not settings.deepl_api_key:
            raise ValueError("使用 DeepL 翻译器时必须配置 DEEPL_API_KEY。")
        from echosync_agent.services.translation.deepl_translator import DeepLTranslator

        return DeepLTranslator(
            api_key=settings.deepl_api_key,
            base_url=settings.deepl_base_url,
            target_lang=settings.target_lang,
            model_type=settings.deepl_model_type,
        )
    raise ValueError(f"不支持的翻译供应商：{settings.translator_provider}")


def _build_translation_repair_engine(settings: Settings):
    if settings.translation_repair_provider == "disabled":
        return None
    if settings.translation_repair_provider == "deepseek":
        if not settings.deepseek_api_key:
            raise ValueError("使用 DeepSeek 慢修复时必须配置 DEEPSEEK_API_KEY。")
        return DeepSeekTranslationRepairEngine(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
            model=settings.translation_repair_model,
            target_lang=settings.target_lang,
        )
    raise ValueError(f"不支持的翻译慢修复供应商：{settings.translation_repair_provider}")


def _build_qwen_livetranslate_pipeline(
    settings: Settings,
    *,
    event_bus: InMemoryEventBus,
) -> EngineDrivenInterpretationPipeline:
    if not settings.qwen_api_key:
        raise ValueError("使用 Qwen LiveTranslate 时必须配置 DASHSCOPE_API_KEY 或 QWEN_API_KEY。")

    from echosync_agent.services.engine.qwen_livetranslate_engine import (
        QwenLiveTranslateConfig,
        QwenLiveTranslateEngine,
    )

    return EngineDrivenInterpretationPipeline(
        engine=QwenLiveTranslateEngine(
            QwenLiveTranslateConfig(
                api_key=settings.qwen_api_key,
                model=settings.qwen_livetranslate_model,
                base_url=settings.qwen_realtime_base_url,
                source_lang=settings.qwen_livetranslate_source_lang,
                target_lang=settings.target_lang,
                output_audio=settings.qwen_livetranslate_output_audio,
                vad_silence_duration_ms=_qwen_livetranslate_vad_silence_ms_for_latency_mode(
                    latency_mode=settings.asr_latency_mode,
                ),
            )
        ),
        subtitle_sink=EventSubtitleSink(event_bus),
        audio_sink=EventTranslatedAudioSink(event_bus),
    )


def _qwen_livetranslate_vad_silence_ms_for_latency_mode(*, latency_mode: str) -> int:
    if latency_mode == "low_latency":
        return 500
    if latency_mode == "accuracy":
        return 1000
    return 800


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
