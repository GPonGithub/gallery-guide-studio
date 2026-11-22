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
  /** Music filter: a sentence heard about equally on both clip-on mics is the room's speakers (lyrics), not a person — dropped. */
  musicFilter: boolean;
  /** How much louder (dB) a person must be on their own mic than on the other one to count. */
  balanceDb: number;
  /**
   * Each mic's minimum loudness (dBFS, the sentence's loudest moment on the mic it was loudest on): quieter
   * than this is someone near the wearer, not the wearer — dropped. Works with one mic in use or both.
   */
  minDb: { left: number; right: number };
};

const KEY = 'gallery-guide-dual-mic';
const EMPTY: Person = { name: '', role: '' };
export const DEFAULT_BALANCE_DB = 6;
/** Below this (dBFS) nothing near a clip-on mic said anything: each mic's minimum loudness to begin with. */
export const DEFAULT_MIN_DB = -45;
/** The meters' scale (and the minimum loudness sliders'): −50 dB to 0 dB. */
export const METER_FLOOR_DB = -50;
const DEFAULT_MIN = { left: DEFAULT_MIN_DB, right: DEFAULT_MIN_DB };
const DEFAULTS: DualMicSettings = {
  on: false,
  deviceId: '',
  left: EMPTY,
  right: EMPTY,
  musicFilter: true,
  balanceDb: DEFAULT_BALANCE_DB,
  minDb: DEFAULT_MIN,
};
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
      settings = {
        ...DEFAULTS,
        ...s,
        left: { ...EMPTY, ...s.left },
        right: { ...EMPTY, ...s.right },
        minDb: { ...DEFAULT_MIN, ...s.minDb },
      };
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
  /** The last sentence dropped (music, or too quiet), and why (for the panel). */
  ignored: { text: string; at: number; why: string } | null;
  /** The last sentence heard: the mic it was loudest on and its loudest moment (dBFS), for setting the minimums. */
  heard: { side: Side; peak: number; at: number } | null;
};
let live: Live = { state: 'off', device: '', left: 0, right: 0, lastSide: null, lastAt: 0, ignored: null, heard: null };
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
        const level = (x: number) => Math.max(0, Math.min(1, (20 * Math.log10(x + 1e-6) - METER_FLOOR_DB) / -METER_FLOOR_DB));
        setLive({ left: level(l), right: level(r) });
        if (channels >= 2) hearTalking(at);
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
  setTalking(false);
  talkRun = 0;
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
 * At least this far back from a sentence's last word is measured. Chrome often reports a short phrase
 * ("sure, go ahead") only once it has been said, so its start mark can come after the voice itself.
 */
const LOOK_BACK_MS = 2500;
/** The stretch a sentence heard up to `to` is measured over: from its start (at least LOOK_BACK_MS back), at most 20 s. */
const sentenceSpan = (to: number) => Math.max(Math.min(speechFrom || to, to - LOOK_BACK_MS), to - 20_000);

/** The last sentence dropped (too quiet, or music), with why — for the chat to say so. */
export const lastIgnored = () => live.ignored;

/**
 * Who said the words heard up to `lastHeardAt` (performance.now(); now when not given): the side louder
 * since the open mic started hearing them (at most the last 20 seconds). Remembered for the panel.
 */
