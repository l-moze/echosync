你说得对，我刚才给了太多架构设计，容易把执行 AI 带偏。下面这版只做**FunASR 接入方式分析与约束建议**，可以直接贴给 AI。

---

# FunASR 接入方式建议文档

## 结论

当前项目更建议使用 **Python + FastAPI 后端封装 FunASR**，而不是让前端 / Node / Next 直接处理 ASR。

但这里的重点不是重新设计架构，而是明确 FunASR 的接入边界：

```text
推荐：Python 后端中 import FunASR，并通过 HTTP / WebSocket 暴露给现有前端或桌面端调用
不推荐：在前端、Next.js Route、Node 服务中直接承载 FunASR 模型逻辑
```

## 判断依据

FunASR 官方教程的核心使用方式是 Python API。快速体验、离线识别、流式识别、VAD、标点、说话人分离等示例都基于：

```python
from funasr import AutoModel
```

官方快速体验示例也是通过 `pip install funasr` 后直接创建 `AutoModel`，并调用 `model.generate()` 完成识别。([modelscope.github.io][1])

因此，FunASR 的一等公民是 Python，而不是 Node.js 或前端运行时。

## 对当前项目的建议

### 1. 开发阶段

建议在 Python 后端中直接导入 FunASR：

```python
from funasr import AutoModel
```

这样可以最快验证模型效果、延迟、显存占用、实时识别质量。

中文实时字幕场景优先参考官方推荐的：

```text
paraformer-zh-streaming
```

官方教程明确把“实时字幕”推荐给 `paraformer-zh-streaming`，并说明每 600ms 送入一段音频。([modelscope.github.io][1])

### 2. 实时识别注意点

如果做实时语音 / 同传 / 字幕，不要按普通文件上传方式处理。

FunASR 流式识别需要逐块输入音频，并且必须维护 `cache`：

```python
cache = {}
res = model.generate(
    input=chunk,
    cache=cache,
    is_final=is_final,
    chunk_size=[0, 10, 5]
)
```

官方教程强调：`cache={}` 必须在所有 chunk 间保持，最后一个 chunk 需要设置 `is_final=True`，否则可能丢失尾部缓存文本。([modelscope.github.io][1])

所以后端需要负责维护每个会话的流式状态，而不是把这部分逻辑交给前端。

### 3. FastAPI 的定位

FastAPI 在这里的作用是**封装 FunASR 能力**，不是重新设计系统架构。

它只需要承担：

```text
接收音频
维护流式 cache
调用 FunASR
返回识别文本
```

不要让 AI 扩展成复杂微服务、Agent 平台、全新后端架构。

### 4. 是否使用 funasr-server

FunASR 官方也提供了部署方式：

```bash
pip install funasr fastapi uvicorn python-multipart
funasr-server --device cuda --port 8000
```

该方式用于提供 OpenAI 兼容的本地转写接口，适合应用或 Agent 调用。([modelscope.github.io][1])

但当前阶段不必强行切到 `funasr-server`。更建议先用 FastAPI 直接封装 `AutoModel`，因为这样更容易控制实时流、状态缓存、音频格式和后续翻译链路。

## 明确禁止 AI 跑偏

执行时不要做以下事情：

```text
不要重构整个前端技术栈
不要因为 FunASR 引入新的复杂微服务架构
不要把 Next.js / React / Vite 的选择和 FunASR 接入绑定
不要把桌面端架构一起设计出来
不要在 Node.js 中强行运行 FunASR
不要把实时识别当成普通文件上传接口处理
```

## 推荐实施边界

只做 FunASR 后端接入层：

```text
Python FastAPI
- 加载 AutoModel
- 提供离线转写接口
- 提供实时 WebSocket 接口
- 维护流式 cache
- 返回 partial / final 文本
```

模型选择建议：

```text
实时中文字幕：paraformer-zh-streaming
普通中文音频转写：paraformer-zh + fsmn-vad + ct-punc
会议录音且需要说话人：paraformer-zh + fsmn-vad + ct-punc + cam++
需要情感 / 音频事件：SenseVoice
```

