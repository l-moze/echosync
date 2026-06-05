from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol, runtime_checkable

from echosync_agent.domain import CorrectionContext, TranscriptSegment, TranslationSegment


class Translator(Protocol):
    """文本翻译边界。

    `translate()` 是所有翻译器必须实现的最小能力，适合 DeepL 这类批量或
    请求/响应式供应商。实时低延迟供应商可额外实现 `StreamingTranslator`。
    """

    async def translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> TranslationSegment:
        raise NotImplementedError


@runtime_checkable
class StreamingTranslator(Translator, Protocol):
    """可选的流式翻译能力。

    DeepSeek / OpenAI-compatible 这类支持 token stream 的供应商实现它；
    DeepL 或录播批量翻译器不需要实现，级联引擎会自动回退到 `translate()`。
    """

    def stream_translate(
        self,
        segment: TranscriptSegment,
        context: CorrectionContext,
    ) -> AsyncIterator[TranslationSegment]:
        raise NotImplementedError
