export type DesktopAudioSourceId = "microphone" | "windows-system" | "mixed" | "file";

export type DesktopAudioCaptureKind = "microphone" | "system" | "mixed" | "file";

export type DesktopAudioCaptureMethod =
  | "browser-microphone"
  | "electron-display-media-loopback"
  | "native-wasapi-mixed"
  | "file-decode";

export type DesktopAudioCapability = "mic" | "loopback" | "mix" | "replay";

export type DesktopAudioSource = {
  id: DesktopAudioSourceId;
  label: string;
  description: string;
  captureKind: DesktopAudioCaptureKind;
  captureMethod: DesktopAudioCaptureMethod;
  capabilities: DesktopAudioCapability[];
  sampleRate: 16000;
  channels: 1;
};

export const DESKTOP_AUDIO_SOURCES: DesktopAudioSource[] = [
  {
    id: "microphone",
    label: "麦克风",
    description: "采集当前默认麦克风，用于线下会议、课堂或耳机麦输入。",
    captureKind: "microphone",
    captureMethod: "browser-microphone",
    capabilities: ["mic"],
    sampleRate: 16000,
    channels: 1
  },
  {
    id: "windows-system",
    label: "Windows 系统声音",
    description: "采集电脑正在播放的直播、会议或网课声音。",
    captureKind: "system",
    captureMethod: "electron-display-media-loopback",
    capabilities: ["loopback"],
    sampleRate: 16000,
    channels: 1
  },
  {
    id: "mixed",
    label: "混音",
    description: "同时采集麦克风和系统声音，后续由原生 WASAPI 适配器稳定实现。",
    captureKind: "mixed",
    captureMethod: "native-wasapi-mixed",
    capabilities: ["mic", "loopback", "mix"],
    sampleRate: 16000,
    channels: 1
  },
  {
    id: "file",
    label: "文件回放",
    description: "读取本地音视频文件，适合录播课程和离线评估。",
    captureKind: "file",
    captureMethod: "file-decode",
    capabilities: ["replay"],
    sampleRate: 16000,
    channels: 1
  }
];
