export async function copyTextToClipboard(text: string) {
  await window.echosyncDesktop?.copyText(text);
}
