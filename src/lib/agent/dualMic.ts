'use client';

import { useSyncExternalStore } from 'react';

/**
 * Dual microphones (Adding Immersive Media, section 8): two people in the conversation, one on each
 * channel of a stereo input — the DJI Mic's receiver ("Wireless Mic Rx") in stereo mode puts transmitter 1
 * on the left and transmitter 2 on the right. Each side is a person named in the scene's sheet (a doctor
 * and a nurse, say), and the agent answers whoever spoke.
 *
 * Chrome's speech recognition only hears the computer's default input, both channels mixed, and can't be
 * pointed at one side. So the words still come from the open mic as before, and this listens to the same
 * input separately, measuring each side's loudness: whichever side was louder while a sentence was being
 * said is the person who said it.
 */

export type Side = 'left' | 'right';
export type Person = { name: string; role: string };
export type DualMicSettings = {
  on: boolean;
  deviceId: string;
  left: Person;
  right: Person;
  /** The scene the names were last filled in for ("sheetId:gid:number"): a change there changes them over. */
  namesFor?: string;
};

const KEY = 'gallery-guide-dual-mic';
const EMPTY: Person = { name: '', role: '' };
const DEFAULTS: DualMicSettings = { on: false, deviceId: '', left: EMPTY, right: EMPTY };
/** The DJI Mic's receiver, as macOS names it — chosen by itself when no input has been picked. */
export const DJI_INPUT = /wireless\s*mic\s*rx|dji/i;

// --- settings (kept per team, like every setting — see team.ts) ---------------------------------------

let settings: DualMicSettings = DEFAULTS;
let loaded = false;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<DualMicSettings>;
      settings = { ...DEFAULTS, ...s, left: { ...EMPTY, ...s.left }, right: { ...EMPTY, ...s.right } };
    }
  } catch {
    // Unreadable: the defaults.
  }
}

export function dualMicSettings(): DualMicSettings {
  load();
  return settings;
}

export function setDualMic(change: Partial<DualMicSettings>) {
  load();
  const wasOn = settings.on;
  const oldDevice = settings.deviceId;
  settings = { ...settings, ...change };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not remembered.
  }
  tell();
  if (settings.on && (!wasOn || settings.deviceId !== oldDevice)) void startListening();
  if (!settings.on && wasOn) stopListening();
}

export const useDualMic = () => useSyncExternalStore(subscribe, dualMicSettings, () => DEFAULTS);

/** The two people, when dual microphones is on and at least one side has a name (else null). */
export function dualSpeakers(): { left: Person; right: Person } | null {
  const s = dualMicSettings();
  return s.on && (s.left.name.trim() || s.right.name.trim()) ? { left: s.left, right: s.right } : null;
}

/** How a side's person is named to the agent and in the chat: "Dr Patel (doctor)", or "Left mic". */
export function personLabel(side: Side, s: DualMicSettings = dualMicSettings()): string {
  const p = s[side];
  const name = p.name.trim();
  if (!name) return side === 'left' ? 'Left mic' : 'Right mic';
  return p.role.trim() && !name.toLowerCase().includes(p.role.trim().toLowerCase()) ? `${name} (${p.role.trim()})` : name;
}

// --- inputs ------------------------------------------------------------------------------------------