这些模型选择均来自 FunASR 官方教程的推荐说明。([modelscope.github.io][1])

## 最终建议

当前应采用：

```text
Python + FastAPI 封装 FunASR
```

而不是：

```text
前端直接处理 ASR
Node.js 直接承载 FunASR
为了 ASR 重写整体架构
```

这不是架构重构建议，只是 FunASR 接入方式建议。FunASR 本身是 Python 生态，官方教程也主要围绕 Python `AutoModel` 展开，因此用 Python 后端承载 ASR 是更稳妥的选择。

[1]: https://modelscope.github.io/FunASR/zh/tutorial.html "FunASR 使用教程"

---

# 当前接入进展

## 已完成

当前已经在 `apps/agent` 接入 **FunASR 本地 AutoModel**，不是前端或 Node 直连模型。

当前 ASR provider 包括：

```text
mock    # 事件链路和测试用，只适合文本帧演示
funasr  # 本地 AutoModel，优先用于 Windows 本地真实音频
voxtral # Mistral Voxtral Realtime，云端多语言实时 ASR 备选
```

实现文件：

```text
apps/agent/src/echosync_agent/services/asr/funasr_transcriber.py
apps/agent/src/echosync_agent/services/media/ffmpeg_audio_source.py
apps/agent/src/echosync_agent/asr_demo.py
```

已落实的边界：

- `MediaAudioSource`：只负责把视频/音频通过 ffmpeg 抽成 `16kHz / mono / PCM16LE`，再按 `600ms` 切成 `AudioFrame`。
- `FunAsrTranscriber`：只负责 FunASR `AutoModel.generate()`、流式 `cache`、`is_final`、`chunk_size` 和 look-back 参数。
- `RealtimeInterpretationPipeline`：仍只依赖 `Transcriber` 抽象，不知道 FunASR 细节。

已补充的实时边界：

- `AudioFrame.is_final`：音频源负责标记会话最后一帧，ASR 适配器不再通过“多缓存一帧”猜测结尾。
- `FunAsrTranscriber`：接收低延迟 `AudioFrame`，但在适配器内部按会话延迟模式聚合为 provider 友好的推理窗口；`low_latency` 约 320ms，`balanced` 默认 600ms，`accuracy` 约 900ms。这样避免 80ms 传输帧直接变成 80ms 模型调用。
- 真实 FunASR 流式模型仍可能在第一个或前几个 chunk 不返回文本，这是模型上下文和 look-back 带来的首字延迟，不等同于代码缓冲延迟。

## 终端验证命令

先验证媒体抽取和切片：

```powershell
cd apps/agent
$env:PYTHONPATH='src'
python -m echosync_agent.asr_demo .tmp/asr-smoke.mp4 --provider mock --chunk-ms 600 --source-lang zh
```

真实 FunASR 识别：

```powershell
cd apps/agent
$env:PYTHONPATH='src'
python -m echosync_agent.asr_demo .tmp/asr-zh-speech.mp4 --provider funasr --chunk-ms 600 --source-lang zh --device auto
```

当前 CPU 实测样本中，单个 `600ms` chunk 的 ASR 推理耗时约 `250-380ms`，`asr_rtf` 约 `0.46-0.62`。`e2e_rtf` 包含模型加载和媒体解码，不适合作为最终首字幕延迟指标；后续需要先预热模型，再测首字延迟、稳定片段延迟和补丁率。

## 环境依赖

先阅读并执行 `doc/agent-env.md`。所有 ASR 依赖必须安装到项目内 `.venv`，不要安装到全局 Python。

FunASR 真实模型依赖：

```powershell
python -m pip install imageio-ffmpeg edge-tts
python -m pip install "funasr>=1.2" "modelscope>=1.19"
```

GPU 版本优先安装 CUDA 版 PyTorch 和 torchaudio，例如：

```powershell
python -m pip install --index-url https://download.pytorch.org/whl/cu128 "torch==2.9.1+cu128" "torchaudio==2.9.1+cu128"
```

如果 CUDA 轮子下载失败或机器没有 NVIDIA GPU，可使用 CPU 版兜底：

