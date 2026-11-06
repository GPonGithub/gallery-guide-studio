'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { fieldLabel } from '@/lib/styles';

/**
 * A section that folds away to just its title — collapsed by default, so the
 * column stays short. Click the heading (or its arrow) to open or close it;
 * each one opens and closes on its own. The content stays mounted while
 * folded, so anything typed in it, or a job in progress, isn't lost.
 */
export function CollapsiblePanel({
  title,
  defaultOpen = false,
  tourId,
  onOpenChange,
  openRequest,
  children,
}: {
  /** Opens it (and scrolls it into view) whenever this number changes — something elsewhere asked for it. */
  openRequest?: number;
  title: string;
  defaultOpen?: boolean;
  /** Marks it for the onboarding tour (see OnboardingTour). */
  tourId?: string;
  /** Hears each open or close (from a click on its heading). */
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const section = useRef<HTMLElement>(null);
  const seen = useRef(openRequest);
  useEffect(() => {
    if (openRequest === seen.current) return;
    seen.current = openRequest;
    setOpen(true);
    onOpenChange?.(true);
    // After it has begun to open, so the whole of it comes into view.
    const t = setTimeout(() => section.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);
  return (
    <section ref={section} className="border-b border-hair" data-tour={tourId}>
      <button
        onClick={() => {
          setOpen(!open);
          onOpenChange?.(!open);
        }}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-2 py-2.5 text-left hover:bg-muted/40"
      >
        <span
          className={`inline-block w-3 shrink-0 text-[10px] text-ink transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        >
          ▶
        </span>
        <span className={fieldLabel}>{title}</span>
      </button>
      {/* Grid rows 0fr → 1fr animates to the content's own height, whatever it is. */}
      <div
        id={bodyId}
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-2 pb-3 pl-5">{children}</div>
        </div>
      </div>
    </section>
  );
}
