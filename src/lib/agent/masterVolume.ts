'use client';

import { useSyncExternalStore } from 'react';

/**
 * The master volume (top bar, beside the zone buttons): one level, 0–1, over everything the app plays —
 * the agent's voice, the background music and the timeline's sounds. Each Web Audio graph ends in a
 * master gain node (masterOutput) instead of going straight to the speakers; Record conversation listens
 * before it, so a recording isn't turned down with the room. Remembered in this browser.
 */

const KEY = 'gallery-guide-master-volume';
let level = 1;
try {
  const stored = Number(window.localStorage.getItem(KEY));
  if (window.localStorage.getItem(KEY) !== null && Number.isFinite(stored)) level = Math.max(0, Math.min(1, stored));
} catch {
  // No storage (private window, or on the server): full volume.
}

const listeners = new Set<() => void>();
const gains = new Map<BaseAudioContext, GainNode>();
/** Sound: Off (the top bar's button): everything silent, whatever the level, until it's turned back on. Not remembered. */
let off = false;
const output = () => (off ? 0 : level);
const apply = () => {
  for (const [ctx, g] of gains) g.gain.setTargetAtTime(output(), ctx.currentTime, 0.02);
  for (const l of listeners) l();
};

export const masterVolume = () => level;
/** What reaches the speakers now: the level, or 0 while Sound is off. */
export const masterLevel = () => output();
/** Hears each change of the level or Sound on/off. */
export function onMasterChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const soundOff = () => off;

export function setSoundOff(value: boolean) {
  off = value;
  apply();
}

export function setMasterVolume(value: number) {
  level = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  try {
    window.localStorage.setItem(KEY, String(level));
  } catch {
    // Not remembered.
  }
  apply();
}

/** Where a graph in `ctx` connects instead of ctx.destination: one master gain per audio context. */
export function masterOutput(ctx: AudioContext): AudioNode {
  let g = gains.get(ctx);
  if (!g) {
    g = ctx.createGain();
    g.channelCountMode = 'max';
    g.channelInterpretation = 'discrete';
    g.gain.value = output();
    g.connect(ctx.destination);
    gains.set(ctx, g);
  }
  return g;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const useMasterVolume = () => useSyncExternalStore(subscribe, () => level, () => 1);
export const useSoundOff = () => useSyncExternalStore(subscribe, () => off, () => false);
