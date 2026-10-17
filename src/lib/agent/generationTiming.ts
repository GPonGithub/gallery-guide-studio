'use client';

/**
 * How long designing a conversation takes, as this browser has seen it — for
 * the progress line on Generate New Conversation / Update This Scene. One
 * request to Claude does all the work and reports nothing until it's done,
 * so the line is an estimate: the typical time of recent generations,
 * adjusted for how long the description is (longer ones take longer).
 */

const KEY = 'generation-durations';
const KEEP = 8;
/** Before this browser has timed any: about a minute. */
const DEFAULT_MS = 60_000;

/** 'design' = a whole new design; 'revise' = only what changed (much quicker). Timed separately. */
export type GenerationMode = 'design' | 'revise';
type Sample = { ms: number; chars: number; mode?: GenerationMode };
/** Before this browser has timed a quick revision: about 20 seconds. */
const DEFAULT_REVISE_MS = 20_000;

function read(): Sample[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as Sample[];
    return Array.isArray(raw) ? raw.filter((s) => s.ms > 0 && s.chars > 0) : [];
  } catch {
    return [];
  }
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The expected time (ms) to design a conversation from a description this long. */
export function estimateGeneration(chars: number, mode: GenerationMode = 'design'): number {
  const samples = read().filter((s) => (s.mode ?? 'design') === mode);
  if (samples.length === 0) return mode === 'revise' ? DEFAULT_REVISE_MS : DEFAULT_MS;
  const typical = median(samples.map((s) => s.ms));
  const typicalChars = median(samples.map((s) => s.chars));
  // Longer descriptions take longer — but not in proportion (most of the time is the design itself).
  const scale = Math.min(1.5, Math.max(0.75, Math.sqrt(Math.max(chars, 1) / Math.max(typicalChars, 1))));
  return typical * scale;
}

/** Remembers how long a generation took, to sharpen the next estimate. */
export function recordGeneration(ms: number, chars: number, mode: GenerationMode = 'design') {
  if (ms <= 0) return;
  try {
    // The last few of each kind.
    const all = [...read(), { ms, chars: Math.max(chars, 1), mode }];
    const samples = [...all.filter((s) => (s.mode ?? 'design') === 'design').slice(-KEEP), ...all.filter((s) => s.mode === 'revise').slice(-KEEP)];
    window.localStorage.setItem(KEY, JSON.stringify(samples));
  } catch {
    // Storage blocked: the estimate stays at the default.
  }
}

/**
 * How full the line should be after `elapsed` of an `expected` wait: steadily
 * to 90% by the expected time, then creeping towards (never reaching) 98% —
 * it never claims to be done before it is.
 */
export function progressAt(elapsed: number, expected: number): number {
  if (elapsed <= expected) return 0.9 * (elapsed / expected);
  return 0.9 + 0.08 * (1 - Math.exp(-(elapsed - expected) / expected));
}
