export function scrollTranscriptToBottom(element: HTMLElement | null, behavior: ScrollBehavior = "auto") {
  if (!element) {
    return;
  }
  element.scrollTo({ behavior, top: element.scrollHeight });
}

export function scrollCaptionRailToStableEdge(
  element: HTMLElement | null,
  itemSelector: string,
  behavior: ScrollBehavior = "auto"
) {
  if (!element) {
    return;
  }

  const items = Array.from(element.querySelectorAll<HTMLElement>(itemSelector));
  const lastItem = items.at(-1);
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  const paddingBottom = Number.parseFloat(window.getComputedStyle(element).paddingBottom) || 0;
  const targetTop = lastItem
    ? Math.min(
        maxScrollTop,
        Math.max(0, lastItem.offsetTop + lastItem.offsetHeight + paddingBottom - element.clientHeight)
      )
    : maxScrollTop;
  element.scrollTo({ behavior, top: targetTop });
}

export function seekAudioElement(audio: HTMLAudioElement, nextMs: number) {
  const nextSeconds = nextMs / 1000;
  if (!Number.isFinite(nextSeconds)) {
    return false;
  }
  try {
    const boundedSeconds = Math.max(0, nextSeconds);
    if (typeof audio.fastSeek === "function") {
      audio.fastSeek(boundedSeconds);
    } else {
      audio.currentTime = boundedSeconds;
    }
    return true;
  } catch {
    return false;
  }
}
