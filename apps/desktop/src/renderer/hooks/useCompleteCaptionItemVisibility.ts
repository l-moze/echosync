import { useLayoutEffect, useState } from "react";

export function useCompleteCaptionItemVisibility(
  containerRef: { current: HTMLDivElement | null },
  itemSelector: string,
  layoutKey: string
) {
  const [hiddenItemKeys, setHiddenItemKeys] = useState<ReadonlySet<string>>(() => new Set());

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) {
      setHiddenItemKeys(new Set());
      return;
    }

    let frame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const edgeTolerancePx = 1;

    function measure() {
      frame = null;
      const container = containerRef.current;
      if (!container) {
        setHiddenItemKeys(new Set());
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const nextHiddenKeys = new Set<string>();
      const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
      for (const item of items) {
        const key = item.dataset.captionItemKey;
        if (!key) {
          continue;
        }

        const itemRect = item.getBoundingClientRect();
        const itemFitsInViewport = itemRect.height <= containerRect.height + edgeTolerancePx;
        const isFullyVisible =
          itemRect.top >= containerRect.top - edgeTolerancePx &&
          itemRect.bottom <= containerRect.bottom + edgeTolerancePx;
        if (itemFitsInViewport && !isFullyVisible) {
          nextHiddenKeys.add(key);
        }
      }

      setHiddenItemKeys((current) => (setsEqual(current, nextHiddenKeys) ? current : nextHiddenKeys));
    }

    function scheduleMeasure() {
      if (frame !== null) {
        return;
      }
      frame = window.requestAnimationFrame(measure);
    }

    scheduleMeasure();
    element.addEventListener("scroll", scheduleMeasure, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleMeasure);
      resizeObserver.observe(element);
      for (const item of element.querySelectorAll<HTMLElement>(itemSelector)) {
        resizeObserver.observe(item);
      }
    }

    return () => {
      element.removeEventListener("scroll", scheduleMeasure);
      resizeObserver?.disconnect();
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [containerRef, itemSelector, layoutKey]);

  return hiddenItemKeys;
}

function setsEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>) {
  if (left.size !== right.size) {
    return false;
  }
  for (const item of left) {
    if (!right.has(item)) {
      return false;
    }
  }
  return true;
}
