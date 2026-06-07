# TTS 闭环安全闸与 Windows WASAPI 采集设计

## 背景

EchoSync 的 Windows 系统声音采集会把当前系统正在播放的声音作为输入送入同传链路。只要同一会话同时开启 TTS，应用自己播放的合成语音就可能被系统声音采集重新录入，再被 ASR、翻译和 TTS 继续处理，形成自激闭环。

这个问题不能只当作普通音频质量问题处理。闭环一旦触发，会持续生成重复字幕、重复翻译和重复语音，增加延迟、费用和用户困惑，并可能把 EchoSync 自己的输出误识别成远端会议内容。

## 问题分析

典型闭环路径如下：

```text
远端会议音频
  -> Windows 系统声音采集
  -> EchoSync ASR
  -> 翻译
  -> EchoSync TTS 播放
  -> 默认系统输出设备
  -> Windows 系统声音采集再次采到 EchoSync TTS
  -> EchoSync ASR 再次识别
  -> 翻译与 TTS 继续重复
```

闭环成立需要同时满足以下条件：

- 音频输入源选择了 Windows 系统声音，采集对象是系统混音或包含系统混音的桌面音频。
- TTS 处于非关闭状态，包括显式选择云端、本地或后端默认 TTS，而不是 `disabled`。
- TTS 播放输出进入了当前被 loopback 捕获的渲染端点。
- 当前采集实现没有排除 EchoSync 进程音频，也没有限制为只采集目标会议进程或目标窗口音频。

闭环的表现通常不是一次性回声，而是可累积的反馈：

- 字幕中出现 EchoSync 刚刚播报过的译文。
- TTS 重复朗读上一轮译文，随后又被采集并再次朗读。
- 翻译链路对合成语音继续翻译，导致内容逐轮偏移。
- 用户关闭会议或远端无人说话后，EchoSync 仍可能继续产出字幕和语音。

因此，当前阶段必须先做安全闸，再逐步引入设备隔离和 Windows 原生采集能力。

## 目标

- 阶段 0 立即阻断“Windows 系统声音 + TTS 非关闭”的危险组合。
- 前端启动前预检负责给用户即时反馈，Agent 负责最终兜底校验。
- 阶段 1 支持把 TTS 输出路由到不被采集的输出设备，降低误采集风险。
- 阶段 2 使用 Windows 原生 WASAPI loopback，支持排除 EchoSync 进程音频，或只采集目标进程、目标窗口音频。
- 明确 Electron `displayMedia` loopback 当前不足，避免误以为前端 display capture 可以解决进程级音频隔离。

## 非目标

- 不在本文设计中修改 ASR、翻译或 TTS 供应商协议。
- 不在阶段 0 实现音频回声消除、声音指纹过滤或文本去重兜底。
- 不把麦克风回声问题和系统声音 loopback 闭环合并处理；麦克风外放回采是另一个输入路径。
- 不承诺所有 Windows 版本都支持同等级别的进程级 loopback 能力；实现时必须做能力发现和降级。

## 阶段 0：安全闸

阶段 0 是强制规则：

```text
如果输入源是 Windows 系统声音，并且 TTS 不是关闭状态，则禁止启动实时会话。
```

这里的 TTS 非关闭包括：

- 用户显式选择任意 TTS provider。
- 用户选择 `server-default`，且 Agent 解析后的默认 TTS provider 不是 `disabled`。
- 历史配置、环境变量或后端默认值使会话最终会播放 TTS。

### 前端预检

Desktop renderer 在开始采集前执行预检，必须早于 `getDisplayMedia`、音频流创建和实时 WebSocket 启动。

预检规则：

- 当 `audio_source=windows-system` 且解析后的 `tts_provider` 不是 `disabled` 时，开始按钮禁用或启动动作被拦截。
- 提示文案必须说明原因：系统声音会采到 EchoSync 自己的 TTS，可能形成重复朗读闭环。
- 提供可执行选择：关闭 TTS、改用麦克风或等待后续输出设备隔离能力。
- 设置变更、会话恢复、capabilities 刷新后都要重新计算该规则。
- `server-default` 不能只按字面值判断，必须使用 Agent capabilities 中的默认 TTS 解析结果。

前端预检的目标是减少误操作和无效授权弹窗，但不能作为唯一防线。

### Agent 兜底

Agent 在 `audio.start` 或等价会话启动入口再次校验同一规则。任何 renderer、脚本客户端或未来集成入口都不能绕过该校验。

Agent 行为：

