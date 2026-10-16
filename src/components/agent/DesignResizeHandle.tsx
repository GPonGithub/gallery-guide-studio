'use client';

import { useRef } from 'react';

// The border between the Design Process column and the chat: drag it to
// widen or narrow the column (wide screens only — on narrow ones the columns
// stack). Double-click puts it back to the standard width; with the handle
// focused, ← and → move it too. The width is remembered in this browser.

export const DESIGN_WIDTH = { min: 300, standard: 400, max: 900 } as const;
const STORAGE_KEY = 'goal-agent-design-width';
const KEY_STEP = 20;

/** Within the limits — and never so wide the chat column is squeezed out. */
export function clampDesignWidth(width: number): number {
  const roomForChat = typeof window === 'undefined' ? Infinity : window.innerWidth - 480;
  return Math.round(Math.max(DESIGN_WIDTH.min, Math.min(width, DESIGN_WIDTH.max, roomForChat)));
}

export function loadDesignWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    return stored ? clampDesignWidth(stored) : DESIGN_WIDTH.standard;
  } catch {
    return DESIGN_WIDTH.standard;
  }
}

export function saveDesignWidth(width: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // Storage blocked — the width just won't be remembered.
  }
}

export function DesignResizeHandle({
  width,
  onResize,
  onReset,
}: {
  width: number;
  onResize: (width: number) => void;
  onReset: () => void;
}) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const stopDrag = () => {
    drag.current = null;
    document.body.style.removeProperty('user-select');
    document.body.style.removeProperty('cursor');
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the Design Process column"
      data-tour="resize-border"
      aria-valuemin={DESIGN_WIDTH.min}
      aria-valuemax={DESIGN_WIDTH.max}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click for the standard width"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Not a real pointer (the onboarding tour's demonstration) — following still works on the handle.
        }
        drag.current = { startX: e.clientX, startWidth: width };
        // No text gets selected, and the cursor stays put, while dragging over the page.
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
      }}
      onPointerMove={(e) => {
        if (drag.current) onResize(drag.current.startWidth + e.clientX - drag.current.startX);
      }}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onLostPointerCapture={stopDrag}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          onResize(width + (e.key === 'ArrowRight' ? KEY_STEP : -KEY_STEP));
        } else if (e.key === 'Home' || e.key === 'Enter') {
          e.preventDefault();
          onReset();
        }
      }}
      // Sits over the column's 2px right border, a little wider so it's easy to grab.
      className="group absolute inset-y-0 -right-[6px] z-20 hidden w-[10px] cursor-col-resize justify-center outline-none lg:flex"
    >
      <span className="h-full w-[4px] bg-ink opacity-0 transition-opacity group-hover:opacity-40 group-focus-visible:opacity-60 group-active:opacity-60" />
    </div>
  );
}
