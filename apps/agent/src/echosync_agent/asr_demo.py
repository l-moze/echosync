from __future__ import annotations

import argparse
import asyncio
import time
from collections.abc import AsyncIterator

from echosync_agent.domain import AudioFrame, TranscriptSegment
from echosync_agent.interfaces import Transcriber
from echosync_agent.runtime.env import load_project_dotenv
from echosync_agent.runtime.settings import Settings
from echosync_agent.services.asr.factory import build_transcriber_from_settings
from echosync_agent.services.media import MediaAudioSource


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="EchoSync ASR 媒体文件终端验证工具。")
    parser.add_argument("media", help="视频或音频文件路径。")
    parser.add_argument("--provider", choices=["funasr", "mock", "voxtral"], default="funasr")
    parser.add_argument("--model", default=None)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--chunk-ms", type=int, default=600)
    parser.add_argument("--source-lang", default="zh")
    parser.add_argument("--mistral-api-key", default="")
    parser.add_argument("--voxtral-delay-ms", type=int, default=1000)
    return parser


async def run_asr_demo(args: argparse.Namespace) -> None:
    source = MediaAudioSource(
        path=args.media,
        session_id="sess_asr_demo",
        source_lang=args.source_lang,
        chunk_ms=args.chunk_ms,
    )
    transcriber = build_transcriber(args)

    started_at = time.perf_counter()
    segment_count = 0
    async for segment in transcriber.stream(source.frames()):
        segment_count += 1
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        audio_ms = max(segment.end_ms, 1)
        end_to_end_rtf = elapsed_ms / audio_ms
        asr_latency_ms = segment.metrics.get("asr_latency_ms", float(elapsed_ms))
        asr_rtf = segment.metrics.get("asr_rtf", end_to_end_rtf)
        print(
            f"[{segment.status}] "
            f"{_format_ms(segment.start_ms)}-{_format_ms(segment.end_ms)} "
            f"asr={asr_latency_ms:.0f}ms asr_rtf={asr_rtf:.2f} e2e_rtf={end_to_end_rtf:.2f} "
            f"{segment.text}"
        )

    if segment_count == 0:
        print("未识别到文本。请确认媒体文件包含清晰人声，或切换 ASR 模型。")


def build_transcriber(args: argparse.Namespace) -> Transcriber:
    if args.provider == "mock":
        return FrameCountingTranscriber()
    settings = Settings.from_env()
    model = args.model or _default_model_for_provider(args.provider, settings)
    return build_transcriber_from_settings(
        Settings(
            asr_provider=args.provider,
            translator_provider=settings.translator_provider,
            tts_provider=settings.tts_provider,
            target_lang=settings.target_lang,
            funasr_model=model,
            funasr_device=args.device,
            funasr_chunk_ms=args.chunk_ms,
            asr_server_port=settings.asr_server_port,
            deepseek_api_key=settings.deepseek_api_key,
            deepseek_base_url=settings.deepseek_base_url,
            deepseek_model=settings.deepseek_model,
            edge_tts_voice=settings.edge_tts_voice,
            mistral_api_key=args.mistral_api_key or settings.mistral_api_key,
            voxtral_model=model,
            voxtral_target_delay_ms=args.voxtral_delay_ms,
            glossary_enabled=settings.glossary_enabled,
            glossary_domain=settings.glossary_domain,
            glossary_terms_dir=settings.glossary_terms_dir,
        )
    )


def _default_model_for_provider(provider: str, settings: Settings) -> str:
    if provider == "voxtral":
        return settings.voxtral_model
    return settings.funasr_model


class FrameCountingTranscriber(Transcriber):
    """用于验证媒体抽取和 chunk 时序的本地转写器。"""

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        from echosync_agent.domain import SegmentStatus, new_segment_id

        async for frame in frames:
            yield TranscriptSegment(
                session_id=frame.session_id,
                segment_id=new_segment_id(),
                rev=1,
                start_ms=frame.start_ms,
                end_ms=frame.end_ms,
                source_lang=frame.source_lang,
                text=f"PCM chunk #{frame.seq}: {len(frame.pcm)} bytes",
                status=SegmentStatus.COMMITTED,
                stability=1.0,
            )


def _format_ms(value: int) -> str:
    seconds = value / 1000
    return f"{seconds:07.2f}s"


def main() -> None:
    load_project_dotenv()
    parser = build_arg_parser()
    asyncio.run(run_asr_demo(parser.parse_args()))


if __name__ == "__main__":
    main()
