'use client';

import { useEffect, useState } from 'react';
import { progressAt } from '@/lib/agent/generationTiming';

/**
 * A thin line along the bottom of a button, filling as an estimated wait goes
 * by (see generationTiming.ts). It's drawn in the button's own text colour,
 * so it shows on any button. The button needs `relative overflow-hidden`.
 */
export function ProgressLine({ startedAt, expectedMs, done = false }: { startedAt: number; expectedMs: number; done?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  // Finished: it fills to the end for a moment before it goes.
  const fraction = done ? 1 : progressAt(Math.max(0, now - startedAt), expectedMs);
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-0 left-0 h-[3px] bg-current opacity-80 transition-[width] duration-300 ease-linear"
      style={{ width: `${(fraction * 100).toFixed(1)}%` }}
    />
  );
}
