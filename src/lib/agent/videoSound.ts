'use client';

import { useSyncExternalStore } from 'react';
import { kindOf, type MediaAsset } from './media';
import { allowed, openMediaFile, savedMediaFolder, type MediaFolder, type MediaLink } from './mediaFolder';
import { isSoundPlaying, playSound, soundVolumeOf, startLoop, stopSounds } from './mediaPlayback';
import { currentShowing, onShowingChange, type Shown } from './mediaShow';

/**
 * A video with a sound track plays its sound too, together with the picture. Whenever a video goes up
 * on an area (by its action, on marker arrival, or dropped on the room drawing), its sound starts at the
 * same moment through the timeline's sound player — so it reaches the room speakers, follows its bar's
 * volume, loop and fades, and dips under the voice like any other sound. When the video comes down
 * everywhere, its sound stops (fading out if its bar does). If the video is put up again from the
 * start, its sound starts again with it. Videos without a sound track are left silent.
 */

// --- does the file have a sound track? (read from its container, a few MB at most; remembered) ---

const known = new Map<string, Promise<boolean>>();

const MB = 1024 * 1024;
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const HDLR = ascii('hdlr');
const SOUN = ascii('soun');
const MOOV = ascii('moov');

const at = (buf: Uint8Array, i: number, word: number[]) => word.every((b, k) => buf[i + k] === b);

/** MP4 / MOV: a track whose handler (in its 'hdlr' box) is 'soun'. */
function mp4Sound(buf: Uint8Array): boolean {
  for (let i = 0; i + 16 <= buf.length; i++) {
    if (buf[i] === 0x68 && at(buf, i, HDLR) && at(buf, i + 12, SOUN)) return true;
  }
  return false;
}
function mp4HasMoov(buf: Uint8Array): boolean {
  for (let i = 0; i + 4 <= buf.length; i++) if (buf[i] === 0x6d && at(buf, i, MOOV)) return true;
  return false;
}
/** WebM / MKV: a TrackType element (0x83) saying audio (2). */
function ebmlSound(buf: Uint8Array): boolean {
  for (let i = 0; i + 3 <= buf.length; i++) if (buf[i] === 0x83 && buf[i + 1] === 0x81 && buf[i + 2] === 0x02) return true;
  return false;
}

async function bytes(blob: Blob, from: number, to: number) {
  return new Uint8Array(await blob.slice(Math.max(0, from), Math.min(blob.size, to)).arrayBuffer());
}

async function sniff(blob: Blob): Promise<boolean> {
  const head = await bytes(blob, 0, 4 * MB);
  if (at(head, 0, [0x1a, 0x45, 0xdf, 0xa3])) return ebmlSound(head);
  // MP4 / MOV keep their track list ('moov') at the start (fast start) or at the end.
  if (mp4Sound(head)) return true;
  const tail = blob.size > 4 * MB ? await bytes(blob, blob.size - 8 * MB, blob.size) : new Uint8Array();
  if (mp4Sound(tail)) return true;
  if (mp4HasMoov(head) || mp4HasMoov(tail)) return false;
  // The track list is somewhere in the middle: look through the rest (only for files of sensible size).
  if (blob.size > 1536 * MB) return false;
  for (let from = 4 * MB - 16; from < blob.size - 8 * MB; from += 16 * MB) {
    if (mp4Sound(await bytes(blob, from, from + 16 * MB + 16))) return true;
  }
  return false;
}

// What's been found so far, by file ID (for the timeline and Spatialized Audio, which ask without waiting).
const results = new Map<string, boolean>();
const resultListeners = new Set<() => void>();
let version = 0;

function lookUp(assetId: string, path: string, read: () => Promise<Blob>): Promise<boolean> {
  const key = `${assetId}|${path}`;
  let found = known.get(key);
  if (!found) {
    found = read()
      .then(sniff)
      .catch(() => false);
    known.set(key, found);
    void found.then((yes) => {
      if (results.get(assetId) === yes) return;
      results.set(assetId, yes);
      version++;
      resultListeners.forEach((l) => l());
    });
  }
  return found;
}

