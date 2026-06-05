from __future__ import annotations

from echosync_agent.pipeline.realtime_pipeline import RealtimeInterpretationPipeline
from echosync_agent.runtime.event_bus import InMemoryEventBus
from echosync_agent.runtime.settings import Settings
from echosync_agent.services.asr.funasr_transcriber import FunAsrTranscriber
from echosync_agent.services.asr.mock_transcriber import MockTranscriber
from echosync_agent.services.correction.revision_window import RevisionWindowCorrectionEngine
from echosync_agent.services.subtitle.event_sink import EventSubtitleSink
from echosync_agent.services.translation.deepseek_translator import DeepSeekTranslator
from echosync_agent.services.translation.mock_translator import MockTranslator


def build_demo_pipeline(
    settings: Settings | None = None,
) -> tuple[RealtimeInterpretationPipeline, InMemoryEventBus]:
    """Compose a pipeline from provider adapters.

    Principle: dependency inversion. Assembly is the only place that knows concrete providers.
    """

    resolved = settings or Settings.from_env()
    event_bus = InMemoryEventBus()
    pipeline = RealtimeInterpretationPipeline(
        transcriber=_build_transcriber(resolved),
        translator=_build_translator(resolved),
        correction_engine=RevisionWindowCorrectionEngine(),
        subtitle_sink=EventSubtitleSink(event_bus),
        target_lang=resolved.target_lang,
    )
    return pipeline, event_bus


def _build_transcriber(settings: Settings):
    if settings.asr_provider == "mock":
        return MockTranscriber()
    if settings.asr_provider == "funasr":
        return FunAsrTranscriber(settings.funasr_ws_url)
    raise ValueError(f"Unsupported ASR provider: {settings.asr_provider}")


def _build_translator(settings: Settings):
    if settings.translator_provider == "mock":
        return MockTranslator(target_lang=settings.target_lang)
    if settings.translator_provider == "deepseek":
        if not settings.deepseek_api_key:
            raise ValueError("DEEPSEEK_API_KEY is required for the DeepSeek translator.")
        return DeepSeekTranslator(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
            model=settings.deepseek_model,
            target_lang=settings.target_lang,
        )
    raise ValueError(f"Unsupported translator provider: {settings.translator_provider}")
