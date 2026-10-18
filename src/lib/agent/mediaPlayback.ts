'use client';

import type { EveryWhen, MediaAsset, ActionTiming } from './media';
import {
  allowed,
  loadLibrary,
  loadMediaLinks,
  openMediaFile,
  savedMediaFolder,
  timingOf,
  type MediaLink,
} from './mediaFolder';

/**
 * Playing "every time" media during a conversation: the sound files connected
 * (in the Media Library) to the open scene's media actions, played in stereo
 * on this computer as the conversation reaches each event — before each
 * reply, as it starts, after it, or when the caller speaks.
 */

/** The open scene, as its connections name it. */
export type SceneRef = { sheetId: string; number: string };

export type PlannedSound = { link: MediaLink; asset: MediaAsset; timing: ActionTiming };

/** The sounds connected to this scene's "every time" actions for one event. */
export async function soundsFor(scene: SceneRef | null, when: EveryWhen): Promise<PlannedSound[]> {
  if (!scene) return [];
  const [links, library] = await Promise.all([loadMediaLinks(), loadLibrary()]);
  const assets = new Map((library?.assets ?? []).map((a) => [a.id, a]));
  return links.flatMap((link) => {
    if (link.sheetId !== scene.sheetId || link.sceneNumber !== scene.number) return [];
    const timing = timingOf(link);
    const asset = assets.get(link.assetId);
    if (timing.kind !== 'every' || timing.when !== when) return [];
    if (!asset || asset.kind !== 'sound' || asset.status !== 'present') return [];
    return [{ link, asset, timing }];
  });
}

/** Longest the voice ever waits for a sound (a long file must never stall the conversation). */
const LONGEST_WAIT = 15_000;

// The sounds playing now (from a conversation or Try it), so any of them can be stopped,
// and the Media Library can show which are playing.
type Playing = { assetId: string; stop: () => void };
const playing = new Set<Playing>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

/** Whether a media file's sound is playing now. */
export const isSoundPlaying = (assetId: string) => [...playing].some((p) => p.assetId === assetId);

/** Hears each sound starting or stopping; returns how to stop listening. */
export function onSoundsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stops a file's sound wherever it's playing — or, with no file named, every sound. */
export function stopSounds(assetId?: string) {
  for (const p of [...playing]) if (!assetId || p.assetId === assetId) p.stop();
}

/**
 * Plays a sound file from the media folder. Resolves when it has finished
 * ('ended'), been stopped ('stopped'), or played for LONGEST_WAIT ('waited' —
 * it plays on); rejects if it can't be played. `ask`: may ask the browser for
 * permission to read the folder (only from a click).
 */
export async function playSound(asset: MediaAsset, ask = false): Promise<'ended' | 'stopped' | 'waited'> {
  const folder = await savedMediaFolder();
  if (!folder) throw new Error('No media folder has been chosen.');
  if (!(await allowed(folder, ask))) {
    throw new Error('The browser needs permission to read the media folder — open the Media Library and click Allow.');
  }
  const url = URL.createObjectURL(await openMediaFile(folder, asset.path));
  const audio = new Audio(url);
  return new Promise((resolve, reject) => {
    let over = false;
    const timer = setTimeout(() => resolve('waited'), LONGEST_WAIT);
    const finish = (problem?: unknown, how: 'ended' | 'stopped' = 'ended') => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      playing.delete(entry);
      URL.revokeObjectURL(url);
      changed();
      if (problem === undefined) resolve(how);
      else reject(problem instanceof Error ? problem : new Error(`“${asset.name}” couldn’t be played.`));
    };
    const entry: Playing = {
      assetId: asset.id,
      stop: () => {
        audio.pause();
        finish(undefined, 'stopped');
      },
    };
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error(`“${asset.name}” couldn’t be played.`));
    playing.add(entry);
    changed();
    audio.play().catch((err: unknown) => finish(err ?? new Error('couldn’t start')));
  });
}

/**
 * Plays an event's sounds together. Resolves once the voice may go on: when
 * every sound whose voice "waits" has finished, and every set wait is over.
 * `onPlayed` is told about each one as it starts (or why it couldn't).
 */
export async function playEvent(
  sounds: PlannedSound[],
  onPlayed: (sound: PlannedSound, problem?: string) => void,
  ask = false,
): Promise<void> {
  await Promise.all(
    sounds.map((sound) => {
      onPlayed(sound);
      const playing = playSound(sound.asset, ask).catch((err: unknown) =>
        onPlayed(sound, err instanceof Error ? err.message : 'It couldn’t be played.'),
      );
      if (sound.timing.voice === 'wait') return playing;
      if (sound.timing.voice === 'delay')
        return new Promise((r) => setTimeout(r, Math.max(0, sound.timing.delay) * 1000));
      return undefined;
    }),
  );
}
