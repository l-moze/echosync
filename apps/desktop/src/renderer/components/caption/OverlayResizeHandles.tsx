import type { PointerEvent as ReactPointerEvent } from "react";

import type { DesktopWindowBounds } from "../../../shared/desktop-api";
import { getOverlayBounds, resizeOverlay } from "../../services/ipc/overlay";

type OverlayResizeDirection = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

export function OverlayResizeHandles({
  onResizeEnd,
  onResizeStart
}: {
  onResizeEnd: () => void;
  onResizeStart: () => void;
}) {
  const directions: OverlayResizeDirection[] = ["n", "e", "s", "w", "ne", "nw", "se", "sw"];

  function startResize(direction: OverlayResizeDirection, event: ReactPointerEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    onResizeStart();
    const startX = event.screenX;
    const startY = event.screenY;
    let initialBounds: DesktopWindowBounds | null = null;
    let frame: number | null = null;
    let pendingBounds: Partial<DesktopWindowBounds> | null = null;
    let stopped = false;

    function scheduleResize(bounds: Partial<DesktopWindowBounds>) {
      pendingBounds = bounds;
      if (frame !== null) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const nextBounds = pendingBounds;
        pendingBounds = null;
        if (nextBounds) {
          void resizeOverlay(nextBounds);
        }
      });
    }

    function stopResize() {
      if (stopped) {
        return;
      }
      stopped = true;
      window.removeEventListener("pointermove", moveResize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      if (pendingBounds) {
        void resizeOverlay(pendingBounds);
        pendingBounds = null;
      }
      onResizeEnd();
    }

    function moveResize(moveEvent: PointerEvent) {
      if (!initialBounds) {
        return;
      }
      const dx = moveEvent.screenX - startX;
      const dy = moveEvent.screenY - startY;
      scheduleResize(resizeBoundsFromPointer(direction, initialBounds, dx, dy));
    }

    window.addEventListener("pointermove", moveResize);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", stopResize, { once: true });

    void getOverlayBounds().then((startBounds) => {
      if (!startBounds) {
        return;
      }
      initialBounds = startBounds;
    });
  }

  return (
    <div className="overlayResizeHandles" aria-hidden="true">
      {directions.map((direction) => (
        <span
          className={`resizeHandle resize-${direction}`}
          key={direction}
          onPointerDown={(event) => startResize(direction, event)}
        />
      ))}
    </div>
  );
}

function resizeBoundsFromPointer(
  direction: OverlayResizeDirection,
  bounds: DesktopWindowBounds,
  dx: number,
  dy: number
): Partial<DesktopWindowBounds> {
  const next: Partial<DesktopWindowBounds> = {};
  if (direction.includes("e")) {
    next.width = bounds.width + dx;
  }
  if (direction.includes("s")) {
    next.height = bounds.height + dy;
  }
  if (direction.includes("w")) {
    next.x = bounds.x + dx;
    next.width = bounds.width - dx;
  }
  if (direction.includes("n")) {
    next.y = bounds.y + dy;
    next.height = bounds.height - dy;
  }
  return next;
}