export type Input = { id: string; label: string };
/** This computer's inputs, by name (asks for the microphone first: without that the browser hides names). */
export async function listInputs(): Promise<Input[]> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
  } catch {
    // Refused: the names stay hidden.
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1}` }));
}

// --- listening: each side's loudness, sampled every 40 ms --------------------------------------------

type Live = {
  state: 'off' | 'starting' | 'on' | 'mono' | 'problem';
  device: string;
  left: number; // 0–1, for the meters
  right: number;
  problem?: string;
  /** The side heard for the last sentence, and when. */
  lastSide: Side | null;
  lastAt: number;
};
let live: Live = { state: 'off', device: '', left: 0, right: 0, lastSide: null, lastAt: 0 };
const liveListeners = new Set<() => void>();
const setLive = (change: Partial<Live>) => {
  live = { ...live, ...change };
  liveListeners.forEach((l) => l());
};
export const useDualMicLive = () =>
  useSyncExternalStore(
    (l) => {
      liveListeners.add(l);
      return () => {
        liveListeners.delete(l);
      };
    },
    () => live,
    () => live,
  );

const SAMPLE_MS = 40;
const KEEP_MS = 30_000;
/** Each sample: when (performance.now()) and each side's loudness (RMS). */
const samples: { at: number; l: number; r: number }[] = [];
let stream: MediaStream | null = null;
let context: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let starting: Promise<void> | null = null;

const rms = (buf: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
};

async function startListening(): Promise<void> {
  if (starting) return starting;
  starting = (async () => {
    stopListening(false);
    setLive({ state: 'starting', problem: undefined });
    try {
      let { deviceId } = dualMicSettings();
      const inputs = await listInputs();
      if (!deviceId || !inputs.some((i) => i.id === deviceId)) deviceId = inputs.find((i) => DJI_INPUT.test(i.label))?.id ?? '';
      // As it is: echo cancelling, noise removal and automatic level would mix or flatten the two sides.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          channelCount: { ideal: 2 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const track = stream.getAudioTracks()[0];
      const label = track?.label ?? '';
      const channels = track?.getSettings().channelCount ?? 2;
      context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const split = context.createChannelSplitter(2);
      source.connect(split);
      const sides = [0, 1].map((ch) => {
        const a = context!.createAnalyser();
        a.fftSize = 1024;
        split.connect(a, ch);
        return a;
      });
      const bufs = sides.map((a) => new Float32Array(a.fftSize));
      timer = setInterval(() => {
        sides.forEach((a, i) => a.getFloatTimeDomainData(bufs[i]));
        const l = rms(bufs[0]);
        const r = channels < 2 ? l : rms(bufs[1]);
        const at = performance.now();
        samples.push({ at, l, r });
        while (samples.length && samples[0].at < at - KEEP_MS) samples.shift();
        // Meters: a loudness scale that shows speech well (about −50 dB to 0 dB).
        const level = (x: number) => Math.max(0, Math.min(1, (20 * Math.log10(x + 1e-6) + 50) / 50));
        setLive({ left: level(l), right: level(r) });
      }, SAMPLE_MS);
      setLive({
        state: channels < 2 ? 'mono' : 'on',
        device: label,
        problem:
          channels < 2
            ? `“${label}” is sending one channel, so left and right can’t be told apart. Set the DJI receiver to stereo (not mono or merged).`
            : undefined,
      });
    } catch (err) {
      stopListening(false);
      setLive({ state: 'problem', problem: err instanceof Error ? err.message : 'The microphone couldn’t be opened.' });
    }
  })().finally(() => {
    starting = null;
  });
  return starting;
}

function stopListening(off = true) {
  if (timer) clearInterval(timer);
  timer = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  void context?.close().catch(() => {});
  context = null;
  samples.length = 0;
  if (off) setLive({ state: 'off', left: 0, right: 0, device: '' });
}

/** Starts listening if dual microphones was left on (the page calls this once it's open). */
export function resumeDualMic() {
  if (dualMicSettings().on && live.state === 'off') void startListening();
}

// --- who spoke ---------------------------------------------------------------------------------------

/** How much louder one side must be (over the sentence) to be sure it was that person. */
const MARGIN = 1.25;

/**
 * The side that did the talking between `from` and `to` (performance.now() times): the one with more
 * speech energy over that stretch. Null when nothing was heard on either side, or (on a one-channel
 * input) when they can't be told apart. A near tie goes to the louder moment's side.
 */
export function sideBetween(from: number, to: number): Side | null {
  if (live.state !== 'on') return null;
  const span = samples.filter((s) => s.at >= from && s.at <= to + SAMPLE_MS);
  if (span.length === 0) return null;
  let el = 0;
  let er = 0;
  let peak: { v: number; side: Side } = { v: 0, side: 'left' };
  for (const s of span) {
    el += s.l * s.l;
    er += s.r * s.r;
    if (s.l > peak.v) peak = { v: s.l, side: 'left' };
    if (s.r > peak.v) peak = { v: s.r, side: 'right' };
  }
  if (Math.max(el, er) < 1e-6 * span.length) return null; // silence on both
  if (el > er * MARGIN) return 'left';
  if (er > el * MARGIN) return 'right';
  return peak.side;
}

/** The open mic started hearing speech: the sentence being said began here. */
let speechFrom = 0;
export function markSpeechStart() {
  speechFrom = performance.now();
}

/**
 * Who said the words heard up to `lastHeardAt` (performance.now(); now when not given): the side louder
 * since the open mic started hearing them (at most the last 20 seconds). Remembered for the panel.
 */
export function whoSpoke(lastHeardAt?: number): Side | null {
  const to = lastHeardAt || performance.now();
  const from = Math.max(speechFrom || to - 6000, to - 20_000);
  const side = sideBetween(from, to);
  if (side) setLive({ lastSide: side, lastAt: Date.now() });
  return side;
}

/** What the agent is sent: "Dr Patel (doctor): …" when dual microphones knows who spoke; the words alone otherwise. */
export function withSpeaker(text: string, lastHeardAt?: number): string {
  if (!dualSpeakers()) return text;
  const side = whoSpoke(lastHeardAt);
  return side ? `${personLabel(side)}: ${text}` : text;
}

// --- the scene's text, for reading the names --------------------------------------------------------

let sceneText: () => string = () => '';
/** The page says where the open scene's sheet text is (its description, persona and stages). */
export function setSceneTextSource(source: () => string) {
  sceneText = source;
}

/** The people the open scene's sheet says the agent talks with (an AI reads it; needs the Anthropic key). */
export async function readPeople(anthropicApiKey: string): Promise<Person[]> {
  const text = sceneText();
  if (!text.trim()) throw new Error('The open scene has no text to read names from — import it from the sheet first.');
  const res = await fetch('/api/agent/people', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, anthropicApiKey }),
  });
  const data = (await res.json()) as { people?: Person[]; error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? 'The names couldn’t be read.');
  return data.people ?? [];
}

/**
 * The open scene's people, from its sheet (row 11, "People in this scene": "Dave: The nurse"), in order —
 * or, where that row is empty, as an AI reads them from the scene's text (needs the Anthropic key).
 */
export async function scenePeople(
  scene: { sheetId: string; gid: string; number: string },
  anthropicApiKey: string,
): Promise<{ people: Person[]; from: 'sheet' | 'ai' }> {
  const res = await fetch('/api/sheets/scenes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `https://docs.google.com/spreadsheets/d/${scene.sheetId}/edit#gid=${scene.gid}` }),
  });
  const data = (await res.json()) as { scenes?: { number: string; people?: Person[] }[]; error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? 'The sheet couldn’t be read.');
  const listed = data.scenes?.find((sc) => sc.number === scene.number)?.people ?? [];
  if (listed.length > 0) return { people: listed, from: 'sheet' };
  if (!anthropicApiKey.trim()) return { people: [], from: 'sheet' };
  return { people: await readPeople(anthropicApiKey), from: 'ai' };
}
