'use client';

import { useSyncExternalStore } from 'react';

/**
 * The master volume (top bar, beside the zone buttons): one level, 0–1, over everything the app plays —
 * the agent's voice, the background music and the timeline's sounds. Each Web Audio graph ends in a
 * master gain node (masterOutput) instead of going straight to the speakers; Record conversation listens
 * before it, so a recording isn't turned down with the room.
 *
 * Each scene keeps its own level (SCENES_KEY, by scene id); the page says which scene is open with
 * setVolumeScene. A scene that has never been given a level starts at the team's level from before
 * levels were kept per scene (KEY), or full volume. Like every setting, this is kept per team
 * (localStorage is split by team — see team.ts), so the three teams work the same way.
 */

const KEY = 'gallery-guide-master-volume';
const SCENES_KEY = 'gallery-guide-master-volume-scenes';
const clamp = (v: number) => Math.max(0, Math.min(1, v));

function readDefault(): number {
  try {
    const raw = window.localStorage.getItem(KEY);
    const stored = Number(raw);
    if (raw !== null && Number.isFinite(stored)) return clamp(stored);
  } catch {
    // No storage (private window, or on the server).
  }
  return 1;
}
function readScenes(): Record<string, number> {
  try {
    const all = JSON.parse(window.localStorage.getItem(SCENES_KEY) ?? '{}') as unknown;
    return all && typeof all === 'object' ? (all as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** The open scene ('unsaved' before one is saved). */
let scene = 'unsaved';
let level = readDefault();

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
  level = Number.isFinite(value) ? clamp(value) : 1;
  try {
    window.localStorage.setItem(SCENES_KEY, JSON.stringify({ ...readScenes(), [scene]: level }));
  } catch {
    // Not remembered.
  }
  apply();
}

/** The open scene changed: its own level comes back (or the team's starting level, if it has none). */
export function setVolumeScene(id: string | null) {
  scene = id ?? 'unsaved';
  const kept = Number(readScenes()[scene]);
  level = Number.isFinite(kept) ? clamp(kept) : readDefault();
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
