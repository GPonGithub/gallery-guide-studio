'use client';

import { useSyncExternalStore } from 'react';
import { currentMediaLinks, currentMediaScene, type MediaLink } from './mediaFolder';

/**
 * Spatialized audio (Immersive Media step 6): where in the room each sound on the timeline is heard.
 * The room has four speakers, one in each corner of a square; a sound's position is a point in that
 * square, and each speaker plays it as loud as the point is near it — at a corner only that speaker,
 * in the middle all four evenly (equal power, so a sound keeps its loudness as it moves).
 *
 * Positions run from -1 to 1: x from the left wall to the right, y from the back to the front.
 */
export type Pan = { x: number; y: number };

export const CENTRE: Pan = { x: 0, y: 0 };

/**
 * The room's speakers, seen from the middle facing the front, in the order of the output they're on
 * (`n`: the GIGAPORT eX's outputs 1–4, which the sound is sent by): 1 front left, 2 back right, 3 back
 * left, 4 front right. `label` is the number the square shows for each (the room's own numbering,
 * 2026-11-05): front left 3, front right 4, back left 2, back right 1. Relabelling changes only `label`.
 */
export const SPEAKERS = [
  { n: 1, label: 3, x: -1, y: 1, name: 'Front left' },
  { n: 2, label: 1, x: 1, y: -1, name: 'Back right' },
  { n: 3, label: 2, x: -1, y: -1, name: 'Back left' },
  { n: 4, label: 4, x: 1, y: 1, name: 'Front right' },
] as const;

const clamp1 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
export const clampPan = (p: Partial<Pan> | undefined): Pan => ({
  x: clamp1(p?.x),
  y: clamp1(p?.y),
});
export const isCentre = (p: Pan) => Math.abs(p.x) < 1e-3 && Math.abs(p.y) < 1e-3;

/** How loud each speaker plays a sound at `pan` (0–1), for speakers 1–4 in order. */
export function speakerGains(pan: Pan): [number, number, number, number] {
  const u = (clamp1(pan.x) + 1) / 2; // 0 left … 1 right
  const v = (clamp1(pan.y) + 1) / 2; // 0 back … 1 front
  const at = (x: number, y: number) => Math.sqrt((x > 0 ? u : 1 - u) * (y > 0 ? v : 1 - v));
  const [s1, s2, s3, s4] = SPEAKERS.map((s) => at(s.x, s.y));
  return [s1, s2, s3, s4];
}

/**
 * Which of the browser's four channels reaches each speaker 1–4. Chrome doesn't send its channels to
 * the GIGAPORT in order (it goes by macOS's speaker setup for the device), so this was found by ear in
 * the room (2026-11-05): channel 1 plays on speaker 2, channel 2 on 3, channel 3 on 1, channel 4 on 4.
 * TouchDesigner sends to the outputs by number, so it doesn't need this.
 */
export const BROWSER_CHANNEL_FOR_SPEAKER = [2, 0, 1, 3] as const;

/** The browser's four channel levels for a sound at `pan`, each on the channel that reaches its speaker. */
export function browserChannelLevels(pan: Pan): number[] {
  const gains = speakerGains(pan);
  const channels = [0, 0, 0, 0];
  gains.forEach((g, i) => (channels[BROWSER_CHANNEL_FOR_SPEAKER[i]] = g));
  return channels;
}

/** The same, for a pair of speakers (left, right) — when this computer has only two to play on. */
export const stereoGains = (pan: Pan): [number, number] => {
  const u = (clamp1(pan.x) + 1) / 2;
  return [Math.sqrt(1 - u), Math.sqrt(u)];
};