```powershell
python -m pip install "torch==2.9.1" "torchaudio==2.9.1"
```

说明：

- `FUNASR_DEVICE=auto` 会优先使用 CUDA；检测不到可用 GPU 或当前安装的是 CPU 版 `torch` 时回退 CPU。
- 真正启用 GPU 需要安装与 CUDA 匹配的 `torch` / `torchaudio` 版本；`torchaudio` 版本必须与 `torch` 版本一致，否则 Windows 下会加载 `_torchaudio.pyd` 失败。
- 本机有 RTX 3060 Ti，但当前官方 CUDA 轮子下载出现 hash mismatch，说明下载链路拿到的超大 whl 不完整或被污染；代码已保留 GPU 优先策略，环境安装成功后会自动切到 `cuda`。
- `imageio-ffmpeg` 用于提供 ffmpeg 二进制，避免要求系统 PATH 里提前安装 ffmpeg。
- 首次加载 `paraformer-zh-streaming` 会从 ModelScope 下载约 `840MB` 模型，后续走本地缓存。
- 当前命令行工具已禁用 FunASR 进度条和更新检查，避免 Windows PowerShell 管道截断时触发 `tqdm` 输出错误。

## 下一步

当前桌面端已经能把 Windows 系统声音转为 `16kHz / mono / PCM16`，通过 `8766` 的 `/v1/realtime/sessions/{session_id}` 推给完整 ASR -> 翻译 -> 字幕管道。下一步重点不是再新建音频入口，而是把真实识别和延迟指标跑实：

```text
1. 每个会话维护独立 FunASR cache。
2. 使用 funasr 或 voxtral 跑真实 PCM 音频，验证首字延迟、chunk 延迟、RTF、空片段比例。
3. 把麦克风源从 getDisplayMedia 分支改成 getUserMedia({ audio: true })。
4. 将 renderer 中的 ScriptProcessorNode 迁移到 AudioWorklet，降低长期运行抖动。
```

## 最小 ASR WebSocket 服务

已新增：

```text
apps/agent/src/echosync_agent/transport/asr_websocket.py
```

启动命令：

```powershell
cd apps/agent
$env:PYTHONPATH='src'
$env:ECHOSYNC_ASR_PROVIDER='funasr'
$env:FUNASR_DEVICE='auto'
python -m echosync_agent.transport.asr_websocket
```

如果已安装为包，也可以使用：

```powershell
echosync-asr-server
```

服务地址：

```text
ws://127.0.0.1:8765/v1/asr/sessions/{session_id}
```

注意：

```text
8765 是纯 ASR 调试服务，只返回 asr.segment。
8766 是桌面端真实同传链路，输入 /v1/realtime/sessions/{session_id}，输出 /v1/caption/events。
桌面端应优先连接 8766，而不是 8765。
```

端口配置：

```text
ECHOSYNC_ASR_SERVER_PORT=8765
```

消息协议：

```json
{"type":"asr.start","source_lang":"zh","sample_rate":16000,"channels":1,"source_kind":"file","device_id":"lecture.mp4"}
{"type":"audio.chunk","seq":1,"start_ms":0,"end_ms":600,"pcm_base64":"...","is_final":false}
{"type":"audio.chunk","seq":2,"start_ms":600,"end_ms":1200,"pcm_base64":"...","is_final":true}
```

返回协议：

```json
{"type":"asr.segment","session_id":"sess_1","segment_id":"seg_xxx","rev":1,"start_ms":0,"end_ms":600,"source_lang":"zh","text":"今天我们","status":"partial","stability":0.72,"speaker":null,"metrics":{"asr_latency_ms":91,"asr_rtf":0.15}}
{"type":"asr.done","session_id":"sess_1"}
```

设计边界：

- WebSocket 层只做协议转换、会话队列和 `AudioFrame` 生成。
- FunASR 模型仍在 `FunAsrTranscriber` 中加载，cache 由每个 `stream()` 调用独立维护。
- 翻译、修正、TTS 不进入 ASR 服务；后续可以在 Agent 管道层消费 `asr.segment`。
