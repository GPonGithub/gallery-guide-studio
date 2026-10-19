'use client';

import { useSyncExternalStore } from 'react';
import type { ActionKind, ActionTiming, EveryWhen, MediaAsset } from './media';
import {
  allowed,
  loadLibrary,
  loadMediaLinks,
  loadThumbnail,
  openMediaFile,
  readingsReady,
  savedMediaFolder,
  timingOf,
  areaOfTrack,
  barsOf,
  loopOf,
  isConnected,
  isMarker,
  type MediaLink,
} from './mediaFolder';
import type { SceneRef } from './mediaPlayback';
import { syncVisuals } from './touchDesigner';

/**
 * Images and video shown in the room diagram's projection areas — a preview
 * of what TouchDesigner will show there. A connection's area is its bar's
 * track on the timeline. Nothing shows until the conversation triggers its
 * action (or Try it), and it stays until its action says to remove it, the
 * call ends (for "throughout the scene"), or the conversation starts again.
 * "Every time" ones start again from the beginning at each of their events.
 * Video loops while it's on screen unless its connection says not to.
 */

export type Shown = {
  area: number;
  assetId: string;
  name: string;
  /** Its path inside the media folder (the Media tab's column C) — what TouchDesigner opens. */
  path: string;
  kind: 'image' | 'video' | 'text' | 'color';
  /** The file itself (an object URL); empty for a text or colour, which have no file. */
  url: string;
  /** A text's words or a colour's hex colour. */
  value?: string;
  /** For video Chrome can't play (e.g. ProRes with alpha): its first frame, made by ffmpeg, if there is one. */
  still?: string;
  loop: boolean;
  action: string;
};

/** A scene's connection to an image, video or sound file, with its timing and (for visuals) the areas it shows in. */
export type PlannedMedia = { link: MediaLink; asset: MediaAsset; timing: ActionTiming; areas: number[] };

/** The areas a connection shows in: its bars' tracks (duplicated bars put it on several screens; area 1 until it has a bar). */
export function areasOf(link: MediaLink): number[] {
  const areas = [...new Set(barsOf(link).flatMap((b) => areaOfTrack(b.track) ?? []))];
  return areas.length > 0 ? areas.sort((a, b) => a - b) : [1];
}

/** "area 2" or "areas 2, 5 and 8". */
export function areasText(areas: number[]): string {
  if (areas.length === 1) return `area ${areas[0]}`;
  return `areas ${areas.slice(0, -1).join(', ')} and ${areas.at(-1)}`;
}

/** This scene's "every time" pictures and video for one event (before each reply, as it starts, after it, when the caller speaks). */
export async function everyVisuals(scene: SceneRef | null, when: EveryWhen): Promise<PlannedMedia[]> {
  return (await sceneMedia(scene, ['every'])).filter((m) => m.asset.kind !== 'sound' && m.timing.when === when);
}

/** This scene's connections of the given kinds (as Claude read them, or as the student set), to files still in the folder. */
export async function sceneMedia(scene: SceneRef | null, kinds: ActionKind[]): Promise<PlannedMedia[]> {
  if (!scene) return [];
  const [links, library] = await Promise.all([loadMediaLinks(), loadLibrary(), readingsReady()]);
  const assets = new Map((library?.assets ?? []).map((a) => [a.id, a]));
  return links.flatMap((link) => {
    if (link.sheetId !== scene.sheetId || link.sceneNumber !== scene.number) return [];
    // A bar dropped on the timeline without an action, or one that plays on marker arrival (markerPlay.ts).
    if (!isConnected(link) || isMarker(link)) return [];
    const timing = timingOf(link);
    const asset = assets.get(link.assetId);
    if (!kinds.includes(timing.kind) || !asset || asset.status !== 'present') return [];
    return [{ link, asset, timing, areas: areasOf(link) }];
  });
}

let showing: Shown[] = [];
const listeners = new Set<() => void>();
const changed = () => {
  syncVisuals(showing); // TouchDesigner shows the same (see touchDesigner.ts)
  listeners.forEach((listener) => listener());
};
const NONE: Shown[] = [];

/** What each area shows now, kept up to date. */
export const useShowing = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => showing,
    () => NONE,
  );

/** The areas a file is showing in now (sorted), e.g. "1,5". */
export const areasShowing = (assetId: string) =>
  showing
    .filter((s) => s.assetId === assetId)
    .map((s) => s.area)
    .sort((a, b) => a - b)
    .join(',');

/** Whether a file is showing in the room now. */
export const isShowing = (assetId: string) => showing.some((s) => s.assetId === assetId);

const release = (s: Shown) => {
  if (s.url) URL.revokeObjectURL(s.url);
  if (s.still) URL.revokeObjectURL(s.still);
};

/**
 * Shows an image or video in each of its areas (replacing whatever was there). Rejects
 * if the file can't be opened. `ask`: may ask the browser for permission to
 * read the folder (only from a click).
 */
export async function showVisual(media: PlannedMedia, ask = false): Promise<void> {
  const { asset, link, areas } = media;
  const kind = asset.kind;
  if (kind === 'sound') return;
  if (kind === 'text' || kind === 'color') {
    // Made in the app: nothing to open — its words or colour are drawn as they are.
    put(
      media,
      areas.map((area) => ({
        area,
        assetId: asset.id,
        name: asset.name,
        path: asset.path,
        kind,
        url: '',
        value: asset.value ?? '',
        loop: false,
        action: link.action,
      })),
    );
    return;
  }
  const folder = await savedMediaFolder();
  if (!folder) throw new Error('No media folder has been chosen.');
  if (!(await allowed(folder, ask))) {
    throw new Error('The browser needs permission to read the media folder — open the Media Library and click Allow.');
  }
  const file = await openMediaFile(folder, asset.path);
  const thumb = kind === 'video' ? await loadThumbnail(asset.id, file, asset.path) : null;
  // Each area its own copy of the file (so taking one away never breaks another).
  const next: Shown[] = areas.map((area) => ({
    area,
    assetId: asset.id,
    name: asset.name,
    path: asset.path,
    kind,
    url: URL.createObjectURL(file),
    ...(thumb && { still: URL.createObjectURL(thumb) }),
    loop: loopOf(link),
    action: link.action,
  }));
  put(media, next);
}

/** Puts these up in their areas, replacing whatever was there (and this item anywhere else). */
function put(media: PlannedMedia, next: Shown[]) {
  const replaced = (s: Shown) => media.areas.includes(s.area) || s.assetId === media.asset.id;
  showing.filter(replaced).forEach(release);
  showing = [...showing.filter((s) => !replaced(s)), ...next];
  changed();
}

/** Takes a file out of the room (wherever it's showing). */
export function hideVisual(assetId: string) {
  const gone = showing.filter((s) => s.assetId === assetId);
  if (gone.length === 0) return;
  gone.forEach(release);
  showing = showing.filter((s) => s.assetId !== assetId);
  changed();
}

/** Takes a file out of the room everywhere except `keep` (the areas it still has bars for). */
export function hideVisualExcept(assetId: string, keep: number[]) {
  const gone = showing.filter((s) => s.assetId === assetId && !keep.includes(s.area));
  if (gone.length === 0) return;
  gone.forEach(release);
  showing = showing.filter((s) => !gone.includes(s));
  changed();
}

/** Empties the room (the conversation started again, or another scene). */
export function clearVisuals() {
  if (showing.length === 0) return;
  showing.forEach(release);
  showing = [];
  changed();
}
