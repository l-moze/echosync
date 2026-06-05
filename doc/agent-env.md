# Python Agent 环境隔离指南

## 结论

`apps/agent` 必须使用项目内 `.venv`，不要使用全局 Python 安装依赖。

原因：

- FunASR 依赖 `torch` / `torchaudio`，CPU 版和 CUDA 版不能混装。
- 全局 Python 会被不同项目污染，后续排查 ASR 延迟和 CUDA 问题会很困难。
- ModelScope 模型缓存体积较大，默认会散落到用户目录；项目内缓存更容易清理和迁移。

当前推荐目录：

```text
D:\code\echosync\.venv              # Python 包隔离环境
D:\code\echosync\.cache\pip         # pip 下载缓存
D:\code\echosync\.cache\modelscope  # ModelScope / FunASR 模型缓存
D:\code\echosync\.tmp\wheels        # 手动下载的 torch / torchaudio wheel
```

这些目录已加入 `.gitignore`，不能提交到仓库。

## 创建虚拟环境

```powershell
cd D:\code\echosync
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
```

代码要求是 Python `>=3.11`。本文 GPU wheel 示例使用 Python 3.12，因此 wheel 文件名是 `cp312`；如果你使用 Python 3.11，需要下载 `cp311` 对应的 `torch` / `torchaudio` wheel。

验证当前 Python 必须指向项目 `.venv`：

```powershell
python -c "import sys; print(sys.executable)"
```

正确输出应类似：

```text
D:\code\echosync\.venv\Scripts\python.exe
```

如果输出类似下面路径，说明仍在使用全局 Python，必须先停止：

```text
D:\Users\24787\AppData\Local\Programs\Python\Python312\python.exe
```

## 固定缓存位置

当前 PowerShell 会话中设置：

```powershell
$env:PIP_CACHE_DIR="D:\code\echosync\.cache\pip"
$env:MODELSCOPE_CACHE="D:\code\echosync\.cache\modelscope"
```

后续运行 ASR 服务或下载模型前，也建议保持这两个环境变量。

检查缓存位置：

```powershell
python -m pip cache dir
python -c "import os; print(os.getenv('MODELSCOPE_CACHE'))"
```

## 安装 Agent 基础依赖

```powershell
cd D:\code\echosync
.\.venv\Scripts\Activate.ps1

$env:PIP_CACHE_DIR="D:\code\echosync\.cache\pip"
$env:MODELSCOPE_CACHE="D:\code\echosync\.cache\modelscope"

python -m pip install --upgrade pip
python -m pip install -e .\apps\agent[funasr]
```

说明：

- `[funasr]` 只安装 FunASR 和 ModelScope。
- `torch` / `torchaudio` 需要按 GPU 或 CPU 环境单独安装，避免被 PyPI 默认 CPU 轮子覆盖。
- `pytest` 和 `ruff` 在 `pyproject.toml` 的 dev group 中，但普通 `pip install -e` 不会自动安装它们。

安装测试和代码检查依赖：

```powershell
python -m pip install pytest ruff
```

如需测试 Voxtral Realtime ASR：

```powershell
python -m pip install -e .\apps\agent[voxtral]
```

并在 `.env` 中配置：

```text
MISTRAL_API_KEY=
VOXTRAL_MODEL=voxtral-mini-transcribe-realtime-2602
VOXTRAL_TARGET_DELAY_MS=1000
```

## 安装 GPU 版 PyTorch

优先使用 CUDA 版 wheel。当前 RTX 3060 Ti 可使用 PyTorch 官方 CUDA 轮子。

手动下载目录：

```powershell
cd D:\code\echosync
New-Item -ItemType Directory -Force .tmp\wheels
```

下载 `cu128` 版：

```powershell
Start-BitsTransfer `
  -Source "https://download.pytorch.org/whl/cu128/torch-2.9.1%2Bcu128-cp312-cp312-win_amd64.whl" `
  -Destination ".tmp\wheels\torch-2.9.1+cu128-cp312-cp312-win_amd64.whl"

Start-BitsTransfer `
  -Source "https://download.pytorch.org/whl/cu128/torchaudio-2.9.1%2Bcu128-cp312-cp312-win_amd64.whl" `
  -Destination ".tmp\wheels\torchaudio-2.9.1+cu128-cp312-cp312-win_amd64.whl"
```

安装到 `.venv`：

```powershell
cd D:\code\echosync
.\.venv\Scripts\Activate.ps1

python -m pip uninstall -y torch torchaudio
python -m pip install --force-reinstall `
  ".tmp\wheels\torch-2.9.1+cu128-cp312-cp312-win_amd64.whl" `
  ".tmp\wheels\torchaudio-2.9.1+cu128-cp312-cp312-win_amd64.whl"
```

