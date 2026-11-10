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
  mediaSceneKey,
  type MediaLink,
  type Placement,
  type TimelineBar,
  fadeInSeconds,
  fadeOutSeconds,
} from './mediaFolder';
import { areaNumber, zoneOfArea } from './projectionLayout';
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
  kind: 'image' | 'video' | 'text' | 'color' | 'character';
  /** The file itself (an object URL); empty for a text or colour, which have no file. */
  url: string;
  /** A text's words, a colour's hex colour, or an AI character's colour (empty = spectrum). */
  value?: string;
  /** For video Chrome can't play (e.g. ProRes with alpha): its first frame, made by ffmpeg, if there is one. */
  still?: string;
  loop: boolean;
  action: string;
  /** Where it was placed over the room drawing (roomPlacement.ts) — its area shows the part inside its outline. */
  place?: Placement;
  /** Its bar there fades in as it starts / out as it ends (TouchDesigner eases it from or to black). */
  /** How long it fades in / out there, in seconds (0: no fade). */
  fadeIn?: number;
  fadeOut?: number;
};

/** The fades of a connection's bar on one area: the bars playing it now (`bars`), else any on that area. */
const fadesOf = (link: MediaLink, area: number, bars?: TimelineBar[]) => {
  const bar = (bars ?? barsOf(link)).find((b) => areaOfTrack(b.track) === area);
  return { fadeIn: fadeInSeconds(bar), fadeOut: fadeOutSeconds(bar) };
};

/** The placement of a connection's picture on one area (its bar there), if it was placed. */
export const placeOf = (link: MediaLink, area: number) =>
  barsOf(link).find((b) => b.place && areaOfTrack(b.track) === area)?.place;

/** Where a file is showing and how it's placed there — to tell whether a placement has changed. */
export const placesShowing = (assetId: string) =>
  JSON.stringify(
    showing
      .filter((s) => s.assetId === assetId)
      .sort((a, b) => a.area - b.area)
      .map((s) => [s.area, s.place ?? null]),
  );

/**
 * After an undo or redo: takes down anything whose connection no longer puts it on that area (its bar
 * there was undone, or the whole connection).
 */
export function dropUnbacked(links: MediaLink[]) {
  const gone = showing.filter((s) => {
    const mine = links.filter((l) => l.assetId === s.assetId);
    if (mine.length === 0) return true;
    const bars = mine.flatMap(barsOf);
    return bars.length > 0 && !bars.some((b) => areaOfTrack(b.track) === s.area);
  });
  if (gone.length === 0) return;
  gone.forEach(release);
  showing = showing.filter((s) => !gone.includes(s));
  changed();
}

/** A scene's connection to an image, video or sound file, with its timing and (for visuals) the areas it shows in. */
export type PlannedMedia = {
  link: MediaLink;
  asset: MediaAsset;
  timing: ActionTiming;
  areas: number[];
  /** The bars it shows for (the marker's), whose fades it takes; else its bar on each area. */
  bars?: TimelineBar[];
  /** Only these areas change: the file stays wherever else it's up (the marker's area-by-area changes). */
  only?: boolean;
};

/** The areas a connection shows in: its bars' tracks (duplicated bars put it on several screens; area 1 until it has a bar). */
export function areasOf(link: MediaLink): number[] {
  const areas = [...new Set(barsOf(link).flatMap((b) => areaOfTrack(b.track) ?? []))];
  return areas.length > 0 ? areas.sort((a, b) => a - b) : [1];
}

/** "area 2" or "areas 2, 5 and 8". */
export function areasText(areas: number[]): string {
  // Areas outside zone 2 say their zone ("zone 1 area 2"); zone 2's are just their numbers, as before.
  const zones = [...new Set(areas.map((a) => zoneOfArea(a).id))];
  const list = (numbers: number[]) =>
    numbers.length === 1 ? `area ${numbers[0]}` : `areas ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
  if (zones.length === 1 && zones[0] === 2) return list(areas);
  return zones
    .map((z) => `zone ${z} ${list(areas.filter((a) => zoneOfArea(a).id === z).map(areaNumber))}`)
    .join(', ');
}

/** This scene's "every time" pictures and video for one event (before each reply, as it starts, after it, when the caller speaks). */
export async function everyVisuals(scene: SceneRef | null, when: EveryWhen): Promise<PlannedMedia[]> {
  return (await sceneMedia(scene, ['every'])).filter((m) => m.asset.kind !== 'sound' && m.timing.when === when);
}

/** This scene's connections of the given kinds (as Claude read them, or as the student set), to files still in the folder. */
export async function sceneMedia(scene: SceneRef | null, kinds: ActionKind[]): Promise<PlannedMedia[]> {
  if (!scene) return [];
  const [links, library] = await Promise.all([loadMediaLinks(), loadLibrary(mediaSceneKey(scene)), readingsReady()]);
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
const changed = (quick = false) => {
  syncVisuals(showing, quick); // TouchDesigner shows the same (see touchDesigner.ts)
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

/** What's showing now (each area's entry), for code outside React. */
export const currentShowing = () => showing;

/** Hears every change to what's showing; returns how to stop listening. */
export function onShowingChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The areas a file is showing in now (sorted), e.g. "1,5". */
export const areasShowing = (assetId: string) =>
  showing
    .filter((s) => s.assetId === assetId)
    .map((s) => s.area)
    .sort((a, b) => a - b)
    .join(',');

/** What an area is showing now, if anything. */
export const shownIn = (area: number) => showing.find((s) => s.area === area);

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
  if (kind === 'text' || kind === 'color' || kind === 'character') {
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
        place: placeOf(link, area),
        ...fadesOf(link, area, media.bars),
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
    place: placeOf(link, area),
    ...fadesOf(link, area, media.bars),
  }));
  put(media, next);
}

/** Puts these up in their areas, replacing whatever was there (and this item anywhere else). */
function put(media: PlannedMedia, next: Shown[]) {
  const replaced = (s: Shown) => media.areas.includes(s.area) || (!media.only && s.assetId === media.asset.id);
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

/** An action's control ("…and remove all the pictures"): takes everything out of the room except one file. */
export function hideOtherVisuals(exceptAssetId?: string) {
  const gone = showing.filter((s) => s.assetId !== exceptAssetId);
  if (gone.length === 0) return;
  gone.forEach(release);
  showing = showing.filter((s) => s.assetId === exceptAssetId);
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

/**
 * Takes down what's showing on an area, unless it's `keep` (a picture placed there on the room drawing
 * replaces whatever was on that area — see roomPlacement.ts).
 */
export function hideArea(area: number, keep?: string) {
  const gone = showing.filter((s) => s.area === area && s.assetId !== keep);
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
  changed(true); // Straight away: no fading out.
}
