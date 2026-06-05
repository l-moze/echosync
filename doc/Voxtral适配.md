# Voxtral Realtime 接入建议

## 1. 接入定位

Voxtral Realtime 只建议承担一件事：**实时 ASR，把音频流转成增量文本**。

不要让它负责翻译、摘要、术语解释、字幕 UI 或音频采集架构。它在系统中的边界应该很清晰：

```text
音频流 bytes → Voxtral Realtime → 原文增量转写文本
```

后续翻译、字幕合并、术语处理，可以接在它的输出后面。

Mistral 官方文档明确把 Voxtral Realtime 定位为 live transcription 模型，适合 live captioning、voice assistant、real-time note-taking 等即时反馈场景；当前实时能力模型是 `voxtral-mini-transcribe-realtime-2602`。([Mistral AI Documentation][1])

---

## 2. 建议优先使用云端 API 做验证

第一阶段不要直接自部署 vLLM。先用 Mistral 官方 API 跑通实时转写链路，确认以下几件事：

```text
1. 音频采集格式是否正确
2. 是否能持续输出 text delta
3. 延迟是否满足同声字幕需求
4. 英语/中文/日语/韩语等样例是否稳定
5. ASR 输出是否适合后接翻译模型
```

官方 Python 接入方式是安装：

```bash
pip install "mistralai[realtime]"
```

官方示例使用 `client.audio.realtime.transcribe_stream(...)`，音频格式示例为 `pcm_s16le`、`16000Hz`，并监听 `TranscriptionStreamTextDelta` 这种增量文本事件。([Mistral AI Documentation][1])

最小接入代码可以保留成这样：

```python
import asyncio
from typing import AsyncIterator

from mistralai.client import Mistral
from mistralai.client.models import (
    AudioFormat,
    RealtimeTranscriptionSessionCreated,
    TranscriptionStreamTextDelta,
    TranscriptionStreamDone,
    RealtimeTranscriptionError,
)
from mistralai.extra.realtime import UnknownRealtimeEvent


MODEL = "voxtral-mini-transcribe-realtime-2602"


async def transcribe_voxtral_realtime(
    audio_stream: AsyncIterator[bytes],
    api_key: str,
):
    client = Mistral(api_key=api_key)

    audio_format = AudioFormat(
        encoding="pcm_s16le",
        sample_rate=16000,
    )

    async for event in client.audio.realtime.transcribe_stream(
        audio_stream=audio_stream,
        model=MODEL,
        audio_format=audio_format,
        target_streaming_delay_ms=1000,
    ):
        if isinstance(event, RealtimeTranscriptionSessionCreated):
            yield {"type": "session_started"}

        elif isinstance(event, TranscriptionStreamTextDelta):
            yield {
                "type": "text_delta",
                "text": event.text,
            }

        elif isinstance(event, TranscriptionStreamDone):
            yield {"type": "done"}

        elif isinstance(event, RealtimeTranscriptionError):
            yield {
                "type": "error",
                "message": str(event),
            }

        elif isinstance(event, UnknownRealtimeEvent):
            continue
```

这里的 `audio_stream` 不要绑定死麦克风，可以让它接收任何 `AsyncIterator[bytes]`，因为官方文档也说明 `audio_stream` 可以是任意 bytes iterable。([Mistral AI Documentation][1])

---

## 3. 音频格式建议

第一版统一转成：

```text
encoding: pcm_s16le
sample_rate: 16000
channel: mono
```

官方实时示例中麦克风输入就是 `pcm_s16le`，采样率是 `16000`。([Mistral AI Documentation][1])

对于你这个项目，前端或本地采集到的音频不要直接丢给模型，建议先在后端统一做格式转换：

```text
任意输入音频
→ mono
→ 16kHz
→ signed 16-bit little-endian PCM
→ async bytes stream
→ Voxtral Realtime
```

这不是架构设计，只是为了避免后续每个入口都处理一遍音频格式。

---

## 4. 延迟参数建议

Voxtral Realtime 支持 `target_streaming_delay_ms`。这个参数用于在开始转写前等待一定上下文，延迟越高通常准确率越好，延迟越低反馈越快。官方文档明确说明可以通过 `target_streaming_delay_ms` 设置目标延迟。([Mistral AI Documentation][1])

建议初始配置：

```text
普通字幕模式：target_streaming_delay_ms = 1000
低延迟模式：target_streaming_delay_ms = 480
极低延迟实验：target_streaming_delay_ms = 240
```

不要一开始追求 200ms 以下。对“AI 同声传译助手”来说，ASR 后面还要接翻译，如果 ASR 过早输出导致错误多，后面的翻译会被带偏。