- 如果发现危险组合，拒绝启动会话，不初始化 ASR、翻译和 TTS 管道。
- 返回稳定错误码，例如 `preflight.loopback_tts_guard`，并附带中文原因。
- 如果前端已经创建连接，Agent 应立即返回启动失败事件并关闭本次会话资源。
- 记录一次被阻断的预检指标，但不写入音频内容。

Agent 需要以最终生效配置为准，而不是只看客户端传来的原始字段。尤其是 `server-default`、省略字段和后端 `.env` 默认值都必须先解析，再判断是否触发安全闸。

## 阶段 1：输出设备隔离

阶段 1 的目标是允许用户在受控条件下同时使用系统声音采集和 TTS，但前提是 TTS 输出不会进入被采集的系统声音端点。

推荐设计：

- Desktop 列出可用输出设备，并允许为 EchoSync TTS 单独选择输出设备。
- Windows 系统声音采集记录当前捕获的渲染端点。
- 预检比较“采集端点”和“TTS 输出端点”，只有两者不同且能力可确认时才允许组合使用。
- 如果无法确认端点关系，仍按阶段 0 规则阻断。
- TTS 输出设备变更必须在会话启动前确定；会话中切换需要重新预检。

阶段 1 可以支持以下安全组合：

- 采集桌面扬声器，TTS 输出到虚拟声卡或耳机设备，且该设备不被当前 loopback 捕获。
- 采集会议所在输出设备，TTS 输出到独立通信设备。

阶段 1 仍不能解决所有问题：

- 如果用户把多个设备通过系统混音、虚拟声卡或硬件混音重新汇总，仍可能回采。
- Electron 和浏览器层通常不能可靠判断 Windows 音频会话是否最终进入同一 loopback 流。
- 输出设备隔离是降低风险，不是进程级排除。

因此，阶段 1 放开安全闸时必须有明确条件；没有能力确认时继续阻断。

## 阶段 2：Windows 原生 WASAPI loopback

当前落地状态：`apps/wasapi-sidecar` 已实现最小 Windows 原生采集 sidecar，默认模式为 `exclude-process-tree`，由 Electron 主进程传入 EchoSync 主进程 `pid`，采集系统声但排除 EchoSync 进程树产生的音频。Desktop 音频源目录已把 Windows 系统声音标记为 `native-wasapi-process-loopback` 和 `exclude-self`，renderer 不再为系统声创建 WebAudio 采集 client；麦克风仍走原有浏览器采集路径。

sidecar 协议：

- stdout：`u32 little-endian payload_len + pcm16.binary.v1 payload`。payload 使用 Agent 现有二进制音频帧头，采样率 16k、单声道、PCM16、80ms 一帧。
- stderr：JSONL 诊断日志。`wasapi_sidecar_started` 记录采集模式和目标进程；`wasapi_capture_metrics` 每秒聚合采集回调、原始队列水位、重采样、PCM 编码和 stdout 写入耗时。
- `audio.start.device_id`：`wasapi:exclude-process-tree:<pid>`。Agent 兜底安全闸只在看到这种原生隔离 device id、未来 `include target process/window` 这类可证明不包含 EchoSync 的模式，或可确认输出设备隔离时，才允许 Windows 系统声音和 TTS 同时启用。

Electron 主进程不会把每一条 `wasapi_capture_metrics` 都按 `info` 输出到控制台：首条可见，正常指标每 10 秒摘要一次；超过 wakeup p95、stdout 写入 p95 或采集队列阈值时按 `warn` 输出并做 5 秒节流。这样保留定位延迟所需的采集层指标，又避免调试控制台被每秒 metrics 淹没。

阶段 2 使用 Windows 原生音频采集能力替代仅依赖 Electron `displayMedia` 的系统声音采集路径。目标是从“采整个系统混音”升级为“可声明采集范围”的 Windows 原生 loopback。

### 采集模式

阶段 2 至少支持三类模式：

- 系统 loopback：兼容当前系统声音采集语义，采集指定渲染端点的混音。
- 排除 EchoSync 进程：采集系统声音时排除 EchoSync 自身进程产生的音频，TTS 可以继续播放但不会进入 ASR。
- 目标进程或目标窗口：只采集会议软件、浏览器标签页宿主进程或用户选择窗口关联的音频。

推荐优先级：

1. 只采集目标进程或目标窗口音频。
2. 采集系统声音但排除 EchoSync 进程音频。
3. 采集完整系统声音，并继续套用阶段 0 安全闸。

### 能力发现

Agent 或 Desktop native 层需要暴露 Windows 采集能力：

