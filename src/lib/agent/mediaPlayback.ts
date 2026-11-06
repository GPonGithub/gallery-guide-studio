'use client';

import { dipToShare, levelToGain } from '@/components/agent/backgroundMusic';
import type { ActionKind, ActionTiming, EveryWhen, MediaAsset } from './media';
import { soundsHere, tdLevels, tdSound, tdSoundLoop, tdSoundVolume } from './touchDesigner';
import {
  allowed,
  currentMediaLinks,
  isConnected,
  isMarker,
  loadLibrary,
  loadMediaLinks,
  openMediaFile,
  readingsReady,
  savedMediaFolder,
  timingOf,
  type MediaLink, mediaSceneKey
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
  return (await sceneSounds(scene, 'every')).filter((s) => s.timing.when === when);
}

/** The sounds connected to this scene's actions of one kind (as Claude read them, or as the student set). */
export async function sceneSounds(scene: SceneRef | null, kind: ActionKind): Promise<PlannedSound[]> {
  if (!scene) return [];
  const [links, library] = await Promise.all([loadMediaLinks(), loadLibrary(mediaSceneKey(scene)), readingsReady()]);
  const assets = new Map((library?.assets ?? []).map((a) => [a.id, a]));
  return links.flatMap((link) => {
    if (link.sheetId !== scene.sheetId || link.sceneNumber !== scene.number) return [];
    // A bar dropped on the timeline without an action, or one that plays on marker arrival (markerPlay.ts).
    if (!isConnected(link) || isMarker(link)) return [];
    const timing = timingOf(link);
    const asset = assets.get(link.assetId);
    if (timing.kind !== kind) return [];
    if (!asset || asset.kind !== 'sound' || asset.status !== 'present') return [];
    return [{ link, asset, timing }];
  });
}

// Every sound the timeline plays follows the Music / Sounds panel, like the scene's music: its
// Volume, and its Dip while the agent talks (easing down quickly, back up gently).
const DUCK_DOWN_MS = 400;
const DUCK_UP_MS = 1200;
const LEVEL_CHANGE_MS = 150;
const levels = { volume: 5, dip: 5 };
let ducked = false;
const sounding = new Map<HTMLAudioElement, ReturnType<typeof setInterval> | null>();

/** How loud a timeline sound plays now (0–1). */
const soundVolume = () => levelToGain(levels.volume) * (ducked ? dipToShare(levels.dip) : 1);

// Each sound's own volume, from its bar's slider on the timeline: 0 (silent) to MAX_SOUND_VOLUME
// (half as loud again as the file). Up to full it scales the player's volume; above full the
// player stays at the panel's level and a Web Audio gain makes up the rest.
export const MAX_SOUND_VOLUME = 1.5;
export const clampSoundVolume = (v: number | undefined) =>
  Math.max(0, Math.min(MAX_SOUND_VOLUME, Number.isFinite(v) ? (v as number) : 1));
type Own = { assetId: string; volume: number; gain?: GainNode };
const owns = new Map<HTMLAudioElement, Own>();
let context: AudioContext | null = null;

/** A file's own volume, as its connection (its bar) in the timeline sets it. */
export function soundVolumeOf(assetId: string): number {
  return clampSoundVolume(currentMediaLinks().find((l) => l.assetId === assetId && l.volume !== undefined)?.volume);
}

/** What the player's own volume should be now: the panel's level, times the sound's volume up to full. */
const playerVolume = (audio: HTMLAudioElement, level = soundVolume()) =>
  Math.max(0, Math.min(1, level * Math.min(1, owns.get(audio)?.volume ?? 1)));

/** Above full, the sound goes through a gain (made the first time it's needed; it stays). */
function boost(audio: HTMLAudioElement) {
  const own = owns.get(audio);
  if (!own) return;
  if (!own.gain && own.volume > 1) {
    try {
      context ??= new AudioContext();
      const gain = context.createGain();
      context.createMediaElementSource(audio).connect(gain).connect(context.destination);
      own.gain = gain;
    } catch {
      return; // No Web Audio: it plays at full.
    }
  }
  if (context?.state === 'suspended') void context.resume();
  if (own.gain) own.gain.gain.value = Math.max(1, own.volume);
}

/**
 * Changes a file's volume while it plays (its bar's slider moving), here and in TouchDesigner.
 * Saving it on the bar is the timeline's job.
 */
export function setSoundVolume(assetId: string, volume: number) {
  const v = clampSoundVolume(volume);
  let found = false;
  for (const [audio, own] of owns) {
    if (own.assetId !== assetId) continue;
    found = true;
    own.volume = v;
    boost(audio);
    if (!sounding.get(audio)) audio.volume = playerVolume(audio);
  }
  if (found) tdSoundVolume(assetId, v);
}

/** Turns a playing file's looping on or off (its bar's loop button), here and in TouchDesigner. */
export function setSoundLoop(assetId: string, loop: boolean) {
  let found = false;
  for (const [audio, own] of owns) {
    if (own.assetId !== assetId) continue;
    found = true;
    audio.loop = loop;
  }
  if (found) tdSoundLoop(assetId, loop);
}