// A sound's position belongs to the sound (in its scene), not to one bar: setting it moves every bar of
// that sound in the scene, and it's remembered here too, so a bar added later — or the sound dragged on
// again after its bar was removed — plays where it was last put, until it's moved again.
const PAN_KEY = 'sound-pans';
const panKey = (sheetId: string, sceneNumber: string, assetId: string) => `${sheetId}#${sceneNumber}|${assetId}`;
function rememberedPans(): Record<string, Pan> {
  try {
    const v = JSON.parse(window.localStorage.getItem(PAN_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, Pan>) : {};
  } catch {
    return {};
  }
}
/** Remembers where a scene's sound was last put in the room. */
export function rememberPan(sheetId: string, sceneNumber: string, assetId: string, pan: Pan) {
  try {
    window.localStorage.setItem(
      PAN_KEY,
      JSON.stringify({ ...rememberedPans(), [panKey(sheetId, sceneNumber, assetId)]: clampPan(pan) }),
    );
  } catch {
    // No storage: the bars still hold it.
  }
}

/**
 * Where a scene's sound is heard: any of its bars' position (setting it sets all of them), else where it
 * was last put, else the middle of the room.
 */
export function soundPan(sheetId: string, sceneNumber: string, assetId: string, links = currentMediaLinks()): Pan {
  const bar = links.find(
    (l) => l.assetId === assetId && l.sheetId === sheetId && l.sceneNumber === sceneNumber && l.pan,
  );
  return clampPan(bar?.pan ?? rememberedPans()[panKey(sheetId, sceneNumber, assetId)]);
}

/** A file's position in the room, in the scene whose media is in use (see soundPan). */
export function panOf(assetId: string): Pan {
  const scene = currentMediaScene();
  const at = scene?.lastIndexOf('#') ?? -1;
  if (!scene || at < 0) return clampPan(currentMediaLinks().find((l) => l.assetId === assetId && l.pan)?.pan);
  return soundPan(scene.slice(0, at), scene.slice(at + 1), assetId);
}

// A recorded movement (Record Movement): the dot's path while the sound played, `t` in seconds into the
// file. Like the position it belongs to the sound in its scene — on all its bars, and remembered for bars
// added later — until it's recorded again or deleted.
export type PanPoint = { t: number; x: number; y: number };
const PATH_KEY = 'sound-pan-paths';
function rememberedPaths(): Record<string, PanPoint[]> {
  try {
    const v = JSON.parse(window.localStorage.getItem(PATH_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, PanPoint[]>) : {};
  } catch {
    return {};
  }
}
/** Remembers a scene's sound's recorded movement (none: forgets it). */
export function rememberPath(sheetId: string, sceneNumber: string, assetId: string, path: PanPoint[] | null) {
  try {
    const all = rememberedPaths();
    const k = panKey(sheetId, sceneNumber, assetId);
    if (path?.length) all[k] = path;
    else delete all[k];
    window.localStorage.setItem(PATH_KEY, JSON.stringify(all));
  } catch {
    // No storage: the bars still hold it.
  }
}

/** A scene's sound's recorded movement: any of its bars', else the remembered one; null when it has none. */
export function soundPath(
  sheetId: string,
  sceneNumber: string,
  assetId: string,
  links = currentMediaLinks(),
): PanPoint[] | null {
  const mine = links.filter((l) => l.assetId === assetId && l.sheetId === sheetId && l.sceneNumber === sceneNumber);
  const bar = mine.find((l) => l.panPath?.length);
  if (bar) return bar.panPath!;
  return rememberedPaths()[panKey(sheetId, sceneNumber, assetId)] ?? null;
}

/** A file's recorded movement, in the scene whose media is in use (see soundPath). */
export function pathOf(assetId: string): PanPoint[] | null {
  const scene = currentMediaScene();
  const at = scene?.lastIndexOf('#') ?? -1;
  if (!scene || at < 0)
    return currentMediaLinks().find((l) => l.assetId === assetId && l.panPath?.length)?.panPath ?? null;
  return soundPath(scene.slice(0, at), scene.slice(at + 1), assetId);
}

/** Where a recorded movement has the sound `t` seconds into the file (held at its ends, smooth between). */
export function panAt(path: PanPoint[], t: number): Pan {
  if (!path.length) return CENTRE;
  if (t <= path[0].t) return clampPan(path[0]);
  const last = path[path.length - 1];
  if (t >= last.t) return clampPan(last);
  let lo = 0;
  let hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = path[lo];
  const b = path[hi];
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  return clampPan({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
}

/**
 * Records the dot's movement: `add` a position each moment the sound plays (its time in the file), `done`
 * gives the path, with long holds kept as two points (where the hold starts and ends) instead of many.
 */
export function panRecorder() {
  const out: PanPoint[] = [];
  let prev: PanPoint | null = null;
  const same = (a: PanPoint, b: PanPoint) => Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return {
    add(t: number, p: Pan) {
      const pt = { t: round(t), x: round(p.x), y: round(p.y) };
      if (prev && pt.t <= prev.t) return;
      const last = out[out.length - 1];
      if (prev && last && same(prev, pt) && same(last, pt)) {
        prev = pt; // Still holding: only where the hold ends will be kept.
        return;
      }
      if (prev && prev !== last) out.push(prev);
      out.push(pt);
      prev = pt;
    },
    done(): PanPoint[] {
      if (prev && prev !== out[out.length - 1]) out.push(prev);
      return out;
    },
  };
}

// The sound the Spatialized Audio step is showing, chosen by clicking its bar on the timeline. Each
// click also asks the step to open (`asked` counts the clicks).
export type SpatialPick = {
  sheetId: string;
  sceneNumber: string;
  assetId: string;
  action: string;
};
let picked: { pick: SpatialPick | null; asked: number } = {
  pick: null,
  asked: 0,
};
const listeners = new Set<() => void>();

/** Shows this sound in the Spatialized Audio step, and opens the step. */
export function pickSpatialSound(link: MediaLink) {
  const { sheetId, sceneNumber, assetId, action } = link;
  picked = {
    pick: { sheetId, sceneNumber, assetId, action },
    asked: picked.asked + 1,
  };
  listeners.forEach((l) => l());
}

export const useSpatialPick = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => picked,
    () => picked,
  );
