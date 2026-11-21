'use client';

import { useEffect, useState } from 'react';
import { run } from '@/lib/browserDb';
import { currentMediaScene, loadLibrary } from './mediaFolder';
import { clampSoundVolume, playSound } from './mediaPlayback';

/**
 * The start button's two sounds, per scene (Adding Immersive Media, section 7): one when a press starts
 * the conversation, one when the next press stops it. Each is a sound from the scene's Media Library, with its
 * own volume (silent to 400%, as on the timeline; 100% when not set), played forwards or backwards. Kept by
 * its ID under `buttonSounds:<scene>` in this browser's media store — so backups and exports carry it.
 */

export type ButtonToggle = 'start' | 'stop';
export type ButtonSounds = {
  start?: string;
  stop?: string;
  volumes?: { start?: number; stop?: number };
  /** Played backwards. */
  reversed?: { start?: boolean; stop?: boolean };
};

const key = (scene: string) => `buttonSounds:${scene}`;
const listeners = new Set<() => void>();

export async function loadButtonSounds(scene: string | null = currentMediaScene()): Promise<ButtonSounds> {
  if (!scene) return {};
  return (await run<ButtonSounds | undefined>('media', 'readonly', (s) => s.get(key(scene))).catch(() => undefined)) ?? {};
}

export async function setButtonSound(scene: string, toggle: ButtonToggle, assetId: string | null): Promise<void> {
  const next = { ...(await loadButtonSounds(scene)) };
  if (assetId) next[toggle] = assetId;
  else delete next[toggle];
  await run('media', 'readwrite', (s) => s.put(next, key(scene)));
  listeners.forEach((l) => l());
}

/** Sets one toggle's volume (1 = the file as it is: not kept). */
export async function setButtonVolume(scene: string, toggle: ButtonToggle, volume: number): Promise<void> {
  const next = { ...(await loadButtonSounds(scene)) };
  const volumes = { ...next.volumes };
  const v = clampSoundVolume(volume);
  if (v === 1) delete volumes[toggle];
  else volumes[toggle] = v;
  next.volumes = volumes;
  await run('media', 'readwrite', (s) => s.put(next, key(scene)));
  listeners.forEach((l) => l());
}

/** One toggle's volume: 1 unless set. */
export const buttonVolumeOf = (sounds: ButtonSounds, toggle: ButtonToggle) => clampSoundVolume(sounds.volumes?.[toggle]);

/** Plays one toggle's sound backwards, or forwards again. */
export async function setButtonReversed(scene: string, toggle: ButtonToggle, reversed: boolean): Promise<void> {
  const next = { ...(await loadButtonSounds(scene)) };
  const all = { ...next.reversed };
  if (reversed) all[toggle] = true;
  else delete all[toggle];
  next.reversed = all;
  await run('media', 'readwrite', (s) => s.put(next, key(scene)));
  listeners.forEach((l) => l());
}

/** The scene's two sounds, read again whenever one is changed. */
export function useButtonSounds(scene: string | null): ButtonSounds {
  const [sounds, setSounds] = useState<ButtonSounds>({});
  useEffect(() => {
    let gone = false;
    const read = () => void loadButtonSounds(scene).then((s) => !gone && setSounds(s));
    read();
    listeners.add(read);
    return () => {
      gone = true;
      listeners.delete(read);
    };
  }, [scene]);
  return sounds;
}

/**
 * Plays the open scene's start or stop sound, if it has one (through the room speakers and TouchDesigner,
 * like any library sound). Rejects with a reason to show — e.g. Chrome not yet allowed to read the folder,
 * which a press of a room button can't ask for (only a click in the studio can).
 */
export async function playButtonSound(toggle: ButtonToggle, ask = false): Promise<void> {
  const scene = currentMediaScene();
  const sounds = await loadButtonSounds(scene);
  const id = sounds[toggle];
  if (!id) return;
  const asset = (await loadLibrary(scene))?.assets.find((a) => a.id === id && a.kind === 'sound');
  if (!asset) throw new Error(`The start button’s ${toggle} sound (${id}) isn’t in this scene’s Media Library any more.`);
  await playSound(asset, ask, buttonVolumeOf(sounds, toggle), 0, !!sounds.reversed?.[toggle]);
}