- 是否支持 WASAPI loopback。
- 是否支持按进程包含或排除。
- 是否支持从目标窗口解析到目标进程。
- 当前 EchoSync 进程标识是否可被排除。
- 当前目标进程、目标窗口是否可用。

前端只根据能力结果开放选项，不做乐观假设。能力不足时必须降级到阶段 0 或阶段 1 的规则。

### 会话配置

会话启动时应显式传递采集意图：

```text
capture_scope=system
capture_scope=system_excluding_self
capture_scope=target_process
capture_scope=target_window
```

同时传递必要目标信息：

- 目标进程标识。
- 目标窗口标识。
- 渲染端点标识。
- 是否允许降级到完整系统声音。

默认不应静默降级到完整系统声音。若用户选择目标进程采集但原生能力不可用，应启动失败并提示重新选择，而不是自动进入可能闭环的系统混音。

### 与 TTS 的关系

在阶段 2 中，只有以下情况可以允许“Windows 系统声音 + TTS 非关闭”：

- 当前采集模式明确排除了 EchoSync 自身进程音频。
- 当前采集模式只包含目标进程或目标窗口，并且 EchoSync 不属于目标集合。
- 当前 TTS 输出设备已确认不在采集端点内。

如果采集模式退回完整系统 loopback，仍必须执行阶段 0 安全闸。

## Electron displayMedia loopback 当前不足

Electron renderer 通过 `getDisplayMedia` 或相关 display capture 能力拿到的系统音频，本质上更接近“屏幕或桌面捕获附带的音频”。它适合快速接入和演示系统声音采集，但不足以作为闭环治理的最终方案。

当前不足：

- 不能可靠声明“排除 EchoSync 进程音频”。
- 不能稳定表达“只采集这个会议进程”或“只采集这个窗口的音频”。
- 对 Windows 音频端点、音频会话和进程归属的可见性有限。
- 权限和设备选择由浏览器捕获模型主导，难以做到后端可验证的采集范围。
- 即使用户选择某个窗口，音频是否按窗口隔离也不能作为跨版本、跨应用的可靠保证。

因此，Electron displayMedia loopback 可以继续作为兼容路径，但安全策略必须保守：没有原生排除或端点隔离证明时，系统声音采集与 TTS 不能同时启用。

## 验收要求

- 前端在系统声音采集且 TTS 非关闭、且采集源不具备 `exclude-self` 或等价隔离能力时阻止启动，并显示中文原因。
- Agent 在同样组合下拒绝 `audio.start`，即使请求来自非前端客户端；`device_id=wasapi:exclude-process-tree:<pid>` 作为当前已落地的安全放行条件。
- `server-default` TTS 会被解析成最终 provider 后再参与判断。
- 阶段 1 只有在 TTS 输出端点和采集端点可确认隔离时才允许放开。
- 阶段 2 能通过能力发现区分完整系统 loopback、排除自身进程、目标进程和目标窗口采集。
- Electron displayMedia 路径不能标记为支持进程级排除，除非 native 层实际提供该能力。
- 所有用户可见提示、设计备注和文档说明均使用中文。

## 迁移顺序

1. 已落地阶段 0 前端预检和 Agent 兜底：无法证明隔离的系统声音采集与 TTS 非关闭组合会被阻断。
2. 已落地阶段 2 的最小默认模式：WASAPI `exclude-process-tree` 排除 EchoSync 主进程树，并通过 `device_id=wasapi:exclude-process-tree:<pid>` 让 Agent 可验证。
3. 下一步补充 capabilities 字段，准确表达 TTS 默认值、输出设备能力、Windows 采集能力和 sidecar 可用性。
4. 实现阶段 1 输出设备选择与端点隔离判断，作为 WASAPI 不可用时的安全替代路径。
5. 继续开放目标进程和目标窗口采集。完整系统 loopback 只作为兼容路径，并持续套用阶段 0 安全闸。

## 参考资料

- Electron `session.setDisplayMediaRequestHandler` 文档：`audio` 仅支持 `loopback`、`loopbackWithMute` 或 Electron `WebFrameMain` 音频，不提供外部进程级排除能力。
  https://www.electronjs.org/docs/latest/api/session
- Microsoft `PROCESS_LOOPBACK_MODE` 文档：Windows 原生进程 loopback 支持包含或排除目标进程树。
  https://learn.microsoft.com/en-us/windows/win32/api/audioclientactivationparams/ne-audioclientactivationparams-process_loopback_mode
- Microsoft Application Loopback Audio Sample：演示按进程树包含或排除的应用 loopback 音频采集。
  https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/
