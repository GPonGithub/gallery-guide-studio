'use client';

import { useSyncExternalStore } from 'react';
import { currentMediaLinks, type MediaLink } from './mediaFolder';

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

/** A file's position in the room, as its connection (its bar) in the timeline sets it. */
export function panOf(assetId: string): Pan {
  return clampPan(currentMediaLinks().find((l) => l.assetId === assetId && l.pan)?.pan);
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

export const sameSpatialPick = (p: SpatialPick, l: MediaLink) =>
  p.assetId === l.assetId && p.action === l.action && p.sheetId === l.sheetId && p.sceneNumber === l.sceneNumber;

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
