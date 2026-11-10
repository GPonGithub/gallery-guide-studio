'use client';

import { useSyncExternalStore } from 'react';
import { ZONES, type ZoneId } from './projectionLayout';

/**
 * Which zone's drawing is open (Zone 1 / 2 / 3 over the drawing), and which zones are folded open on
 * the timeline — remembered in this browser. Choosing a zone's drawing opens its rows on the timeline
 * too; the rows fold open and closed on their own.
 */

const ZONE_KEY = 'media-zone';
const OPEN_KEY = 'timeline-zones-open';
const isZone = (n: unknown): n is ZoneId => ZONES.some((z) => z.id === n);

let zone: ZoneId = 2;
let open: ZoneId[] = [2];
let loaded = false;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    const z = Number(window.localStorage.getItem(ZONE_KEY));
    if (isZone(z)) zone = z;
    const kept = JSON.parse(window.localStorage.getItem(OPEN_KEY) ?? 'null') as unknown;
    if (Array.isArray(kept)) open = kept.filter(isZone);
  } catch {
    // Storage blocked: zone 2, as before zones existed.
  }
}
function keep() {
  try {
    window.localStorage.setItem(ZONE_KEY, String(zone));
    window.localStorage.setItem(OPEN_KEY, JSON.stringify(open));
  } catch {
    // Not remembered.
  }
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  // After the first paint (the server drew zone 2), what this browser remembers.
  if (!loaded) {
    load();
    queueMicrotask(tell);
  }
  return () => {
    listeners.delete(l);
  };
};

/** The zone whose drawing is open. */
export const useZone = () =>
  useSyncExternalStore(
    subscribe,
    () => zone,
    () => 2 as ZoneId,
  );
export function setZone(next: ZoneId) {
  if (next === zone) return;
  zone = next;
  if (!open.includes(next)) open = [...open, next];
  keep();
  tell();
}

const SERVER_OPEN: ZoneId[] = [2];
/** The zones folded open on the timeline. */
export const useZonesOpen = () => useSyncExternalStore(subscribe, () => open, () => SERVER_OPEN);
export function toggleZoneOpen(id: ZoneId) {
  open = open.includes(id) ? open.filter((z) => z !== id) : [...open, id];
  keep();
  tell();
}
