'use client';

import { useSyncExternalStore } from 'react';
import { dipToShare } from '@/components/agent/backgroundMusic';
import type { ActionKind, ActionTiming, EveryWhen, MediaAsset } from './media';
import { soundsHere, tdLevels, tdSound, tdSoundLoop, tdSoundPan, tdSoundVolume } from './touchDesigner';
import { voiceAnalyser } from './voiceLevel';
import {
  browserChannelLevels,
  clampPan,
  panAt,
  panOf,
  pathOf,
  speakerGains,
  stereoGains,
  type Pan,
  type PanPoint,
} from './spatialAudio';
import {
  allowed,
  barOn,
  fadeInSeconds,
  currentMediaLinks,
  isConnected,
  isMarker,
  loadLibrary,
  loadMediaLinks,
  openMediaFile,
  readingsReady,
  savedMediaFolder,
  timingOf,
  type MediaLink,
  mediaSceneKey,
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
const levels = { volume: 10, dip: 5 };
let ducked = false;
const sounding = new Map<HTMLAudioElement, ReturnType<typeof setInterval> | null>();

/** How loud a timeline sound plays now (0–1): its own Sounds volume (straight, 10 = full), dipped under the voice. */
const soundVolume = () => Math.max(0, Math.min(1, levels.volume / 10)) * (ducked ? dipToShare(levels.dip) : 1);

// Each sound's own volume, from its bar's slider on the timeline: 0 (silent) to MAX_SOUND_VOLUME
// (four times the file's level; the limiter keeps it from distorting). Up to full it scales the player's volume; above full the
// player stays at the panel's level and a Web Audio gain makes up the rest.
export const MAX_SOUND_VOLUME = 4;
export const clampSoundVolume = (v: number | undefined) =>
  Math.max(0, Math.min(MAX_SOUND_VOLUME, Number.isFinite(v) ? (v as number) : 1));
type Own = {
  assetId: string;
  volume: number;
  pan: Pan;
  /** Its recorded movement, if it has one: the position follows it as the file plays. */
  path: PanPoint[] | null;
  /** How far up it is while fading in or out (0–1); 1 otherwise. */
  fade: number;
  fadeTimer?: ReturnType<typeof setInterval>;
  gain?: GainNode;
  speakers?: GainNode[];
};
const owns = new Map<HTMLAudioElement, Own>();
let context: AudioContext | null = null;
/** How many speakers the sounds play on: 4 (the room's, each on its own output) or 2 (left and right). */
let outputs: 2 | 4 = 2;

/** A file's own volume, as its connection (its bar) in the timeline sets it. */
export function soundVolumeOf(assetId: string): number {
  return clampSoundVolume(currentMediaLinks().find((l) => l.assetId === assetId && l.volume !== undefined)?.volume);
}

/** What the player's own volume should be now: the panel's level, times the sound's volume up to full. */
const playerVolume = (audio: HTMLAudioElement, level = soundVolume()) =>
  Math.max(0, Math.min(1, level * Math.min(1, owns.get(audio)?.volume ?? 1) * (owns.get(audio)?.fade ?? 1)));

/**
 * A bar's fade: eases a playing sound's fade level to `to` (0 silent … 1 full) over `seconds`, half a
 * cosine, then calls `done`. Here only — TouchDesigner is told by the play or stop message.
 */
function fadeTo(audio: HTMLAudioElement, to: number, seconds: number, done?: () => void) {
  const own = owns.get(audio);
  if (!own) return done?.();
  if (own.fadeTimer) clearInterval(own.fadeTimer);
  const from = own.fade;
  const start = performance.now();
  own.fadeTimer = setInterval(() => {
    const t = seconds > 0 ? Math.min(1, (performance.now() - start) / (seconds * 1000)) : 1;
    own.fade = from + (to - from) * ((1 - Math.cos(Math.PI * t)) / 2);
    if (!sounding.get(audio)) audio.volume = playerVolume(audio);
    if (t >= 1) {
      clearInterval(own.fadeTimer);
      own.fadeTimer = undefined;
      done?.();
    }
  }, 30);
}

// The room's speakers are on the GIGAPORT eX's outputs 1–4. The Mac's default output may be a
// two-channel device (Loopback, the computer's own speakers), so the sounds' Web Audio goes straight to
// the GIGAPORT when this browser can see it: then each speaker gets its own level.
export type RoomOutput = { device: string; speakers: 2 | 4 };
let roomOutput: RoomOutput | null = null;
const outputListeners = new Set<() => void>();
const ROOM_DEVICE = /gigaport/i;

/** Which output the sounds play on (null until the first sound has played). */
export const useRoomOutput = () =>
  useSyncExternalStore(
    (l) => {
      outputListeners.add(l);
      return () => {
        outputListeners.delete(l);
      };
    },
    () => roomOutput,
    () => null,
  );

/** Sets every playing sound's speaker levels again (the number of speakers changed). */
function relevel() {
  for (const own of owns.values()) {
    if (!own.speakers) continue;
    const levels = outputs === 4 ? browserChannelLevels(own.pan) : [...stereoGains(own.pan), 0, 0];
    own.speakers.forEach((g, i) => (g.gain.value = levels[i]));
  }
}

/** Points the sounds at the GIGAPORT, if this browser can see it (and can choose where Web Audio plays). */
async function findRoomOutput(ctx: AudioContext) {
  let device = 'this computer’s sound output';
  try {
    const sink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    const list = await navigator.mediaDevices?.enumerateDevices?.();
    const room = list?.find((d) => d.kind === 'audiooutput' && ROOM_DEVICE.test(d.label));
    if (room && sink.setSinkId) {
      await sink.setSinkId(room.deviceId);
      device = room.label;
    }
  } catch {
    // Not allowed or not supported: the default output.
  }
  const out = ctx.destination;
  out.channelInterpretation = 'discrete';
  if (out.maxChannelCount >= 4) {
    out.channelCount = 4;
    outputs = 4;
  } else {
    out.channelCount = Math.min(2, out.maxChannelCount);
    outputs = 2;
  }
  roomOutput = { device, speakers: outputs };
  relevel();
  outputListeners.forEach((l) => l());
}

/**
 * The "Use the room's speakers" button: Chrome names sound devices only once the page may use the
 * microphone, so this asks for it (the microphone is let go straight away), then looks for the GIGAPORT.
 * Resolves with where the sounds play now.
 */
export async function chooseRoomSpeakers(): Promise<RoomOutput | null> {
  try {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    mic.getTracks().forEach((t) => t.stop());
  } catch {
    // Refused: the devices stay unnamed, and the sounds stay on the default output.
  }
  context ??= new AudioContext();
  await findRoomOutput(context);
  return roomOutput;
}

/**
 * The sounds' last stop before the speakers: a limiter on each of the four channels. A sound turned up
 * past full (its bar's slider, up to 400%) is held just under the loudest the output can play, instead
 * of distorting; anything quieter passes through untouched.
 */
let limiter: AudioNode | null = null;
function limiterOf(ctx: AudioContext): AudioNode {
  if (limiter) return limiter;
  const bus = ctx.createGain();
  bus.channelCount = 4;
  bus.channelCountMode = 'explicit';
  bus.channelInterpretation = 'discrete';
  const split = ctx.createChannelSplitter(4);
  const join = ctx.createChannelMerger(4);
  bus.connect(split);
  for (let i = 0; i < 4; i++) {
    const c = ctx.createDynamicsCompressor();
    c.channelCount = 1;
    c.channelCountMode = 'explicit';
    c.threshold.value = -3; // dB below full scale
    c.knee.value = 0;
    c.ratio.value = 20;
    c.attack.value = 0.002;
    c.release.value = 0.15;
    split.connect(c, i);
    c.connect(join, 0, i);
  }
  join.connect(ctx.destination);
  limiter = bus;
  return bus;
}

/**
 * The chatbot's voice in the room: a plain <audio> element only reaches the first two outputs
 * (speakers 1 and 2), so the voice goes through the sounds' Web Audio instead, at the same level on
 * all four outputs. It's one voice, the same on every channel, so Chrome's channel order doesn't
 * matter. On a two-channel output it plays on both, as before. Its loudness follows setVoiceVolume, live.
 * Call it once per element, before play(); without Web Audio the element plays as it is.
 */
const VOICE_LEVEL = Math.SQRT1_2; // each of the four: as loud in the room as full on two
/** The voice's own volume (the Voice panel's slider): 1 = as ElevenLabs made it, up to 3 (300%). */
export const MAX_VOICE_VOLUME = 3;
let voiceVolume = 1;
const voiceGains = new Set<GainNode>();
export function setVoiceVolume(volume: number) {
  voiceVolume = Number.isFinite(volume) ? Math.max(0, Math.min(MAX_VOICE_VOLUME, volume)) : 1;
  for (const g of voiceGains) g.gain.value = voiceVolume;
}
export function voiceToAllSpeakers(audio: HTMLAudioElement) {
  try {
    if (!context) {
      context = new AudioContext();
      void findRoomOutput(context);
    }
    const ctx = context;
    // The voice as one channel, turned up or down by the slider.
    const volume = ctx.createGain();
    volume.channelCount = 1;
    volume.channelCountMode = 'explicit';
    volume.channelInterpretation = 'speakers';
    volume.gain.value = voiceVolume;
    // Turned up past 100%, its loudest moments are held just under full instead of distorting.
    const limit = ctx.createDynamicsCompressor();
    limit.channelCount = 1;
    limit.channelCountMode = 'explicit';
    limit.threshold.value = -2;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.002;
    limit.release.value = 0.15;
    const level = ctx.createGain();
    level.channelCount = 1;
    level.channelCountMode = 'explicit';
    level.gain.value = VOICE_LEVEL;
    const merger = ctx.createChannelMerger(4);
    volume.connect(limit);
    limit.connect(level);
    limit.connect(voiceAnalyser(ctx)); // the AI character listens here (voiceLevel.ts)
    for (let i = 0; i < 4; i++) level.connect(merger, 0, i);
    merger.connect(ctx.destination);
    ctx.createMediaElementSource(audio).connect(volume);
    voiceGains.add(volume);
    if (ctx.state === 'suspended') void ctx.resume();
    // Let the nodes go once the element is done with (each clip gets a new element).
    const done = () => {
      voiceGains.delete(volume);
      merger.disconnect();
      level.disconnect();
      limit.disconnect();
      volume.disconnect();
    };
    audio.addEventListener('ended', done, { once: true });
    audio.addEventListener('error', done, { once: true });
  } catch {
    // No Web Audio: it plays as it is, on the default output.
  }
}

/**
 * Every timeline sound goes through Web Audio (made when it starts; it stays): its own gain above full,
 * then one level per speaker, from where Spatialized Audio places it. On the room's four outputs each
 * speaker plays it on its own; on two, left and right follow the position.
 */
function boost(audio: HTMLAudioElement) {
  const own = owns.get(audio);
  if (!own) return;
  if (!own.gain) {
    try {
      if (!context) {
        context = new AudioContext();
        void findRoomOutput(context);
      }
      const gain = context.createGain();
      // One channel (a point in the room), then one level per speaker into that speaker's output.
      gain.channelCount = 1;
      gain.channelCountMode = 'explicit';
      gain.channelInterpretation = 'speakers';
      const merger = context.createChannelMerger(4);
      own.speakers = Array.from({ length: 4 }, (_, i) => {
        const g = context!.createGain();
        gain.connect(g);
        g.connect(merger, 0, i);
        return g;
      });
      context.createMediaElementSource(audio).connect(gain);
      merger.connect(limiterOf(context));
      own.gain = gain;
    } catch {
      return; // No Web Audio: it plays as it is, on the default output.
    }
  }
  if (context?.state === 'suspended') void context.resume();
  if (own.gain) own.gain.gain.value = Math.max(1, own.volume);
  if (own.speakers) {
    const levels = outputs === 4 ? browserChannelLevels(own.pan) : [...stereoGains(own.pan), 0, 0];
    own.speakers.forEach((g, i) => (g.gain.value = levels[i]));
  }
}

/**
 * Moves a file's sound in the room while it plays (the dot in Spatialized Audio), here and in
 * TouchDesigner. Saving it on the bar is the step's job.
 */
export function setSoundPan(assetId: string, pan: Pan) {
  const p = clampPan(pan);
  let found = false;
  for (const [audio, own] of owns) {
    if (own.assetId !== assetId) continue;
    found = true;
    own.pan = p;
    boost(audio);
  }
  if (found) sendPan(assetId, p);
}

// TouchDesigner hears a moving sound's position at most this often, and only when it has moved.
const TD_PAN_MS = 80;
const sentPan = new Map<string, { pan: Pan; at: number }>();
function sendPan(assetId: string, p: Pan, force = false) {
  const last = sentPan.get(assetId);
  const now = performance.now();
  if (!force && last) {
    const still = Math.abs(last.pan.x - p.x) < 0.005 && Math.abs(last.pan.y - p.y) < 0.005;
    if (still || now - last.at < TD_PAN_MS) return;
  }
  sentPan.set(assetId, { pan: p, at: now });
  tdSoundPan(assetId, speakerGains(p));
}

/**
 * Recorded movements: while a sound with one plays, its position follows the recording at the file's
 * time (here, and sent to TouchDesigner). A sound being recorded (`recording`) follows the dot instead.
 */
const recording = new Set<string>();
let moveTimer: ReturnType<typeof setInterval> | null = null;
function followPaths() {
  for (const [audio, own] of owns) {
    if (!own.path || recording.has(own.assetId)) continue;
    const p = panAt(own.path, audio.currentTime);
    if (Math.abs(p.x - own.pan.x) < 1e-3 && Math.abs(p.y - own.pan.y) < 1e-3) continue;
    own.pan = p;
    boost(audio);
    sendPan(own.assetId, p);
  }
  if (![...owns.values()].some((o) => o.path) && moveTimer) {
    clearInterval(moveTimer);
    moveTimer = null;
  }
}
const watchPaths = () => {
  if ([...owns.values()].some((o) => o.path)) moveTimer ??= setInterval(followPaths, 40);
};

/** A sound's recording started (true) or stopped: while recording it doesn't follow its old movement. */
export function setRecordingMovement(assetId: string, on: boolean) {
  if (on) recording.add(assetId);
  else recording.delete(assetId);
}

/** A sound's recorded movement was made or deleted: the playing sound follows the new one (or stays put). */
export function setSoundPath(assetId: string, path: PanPoint[] | null, pan: Pan) {
  for (const [audio, own] of owns) {
    if (own.assetId !== assetId) continue;
    own.path = path?.length ? path : null;
    own.pan = own.path ? panAt(own.path, audio.currentTime) : clampPan(pan);
    boost(audio);
    sendPan(assetId, own.pan, true);
  }
  watchPaths();
}

/** How far into the file a sound playing now is (seconds), or null when it isn't playing. */
export function soundTime(assetId: string): number | null {
  for (const [audio, own] of owns) if (own.assetId === assetId) return audio.currentTime;
  return null;
}

/** Where a sound playing now is in the room (following its recorded movement), or null when it isn't playing. */
export function livePan(assetId: string): Pan | null {
  for (const own of owns.values()) if (own.assetId === assetId) return own.pan;
  return null;
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
function follow(audio: HTMLAudioElement, assetId: string, volume: number, fade = 0) {
  const path = pathOf(assetId);
  sentPan.delete(assetId);
  owns.set(audio, {
    assetId,
    volume: clampSoundVolume(volume),
    pan: path ? panAt(path, 0) : panOf(assetId),
    path,
    fade: fade > 0 ? 0 : 1,
  });
  boost(audio);
  watchPaths();
  audio.volume = playerVolume(audio);
  if (fade > 0) fadeTo(audio, 1, fade);
  // Silent here (still timing the sound) when TouchDesigner plays the sounds.
  audio.muted = !soundsHere();
  sounding.set(audio, null);
}

/** A sound finished or stopped: it no longer follows the levels. */
function unfollow(audio: HTMLAudioElement) {
  const running = sounding.get(audio);
  if (running) clearInterval(running);
  const fading = owns.get(audio)?.fadeTimer;
  if (fading) clearInterval(fading);
  sounding.delete(audio);
  owns.delete(audio);
}

/** The Music / Sounds panel's Sounds volume and Dip (each 0–10), for the timeline's sounds. */
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
export async function startLoop(
  asset: MediaAsset,
  volume = soundVolumeOf(asset.id),
  ask = false,
  /** Its bar fades in: eased up from silence over this many seconds. */
  fade = 0,
): Promise<void> {
  const folder = await savedMediaFolder();
  if (!folder) throw new Error('No media folder has been chosen.');
  if (!(await allowed(folder, ask))) {
    throw new Error('The browser needs permission to read the media folder — open the Media Library and click Allow.');
  }
  const url = URL.createObjectURL(await openMediaFile(folder, asset.path));
  const audio = new Audio(url);
  audio.loop = true;
  follow(audio, asset.id, volume, fade);
  const loop = {
    audio,
    stop: (out = 0) => {
      if (!loops.has(loop)) return;
      loops.delete(loop);
      playing.delete(entry);
      changed();
      tdSound('stop', asset, false, 1, undefined, out);
      // Its bar fades out: eased down to silence first.
      fadeTo(audio, 0, out, () => {
        audio.pause();
        unfollow(audio);
        URL.revokeObjectURL(url);
      });
    },
  };
  const entry: Playing = { assetId: asset.id, stop: loop.stop };
  // Its loop button turned off while it plays: it finishes this time through.
  audio.onended = () => loop.stop();
  loops.add(loop);
  playing.add(entry);
  changed();
  tdSound('play', asset, true, clampSoundVolume(volume), speakerGains(livePan(asset.id) ?? panOf(asset.id)), fade);
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
type Playing = { assetId: string; stop: (fade?: number) => void };
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

/** Whether a media file's sound is playing now, kept up to date. */
export const useSoundPlaying = (assetId: string) =>
  useSyncExternalStore(
    onSoundsChange,
    () => isSoundPlaying(assetId),
    () => false,
  );

/**
 * Stops a file's sound wherever it's playing — or, with no file named, every sound. `fade`: eased down
 * to silence over this many seconds first (its bar's fade out).
 */
export function stopSounds(assetId?: string, fade = 0) {
  for (const p of [...playing]) if (!assetId || p.assetId === assetId) p.stop(fade);
}

/**
 * An action's control ("…after fading out all soundtracks"): stops every sound except one file's —
 * the scene's loops, "once" and "every time" sounds, and the sound of any video — eased down to silence
 * over `fade` seconds first. Says whether anything was playing.
 */
export function stopOtherSounds(exceptAssetId: string | undefined, fade = 0): boolean {
  const others = [...playing].filter((p) => p.assetId !== exceptAssetId);
  for (const p of others) p.stop(fade);
  return others.length > 0;
}

const TURN_MS = 800;

/**
 * An action's control ("…turn the music down to half"): every sound playing now except one file's is
 * eased to `share` of its own volume (its bar's slider) — 1 puts it back. Here and in TouchDesigner.
 */
export function turnOtherSounds(exceptAssetId: string | undefined, share: number) {
  const turned = new Map<string, number>();
  for (const [audio, own] of owns) {
    if (own.assetId === exceptAssetId) continue;
    own.volume = clampSoundVolume(soundVolumeOf(own.assetId) * Math.max(0, share));
    boost(audio);
    turned.set(own.assetId, own.volume);
  }
  if (turned.size === 0) return;
  for (const [assetId, volume] of turned) tdSoundVolume(assetId, volume);
  rampAll(TURN_MS);
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
  /** Its bar fades in: eased up from silence over this many seconds. */
  fade = 0,
): Promise<'ended' | 'stopped' | 'waited'> {
  const folder = await savedMediaFolder();
  if (!folder) throw new Error('No media folder has been chosen.');
  if (!(await allowed(folder, ask))) {
    throw new Error('The browser needs permission to read the media folder — open the Media Library and click Allow.');
  }
  const url = URL.createObjectURL(await openMediaFile(folder, asset.path));
  const audio = new Audio(url);
  follow(audio, asset.id, volume, fade);
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
      stop: (out = 0) => {
        if (over) return;
        tdSound('stop', asset, false, 1, undefined, out);
        if (out <= 0) {
          audio.pause();
          return finish(undefined, 'stopped');
        }
        // Its bar fades out: it's stopped (for the timeline) now, and eased down to silence before it ends.
        playing.delete(entry);
        changed();
        audio.onended = null;
        fadeTo(audio, 0, out, () => {
          audio.pause();
          finish(undefined, 'stopped');
        });
      },
    };
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error(`“${asset.name}” couldn’t be played.`));
    playing.add(entry);
    changed();
    tdSound('play', asset, false, clampSoundVolume(volume), speakerGains(livePan(asset.id) ?? panOf(asset.id)), fade);
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
      const fade = fadeInSeconds(barOn(sound.link));
      const playing = playSound(sound.asset, ask, clampSoundVolume(sound.link.volume), fade).catch((err: unknown) =>
        onPlayed(sound, err instanceof Error ? err.message : 'It couldn’t be played.'),
      );
      if (sound.timing.voice === 'wait') return playing;
      if (sound.timing.voice === 'delay')
        return new Promise((r) => setTimeout(r, Math.max(0, sound.timing.delay) * 1000));
      return undefined;
    }),
  );
}
