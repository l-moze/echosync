export type DesktopWindowPreset = {
  title: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  show: boolean;
  frame: boolean;
  transparent: boolean;
  alwaysOnTop: boolean;
  skipTaskbar: boolean;
  resizable: boolean;
  hasShadow: boolean;
  backgroundColor: string;
};

export const CONTROL_WINDOW_PRESET: DesktopWindowPreset = {
  title: "EchoSync 控制台",
  width: 1280,
  height: 720,
  minWidth: 1040,
  minHeight: 640,
  show: true,
  frame: false,
  transparent: false,
  alwaysOnTop: false,
  skipTaskbar: false,
  resizable: true,
  hasShadow: true,
  backgroundColor: "#f7faff"
};

export const OVERLAY_WINDOW_PRESET: DesktopWindowPreset = {
  title: "EchoSync 悬浮字幕",
  width: 1120,
  height: 142,
  minWidth: 640,
  minHeight: 88,
  show: false,
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  hasShadow: false,
  backgroundColor: "#00000000"
};
