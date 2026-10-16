'use client';

import { useEffect, useState } from 'react';

/**
 * Where the app is running, as far as the page needs to know (from
 * /api/hosting): a hosted copy doesn't send TouchDesigner cues, and its
 * FigJam plugin needs this browser's connection code (see figmaJobStore).
 */
export type Hosting = { hosted: boolean; figjamReady: boolean };

let asked: Promise<Hosting> | null = null;

export function useHosting(): Hosting | null {
  const [hosting, setHosting] = useState<Hosting | null>(null);
  useEffect(() => {
    asked ??= fetch('/api/hosting')
      .then((res) => res.json() as Promise<Hosting>)
      .catch(() => ({ hosted: false, figjamReady: true }));
    let live = true;
    void asked.then((h) => live && setHosting(h));
    return () => {
      live = false;
    };
  }, []);
  return hosting;
}

const CODE_KEY = 'figjam-connection-code';
// No 0/O, 1/I/L — it gets typed in by hand.
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * This browser's FigJam connection code, e.g. "K7QM-2XRB" — made the first
 * time it's needed and kept. On a hosted copy the plugin only takes jobs
 * with the code typed into it, so a class's jobs never cross.
 */
export function connectionCode(): string {
  try {
    const kept = window.localStorage.getItem(CODE_KEY);
    if (kept) return kept;
  } catch {
    // Storage blocked: a fresh code each visit, which still works for that visit.
  }
  const pick = crypto.getRandomValues(new Uint32Array(8));
  const raw = Array.from(pick, (n) => CODE_LETTERS[n % CODE_LETTERS.length]).join('');
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  try {
    window.localStorage.setItem(CODE_KEY, code);
  } catch {
    // As above.
  }
  return code;
}