export function whoSpoke(lastHeardAt?: number): Side | null {
  const to = lastHeardAt || performance.now();
  const from = sentenceSpan(to);
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

// --- music filter: a person, or the room's speakers? ---------------------------------------------------

const db = (x: number) => 20 * Math.log10(x + 1e-9);

/**
 * The sound between `from` and `to`: the side with more of it, how many dB more (balance), and that
 * side's loudest moment (dBFS). Null when nothing was sampled (not listening).
 */
function measure(from: number, to: number): { side: Side; balance: number; peak: number } | null {
  if (live.state !== 'on' && live.state !== 'mono') return null;
  const span = samples.filter((x) => x.at >= from && x.at <= to + SAMPLE_MS);
  if (span.length === 0) return null;
  let el = 0;
  let er = 0;
  let pl = 0;
  let pr = 0;
  for (const x of span) {
    el += x.l * x.l;
    er += x.r * x.r;
    pl = Math.max(pl, x.l);
    pr = Math.max(pr, x.r);
  }
  const side: Side = el >= er ? 'left' : 'right';
  const balance = 10 * Math.log10((Math.max(el, er) + 1e-12) / (Math.min(el, er) + 1e-12));
  const peak = db(side === 'left' ? pl : pr);
  return { side, balance, peak };
}

/** Whether a sound measured on `side` at `peak` dBFS reaches that mic's minimum loudness. */
const loudEnough = (side: Side, peak: number) => peak >= dualMicSettings().minDb[side];

/**
 * Whether the sound between `from` and `to` was a person at a clip-on mic or the room (music from the
 * speakers reaches both mics about equally; a wearer's voice is far louder on their own) or someone
 * nearby (quieter than that mic's minimum loudness). `balanceDb`: how much louder the louder side must
 * be. Null when it can't be told (not listening in stereo).
 */
export function personOrRoom(from: number, to: number, balanceDb: number): { person: boolean; side: Side; balance: number; peak: number } | null {
  if (live.state !== 'on') return null;
  const m = measure(from, to);
  if (!m) return null;
  return { person: m.balance >= balanceDb && loudEnough(m.side, m.peak), ...m };
}

// --- someone talking now (music and sounds dip under them, as under the agent's voice) ---------------

/** The last stretch looked at, how many samples in a row must show a person to start, and how long it holds after. */
const TALK_WINDOW_MS = 160;
const TALK_START_SAMPLES = 3;
const TALK_HOLD_MS = 900;
let talking = false;
let talkRun = 0;
let talkLastAt = 0;
const talkListeners = new Set<(on: boolean) => void>();
function setTalking(on: boolean) {
  if (on === talking) return;
  talking = on;
  talkListeners.forEach((l) => l(on));
}

/**
 * Each sample (stereo only): is a person talking into either clip-on mic right now? The same test as the
 * music filter (personOrRoom): one side clearly louder than the other (by the panel's balance setting) and
 * loud enough to be someone at the mic. Music and the agent's voice from the room's speakers reach both
 * mics about equally, so they don't count — and the dip can't set itself off. A few samples in a row start
 * it (a cough or a knock doesn't); it holds a little after they stop, so pauses between words don't pump.
 */
function hearTalking(at: number) {
  const verdict = personOrRoom(at - TALK_WINDOW_MS, at, dualMicSettings().balanceDb);
  if (verdict?.person) {
    talkRun++;
    talkLastAt = at;
    if (talkRun >= TALK_START_SAMPLES) setTalking(true);
  } else {
    talkRun = 0;
    if (talking && at - talkLastAt > TALK_HOLD_MS) setTalking(false);
  }
}

/** Hears whenever someone starts or stops talking into either clip-on mic (dual microphones on, in stereo). */
export function onPersonTalking(listener: (on: boolean) => void): () => void {
  talkListeners.add(listener);
  return () => {
    talkListeners.delete(listener);
  };
}
export const usePersonTalking = () =>
  useSyncExternalStore(
    (l) => onPersonTalking(l),
    () => talking,
    () => false,
  );

/** Whether the dual mics can judge person-or-music right now (on, listening in stereo, filter on). */
export const canJudgeMusic = () => {
  const s = dualMicSettings();
  return s.on && s.musicFilter && live.state === 'on';
};

/**
 * What the open mic should send for words it heard (up to `lastHeardAt`, performance.now()): the words,
 * labelled with who said them ("Dave (nurse): …") when dual microphones knows — or null when they're
 * judged the room's music, so nothing is sent. With the dual mics listening, the music filter decides
 * (a person clearly louder on their own mic gets through, even over a song). Without them, nothing heard
 * while a song plays (`songPlaying`: a one-off sound like the dance music) is sent — its lyrics can't be
 * told from a person.
 */
export function judgeHeard(text: string, lastHeardAt: number | undefined, songPlaying: boolean): string | null {
  const s = dualMicSettings();
  const to = lastHeardAt || performance.now();
  const from = sentenceSpan(to);
  // Each mic's minimum loudness: quieter is someone talking to the wearer, not the wearer (one mic or both).
  const m = s.on ? measure(from, to) : null;
  if (m) {
    setLive({ heard: { side: m.side, peak: m.peak, at: Date.now() } });
    if (!loudEnough(m.side, m.peak)) {
      const mic = m.side === 'left' ? 'left' : 'right';
      setLive({
        ignored: {
          text,
          at: Date.now(),
          why: `too quiet on the ${mic} mic: ${Math.round(m.peak)} dB, under its minimum of ${s.minDb[m.side]} dB`,
        },
      });
      return null;
    }
  }
  if (canJudgeMusic()) {
    const verdict = personOrRoom(from, to, s.balanceDb);
    if (verdict && !verdict.person) {
      const why = `about as loud on both mics (${verdict.balance.toFixed(1)} dB apart, under ${s.balanceDb} dB) — music`;
      setLive({ ignored: { text, at: Date.now(), why } });
      return null;
    }
  } else if (songPlaying && s.musicFilter) {
    setLive({ ignored: { text, at: Date.now(), why: 'a song was playing — turn on Dual microphones to talk over songs' } });
    return null;
  }
  return s.on ? withSpeaker(text, lastHeardAt) : text;
}