/** Eases every playing sound to where it should be now (half a cosine, as the music does). */
function rampAll(ms: number) {
  const to = soundVolume();
  tdLevels(to, ms);
  for (const [audio, running] of sounding) {
    if (running) clearInterval(running);
    const from = audio.volume;
    const target = playerVolume(audio, to);
    const start = performance.now();
    const timer = setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / ms);
      audio.volume = Math.max(0, Math.min(1, from + (target - from) * ((1 - Math.cos(Math.PI * t)) / 2)));
      if (t >= 1) {
        clearInterval(timer);
        if (sounding.has(audio)) sounding.set(audio, null);
      }
    }, 30);
    sounding.set(audio, timer);
  }
}

/** A sound starting: at the level it should be now, and following every change from here on. */
function follow(audio: HTMLAudioElement, assetId: string, volume: number) {
  owns.set(audio, { assetId, volume: clampSoundVolume(volume) });
  boost(audio);
  audio.volume = playerVolume(audio);
  // Silent here (still timing the sound) when TouchDesigner plays the sounds.
  audio.muted = !soundsHere();
  sounding.set(audio, null);
}

/** A sound finished or stopped: it no longer follows the levels. */
function unfollow(audio: HTMLAudioElement) {
  const running = sounding.get(audio);
  if (running) clearInterval(running);
  sounding.delete(audio);
  owns.delete(audio);
}

/** The Music / Sounds panel's Volume and Dip (each 0–10), for the timeline's sounds too. */
export function setSoundLevels(volume: number, dip: number) {
  if (volume === levels.volume && dip === levels.dip) return;
  levels.volume = volume;
  levels.dip = dip;
  rampAll(LEVEL_CHANGE_MS);
}

/** Dips every timeline sound while the agent talks (true), and brings them back up after (false). */
export function duckSounds(talking: boolean) {
  if (talking === ducked) return;
  ducked = talking;
  rampAll(talking ? DUCK_DOWN_MS : DUCK_UP_MS);
}

// "Throughout the scene" sounds: loop for the whole call.
const loops = new Set<{ audio: HTMLAudioElement; stop: () => void }>();

/**
 * Starts a sound looping until stopSounds/stopLoops — for "throughout the
 * scene" actions. Rejects if it can't be played.
 */
export async function startLoop(asset: MediaAsset, volume = soundVolumeOf(asset.id)): Promise<void> {
  const folder = await savedMediaFolder();
  if (!folder) throw new Error('No media folder has been chosen.');
  if (!(await allowed(folder, false))) {
    throw new Error('The browser needs permission to read the media folder — open the Media Library and click Allow.');
  }
  const url = URL.createObjectURL(await openMediaFile(folder, asset.path));
  const audio = new Audio(url);
  audio.loop = true;
  follow(audio, asset.id, volume);
  const loop = {
    audio,
    stop: () => {
      audio.pause();
      tdSound('stop', asset);
      unfollow(audio);
      URL.revokeObjectURL(url);
      loops.delete(loop);
      playing.delete(entry);
      changed();
    },
  };
  const entry: Playing = { assetId: asset.id, stop: loop.stop };
  // Its loop button turned off while it plays: it finishes this time through.
  audio.onended = () => loop.stop();
  loops.add(loop);
  playing.add(entry);
  changed();
  tdSound('play', asset, true, clampSoundVolume(volume));
  try {
    await audio.play();
  } catch (err) {
    loop.stop();
    throw err instanceof Error ? err : new Error(`“${asset.name}” couldn’t be played.`);
  }
}

/** Stops every "throughout the scene" sound (the call ended, restarted, or the scene changed). */
export function stopLoops() {
  for (const loop of [...loops]) loop.stop();
}

/** Longest the voice ever waits for a sound (a long file must never stall the conversation). */
const LONGEST_WAIT = 15_000;

// The sounds playing now (from a conversation or Try it), so any of them can be stopped,
// and the Media Library can show which are playing.
type Playing = { assetId: string; stop: () => void };
const playing = new Set<Playing>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

/** Whether any timeline sound is playing now. */
export const anySoundPlaying = () => playing.size > 0;

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
export async function playSound(
  asset: MediaAsset,
  ask = false,
  volume = soundVolumeOf(asset.id),
): Promise<'ended' | 'stopped' | 'waited'> {
  const folder = await savedMediaFolder();
  if (!folder) throw new Error('No media folder has been chosen.');
  if (!(await allowed(folder, ask))) {
    throw new Error('The browser needs permission to read the media folder — open the Media Library and click Allow.');
  }
  const url = URL.createObjectURL(await openMediaFile(folder, asset.path));
  const audio = new Audio(url);
  follow(audio, asset.id, volume);
  return new Promise((resolve, reject) => {
    let over = false;
    const timer = setTimeout(() => resolve('waited'), LONGEST_WAIT);
    const finish = (problem?: unknown, how: 'ended' | 'stopped' = 'ended') => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      unfollow(audio);
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
        tdSound('stop', asset);
        finish(undefined, 'stopped');
      },
    };
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error(`“${asset.name}” couldn’t be played.`));
    playing.add(entry);
    changed();
    tdSound('play', asset, false, clampSoundVolume(volume));
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
      const playing = playSound(sound.asset, ask, clampSoundVolume(sound.link.volume)).catch((err: unknown) =>
        onPlayed(sound, err instanceof Error ? err.message : 'It couldn’t be played.'),
      );
      if (sound.timing.voice === 'wait') return playing;
      if (sound.timing.voice === 'delay')
        return new Promise((r) => setTimeout(r, Math.max(0, sound.timing.delay) * 1000));
      return undefined;
    }),
  );
}