官方还给了 dual delay 思路：快流低延迟，慢流高准确率。例如 fast stream 240ms，slow stream 2400ms，最后合并输出。这个可以作为后续增强，不建议 MVP 第一版就做。([Mistral AI Documentation][1])

---

## 5. 事件处理建议

只处理四类事件即可：

```text
RealtimeTranscriptionSessionCreated：会话建立
TranscriptionStreamTextDelta：增量文本
TranscriptionStreamDone：结束
RealtimeTranscriptionError：错误
```

不要让后续 AI 自己发明复杂协议。官方示例就是围绕这些事件处理。([Mistral AI Documentation][1])

对字幕系统来说，重点消费 `TranscriptionStreamTextDelta`：

```python
elif isinstance(event, TranscriptionStreamTextDelta):
    buffer += event.text
    yield event.text
```

后续翻译模块可以选择：

```text
每次 text delta 即时翻译：延迟低，但容易碎
按标点/停顿聚合后翻译：更稳，适合技术演讲
```

建议第一版采用“短缓冲聚合”，不要每个 token 都调用翻译模型。

---

## 6. 自部署建议：只作为第二阶段

如果后面要本地部署或私有化部署，再考虑 vLLM。

Voxtral Realtime 的 Hugging Face 模型名是：

```text
mistralai/Voxtral-Mini-4B-Realtime-2602
```

Mistral 模型卡明确推荐 vLLM，并说明该模型可以通过 vLLM 的 realtime endpoint 运行。模型权重是 BF16，4B 参数，单卡至少需要 16GB 显存。([Hugging Face][2])

自部署基础命令：

```bash
uv venv --python 3.12 --seed
source .venv/bin/activate

uv pip install -U vllm
uv pip install soxr librosa soundfile
uv pip install --upgrade transformers

python -c "import mistral_common; print(mistral_common.__version__)"
```

启动服务：

```bash
VLLM_DISABLE_COMPILE_CACHE=1 \
vllm serve mistralai/Voxtral-Mini-4B-Realtime-2602 \
  --compilation_config '{"cudagraph_mode": "PIECEWISE"}'
```

模型卡还提示，可以通过 `--max-num-batched-tokens` 平衡吞吐和延迟；默认 `--max-model-len` 很大，支持超过 3 小时上下文，如果只是实时字幕，可以适当降低来节省显存。([Hugging Face][2])

注意：vLLM 官方要求 GPU 部署环境主要是 Linux，Python 3.10–3.13；vLLM 不原生支持 Windows，Windows 上需要 WSL。([vLLM][3])

---

## 7. Windows 项目中的现实建议

你的项目如果是 Windows 桌面端，不要把 Voxtral vLLM 服务直接塞进 Electron 或普通 Windows Python 后端里。

更稳的方式是：

```text
Windows Electron / FastAPI 负责采集和转发音频
Voxtral Realtime 云端 API 或 Linux/WSL2 vLLM 服务负责 ASR
```

原因很简单：vLLM 的主线环境是 Linux，Windows 直接跑会增加很多无关问题。先把接入跑通，别让环境问题拖慢项目。

---

## 8. 和 FunASR 共存时的边界

如果后面系统同时保留 FunASR，不要让两者职责混乱。

建议边界：

```text
Voxtral Realtime：多语言实时 ASR，尤其英语技术分享、国际会议、网课直播
FunASR/SenseVoice：中文、中英混合、日韩、离线转写、VAD/标点/说话人等工程能力
Whisper：兜底和对比基线
```

Voxtral Realtime 不要替代整个语音处理链路，它只应该作为“实时多语言 ASR 引擎”接入。

---

## 9. 接入验收标准

接入 Voxtral Realtime 时，先验证这些，不要一上来做复杂功能：

```text
1. 能持续接收 PCM bytes 流
2. 能持续收到 text_delta
3. 英文技术演讲能连续输出
4. target_streaming_delay_ms = 1000 时字幕稳定
5. target_streaming_delay_ms = 480 时延迟可接受
6. 出错后能正常关闭 session
7. ASR 输出能被后续翻译模块消费
```

第一阶段只要做到这些，就算 Voxtral Realtime 接入成功。翻译质量、字幕样式、术语库、摘要都不要混进这个阶段。

[1]: https://docs.mistral.ai/studio-api/audio/speech_to_text/realtime_transcription "Realtime | Mistral Docs"
[2]: https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602 "mistralai/Voxtral-Mini-4B-Realtime-2602 · Hugging Face"
[3]: https://docs.vllm.ai/en/stable/getting_started/installation/gpu/?utm_source=chatgpt.com "GPU - vLLM Documentation"