如果 `cu128` 下载失败，可改用 `cu126` 同版本 wheel，但 `torch` 和 `torchaudio` 必须保持同一个 CUDA 后缀和同一个版本。

## CPU 兜底

没有 NVIDIA GPU 或 CUDA wheel 下载失败时，可以安装 CPU 版：

```powershell
cd D:\code\echosync
.\.venv\Scripts\Activate.ps1

python -m pip uninstall -y torch torchaudio
python -m pip install "torch==2.9.1" "torchaudio==2.9.1"
```

项目代码默认 `FUNASR_DEVICE=auto`：

- CUDA 可用时使用 `cuda`。
- CUDA 不可用或当前安装 CPU 版 torch 时回退 `cpu`。
- 强制排查 CPU 路径时可以设置 `FUNASR_DEVICE=cpu`。

## 验证环境

检查 Python 隔离：

```powershell
python -c "import sys; print(sys.executable)"
```

检查 PyTorch：

```powershell
python -c "import torch, torchaudio; print('torch=', torch.__version__); print('torchaudio=', torchaudio.__version__); print('cuda=', torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU fallback')"
```

检查 EchoSync 设备选择：

```powershell
cd D:\code\echosync\apps\agent
$env:PYTHONPATH='src'
python -c "from echosync_agent.services.asr.funasr_transcriber import resolve_funasr_device; print(resolve_funasr_device('auto'))"
```

输出 `cuda` 表示 GPU 路径可用；输出 `cpu` 表示已自动回退 CPU。

## 运行测试

```powershell
cd D:\code\echosync
.\.venv\Scripts\Activate.ps1

$env:PIP_CACHE_DIR="D:\code\echosync\.cache\pip"
$env:MODELSCOPE_CACHE="D:\code\echosync\.cache\modelscope"

cd apps\agent
python -m pytest
```

## 运行 ASR 终端验证

```powershell
cd D:\code\echosync
.\.venv\Scripts\Activate.ps1

$env:PIP_CACHE_DIR="D:\code\echosync\.cache\pip"
$env:MODELSCOPE_CACHE="D:\code\echosync\.cache\modelscope"
$env:PYTHONPATH="src"
$env:FUNASR_DEVICE="auto"

cd apps\agent
python -m echosync_agent.asr_demo .tmp/asr-zh-speech.mp4 --provider funasr --chunk-ms 600 --source-lang zh --device auto
```

## 启动 ASR WebSocket 服务

```powershell
cd D:\code\echosync
.\.venv\Scripts\Activate.ps1

$env:PIP_CACHE_DIR="D:\code\echosync\.cache\pip"
$env:MODELSCOPE_CACHE="D:\code\echosync\.cache\modelscope"
$env:PYTHONPATH="src"
$env:ECHOSYNC_ASR_PROVIDER="funasr"
$env:FUNASR_DEVICE="auto"

cd apps\agent
python -m echosync_agent.transport.asr_websocket
```

服务地址：

```text
ws://127.0.0.1:8765/v1/asr/sessions/{session_id}
```

## 启动完整桌面同传服务

桌面端真实链路使用 `8766`，不是上面的纯 ASR 服务。

```powershell
cd D:\code\echosync
.\.venv\Scripts\Activate.ps1

$env:PIP_CACHE_DIR="D:\code\echosync\.cache\pip"
$env:MODELSCOPE_CACHE="D:\code\echosync\.cache\modelscope"
$env:PYTHONPATH="src"
$env:ECHOSYNC_ASR_PROVIDER="funasr"
$env:FUNASR_DEVICE="auto"
$env:ECHOSYNC_TRANSLATOR_PROVIDER="mock"

cd apps\agent
python -m echosync_agent.transport.caption_ws
```

服务地址：

```text
ws://127.0.0.1:8766/v1/realtime/sessions/{session_id}
ws://127.0.0.1:8766/v1/caption/events
```

如果要测试 DeepSeek 翻译，把 `ECHOSYNC_TRANSLATOR_PROVIDER` 改为 `deepseek`，并配置 `DEEPSEEK_API_KEY`。

## 给其他 Agent 的硬性约束

- 不要在全局 Python 里安装、卸载或升级 `torch`、`torchaudio`、`funasr`、`modelscope`。
- 不要把 CUDA 版和 CPU 版 PyTorch 混装在同一个环境里。
- 不要把 `.venv/`、`.cache/`、`.tmp/wheels/`、ModelScope 模型缓存提交到 Git。
- 运行任何 `apps/agent` 命令前，先确认 `python` 指向 `D:\code\echosync\.venv\Scripts\python.exe`。