/** Whether a showing video's file has a sound track. */
const hasSound = (s: Shown) => lookUp(s.assetId, s.path, () => fetch(s.url).then((r) => r.blob()));

/**
 * Starts finding out whether a video in the media folder has a sound track (once per file; never asks the
 * browser for permission — if the folder isn't allowed yet, it's found out when the video first plays).
 */
export function checkVideoSound(asset: Pick<MediaAsset, 'id' | 'path' | 'kind'>, inFolder?: MediaFolder | null) {
  if (asset.kind !== 'video' || known.has(`${asset.id}|${asset.path}`)) return;
  void (async () => {
    const folder = inFolder ?? (await savedMediaFolder());
    if (!folder || !(await allowed(folder, false))) return;
    await lookUp(asset.id, asset.path, () => openMediaFile(folder, asset.path));
  })();
}

/** Whether a video is known to have a sound track (false until found out). */
export const videoHasSound = (assetId: string) => results.get(assetId) === true;

/** A bar whose file makes sound: a sound file, or a video with a sound track (volume, Spatialized Audio). */
export function audible(link: MediaLink): boolean {
  const kind = link.assetKind ?? kindOf(link.assetName ?? '');
  return kind === 'sound' || (kind === 'video' && videoHasSound(link.assetId));
}

/** Re-renders when more is found out about videos' sound tracks. */
export const useVideoSoundResults = () =>
  useSyncExternalStore(
    (l) => {
      resultListeners.add(l);
      return () => {
        resultListeners.delete(l);
      };
    },
    () => version,
    () => 0,
  );

// --- keeping each video's sound with its picture ---

/** Videos whose sound this started, with the entries (areas) it started for. */
const sounding = new Map<string, Shown[]>();
const checking = new Set<string>();

const videosShowing = () => {
  const by = new Map<string, Shown[]>();
  for (const s of currentShowing()) if (s.kind === 'video' && s.url) by.set(s.assetId, [...(by.get(s.assetId) ?? []), s]);
  return by;
};

async function start(assetId: string) {
  checking.add(assetId);
  const first = videosShowing().get(assetId)?.[0];
  const sound = first ? await hasSound(first) : false;
  checking.delete(assetId);
  // Taken down while its file was being looked at, or no sound track: nothing to play.
  const now = videosShowing().get(assetId);
  if (!sound || !now) return;
  sounding.set(assetId, now);
  if (isSoundPlaying(assetId)) return;
  const s = now[0];
  const asset: MediaAsset = { id: assetId, path: s.path, name: s.name, kind: 'video', status: 'present', added: '' };
  const volume = soundVolumeOf(assetId);
  const fade = s.fadeIn ?? 0;
  const play = s.loop ? startLoop(asset, volume, false, fade) : playSound(asset, false, volume, fade);
  play.catch(() => {
    if (sounding.get(assetId) === now) sounding.delete(assetId);
  });
}

function update() {
  const showing = videosShowing();
  for (const [assetId, before] of sounding) {
    const now = showing.get(assetId);
    if (!now) {
      // Down everywhere: its sound stops too (fading out as the picture does).
      sounding.delete(assetId);
      stopSounds(assetId, Math.max(0, ...before.map((s) => s.fadeOut ?? 0)));
    } else if (!now.some((s) => before.includes(s))) {
      // Put up again from the start (every area new): its sound starts again with it.
      sounding.delete(assetId);
      stopSounds(assetId);
    } else {
      sounding.set(assetId, now);
    }
  }
  for (const assetId of showing.keys()) {
    if (!sounding.has(assetId) && !checking.has(assetId)) void start(assetId);
  }
}

if (typeof window !== 'undefined') onShowingChange(update);
