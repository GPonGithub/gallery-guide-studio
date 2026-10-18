'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * A titled group in the Design Process column — e.g. "Chatbot Generation
 * Process" — holding its own steps (CollapsiblePanels) or sub-groups. More
 * can be added side by side; each folds up on its own, and remembers whether
 * it was left open (`defaultOpen` the first time). `onOpenChange` hears
 * whether it's open — including the remembered state, once it's read.
 */
export function ProcessSection({
  title,
  tourId,
  defaultOpen = true,
  onOpenChange,
  action,
  children,
}: {
  title: string;
  tourId?: string;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Shown at the right-hand end of the heading (e.g. this section's Onboard Me). */
  action?: ReactNode;
  children: ReactNode;
}) {
  const key = `process-open:${title}`;
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only: localStorage doesn't exist during SSR
      if (stored === 'false' || stored === 'true') setOpen(stored === 'true');
    } catch {
      // Storage blocked: it starts as `defaultOpen`.
    }
  }, [key]);
  const heard = useRef(onOpenChange);
  useEffect(() => {
    heard.current = onOpenChange;
  });
  useEffect(() => {
    heard.current?.(open);
  }, [open]);
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
    <section className="relative border-t-2 border-ink" data-tour={tourId}>
      {/* The heading stays this section's first child, so the onboarding tour finds it (see toggleOf). */}
      <button
        onClick={toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className={`flex w-full items-center gap-2 py-3 text-left hover:bg-muted/40 ${action ? 'pr-32' : ''}`}
      >
        <span className={`inline-block w-3 shrink-0 text-xs text-ink transition-transform duration-200 ${open ? 'rotate-90' : ''}`} aria-hidden="true">
          ▶
        </span>
        <span className="font-display text-base leading-tight text-ink">{title}</span>
      </button>
      {action && <div className="absolute right-0 top-1.5">{action}</div>}
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
