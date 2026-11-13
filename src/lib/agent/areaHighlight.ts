'use client';

import { useSyncExternalStore } from 'react';

/**
 * The projection area picked in the timeline (a blue bar, or an empty spot on an area's track): the
 * drawing above (MediaWorkspace) outlines and tints it. Null when none is.
 */
let area: number | null = null;
const listeners = new Set<() => void>();

export function setHighlightedArea(next: number | null) {
  if (next === area) return;
  area = next;
  for (const l of listeners) l();
}

export const useHighlightedArea = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => area,
    () => null,
  );
