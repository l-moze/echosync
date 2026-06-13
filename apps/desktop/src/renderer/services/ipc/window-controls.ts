export async function minimizeDesktopWindow() {
  await window.echosyncDesktop?.minimize();
}

export async function toggleDesktopWindowMaximize() {
  await window.echosyncDesktop?.toggleMaximize();
}

export async function closeDesktopWindow() {
  await window.echosyncDesktop?.close();
}
