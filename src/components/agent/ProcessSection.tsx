'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';

/**
 * A titled group in the Design Process column — e.g. "Chatbot Generation
 * Process" — holding its own steps (CollapsiblePanels) or sub-groups. More
 * can be added side by side; each folds up on its own, and remembers whether
 * it was left open (open the first time).
 */
export function ProcessSection({ title, tourId, children }: { title: string; tourId?: string; children: ReactNode }) {
  const key = `process-open:${title}`;
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only: localStorage doesn't exist during SSR
      if (window.localStorage.getItem(key) === 'false') setOpen(false);
    } catch {
      // Storage blocked: it starts open.
    }
  }, [key]);
  const toggle = () =>
    setOpen((o) => {
      try {
        window.localStorage.setItem(key, String(!o));
      } catch {
        // As above.
      }
      return !o;
    });
  return (
    <section className="border-t-2 border-ink" data-tour={tourId}>
      <button
        onClick={toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-2 py-3 text-left hover:bg-muted/40"
      >
        <span className={`inline-block w-3 shrink-0 text-xs text-ink transition-transform duration-200 ${open ? 'rotate-90' : ''}`} aria-hidden="true">
          ▶
        </span>
        <span className="font-display text-base leading-tight text-ink">{title}</span>
      </button>
      {/* Grid rows 0fr → 1fr animates to the content's own height. */}
      <div
        id={bodyId}
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pb-2 pl-3">{children}</div>
        </div>
      </div>
    </section>
  );
}
