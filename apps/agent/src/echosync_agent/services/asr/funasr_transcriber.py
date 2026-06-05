from __future__ import annotations

import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

import numpy as np

from echosync_agent.domain import AudioFrame, SegmentStatus, TranscriptSegment, new_segment_id
from echosync_agent.interfaces import Transcriber


@dataclass(frozen=True, slots=True)
class FunAsrStreamingConfig:
    """FunASR 流式识别配置。

    chunk_size 使用 FunASR 官方流式模型的语义，chunk_ms 是本地音频切片粒度。
    """

    model: str = "paraformer-zh-streaming"
    device: str = "auto"
    chunk_size: tuple[int, int, int] = (0, 10, 5)
    encoder_chunk_look_back: int = 4
    decoder_chunk_look_back: int = 1
    chunk_ms: int = 600
    source_lang: str = "zh"


ModelFactory = Callable[[], Any]


class FunAsrTranscriber(Transcriber):
    """FunASR 流式识别适配器。

    原则：依赖倒置。管道只依赖 Transcriber；FunASR 的 AutoModel、cache 和 chunk
    维护被封装在适配器内部，不泄漏给翻译或字幕输出。
    """

    def __init__(
        self,
        model_factory: ModelFactory | None = None,
        config: FunAsrStreamingConfig | None = None,
    ) -> None:
        self.config = config or FunAsrStreamingConfig()
        self._model_factory = model_factory or self._default_model_factory
        self._model: Any | None = None

    async def stream(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[TranscriptSegment]:
        cache: dict[str, Any] = {}

        async for frame in frames:
            segment = self._recognize_frame(frame, cache=cache, is_final=frame.is_final)
            if segment is not None:
                yield segment

    def _recognize_frame(
        self,
        frame: AudioFrame,
        cache: dict[str, Any],
        is_final: bool,
    ) -> TranscriptSegment | None:
        model = self._get_model()
        started_at = time.perf_counter()
        result = model.generate(
            input=_pcm16le_to_float32(frame.pcm),
            cache=cache,
            is_final=is_final,
            chunk_size=list(self.config.chunk_size),
            encoder_chunk_look_back=self.config.encoder_chunk_look_back,
            decoder_chunk_look_back=self.config.decoder_chunk_look_back,
            disable_pbar=True,
        )
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        text = _extract_text(result)
        if not text:
            return None
        audio_ms = max(frame.end_ms - frame.start_ms, 1)

        source_lang = frame.source_lang if frame.source_lang != "auto" else self.config.source_lang

        return TranscriptSegment(
            session_id=frame.session_id,
            segment_id=new_segment_id(),
            rev=1,
            start_ms=frame.start_ms,
            end_ms=frame.end_ms,
            source_lang=source_lang,
            text=text,
            status=SegmentStatus.COMMITTED if is_final else SegmentStatus.PARTIAL,
            stability=1.0 if is_final else 0.72,
            metrics={
                "asr_latency_ms": float(elapsed_ms),
                "asr_rtf": elapsed_ms / audio_ms,
            },
        )

    def _get_model(self) -> Any:
        if self._model is None:
            self._model = self._model_factory()
        return self._model

    def _default_model_factory(self) -> Any:
        try:
            from funasr import AutoModel
        except ImportError as exc:
            raise RuntimeError(
                "未安装 FunASR。请先在 apps/agent 环境中安装 funasr 和 modelscope。"
            ) from exc

        resolved_device = resolve_funasr_device(self.config.device)
        return AutoModel(model=self.config.model, device=resolved_device, disable_update=True)


def resolve_funasr_device(
    requested_device: str,
    cuda_is_available: Callable[[], bool] | None = None,
) -> str:
    """解析 FunASR 运行设备。

    `auto` 和 `cuda` 都会优先使用 CUDA；检测不到可用 GPU 时回退 CPU。
    显式传入 `cpu` 时强制使用 CPU，方便排查 CUDA 环境问题。
    """

    normalized = requested_device.strip().lower()
    if normalized == "cpu":
        return "cpu"
    if normalized not in {"auto", "cuda"}:
        return requested_device

    checker = cuda_is_available or _torch_cuda_is_available
    return "cuda" if checker() else "cpu"


def _torch_cuda_is_available() -> bool:
    try:
        import torch
    except ImportError:
        return False
    return bool(torch.cuda.is_available())


def _extract_text(result: object) -> str:
    if isinstance(result, str):
        return result.strip()
    if isinstance(result, dict):
        return str(result.get("text", "")).strip()
    if isinstance(result, list):
        return " ".join(_extract_text(item) for item in result).strip()
    return ""


def _pcm16le_to_float32(pcm: bytes) -> np.ndarray:
    if not pcm:
        return np.array([], dtype=np.float32)
    samples = np.frombuffer(pcm, dtype="<i2")
    return (samples.astype(np.float32) / 32768.0).copy()
