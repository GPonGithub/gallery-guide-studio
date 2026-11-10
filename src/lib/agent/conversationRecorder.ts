'use client';

import { useSyncExternalStore } from 'react';
import { run } from '@/lib/browserDb';
import { onRecordTap, recordTapStreams } from './recordTap';

/**
 * Record conversation: one sound file per conversation — the chatbot's voice, every sound the studio
 * plays (the timeline's sounds, video sound, the Music panel's music: see recordTap.ts) and a
 * microphone, mixed together. It starts when a conversation starts, and stops 5 seconds after it ends.
 * The file is an MP3 (made by ffmpeg on this computer — /api/recording), saved in a folder on this
 * computer: one whose path was pasted in (the app's own server writes there), or one chosen with the
 * browser's folder picker (the browser writes there).
 *
 * Sounds that TouchDesigner plays itself (Sounds: TouchDesigner) aren't in it: the browser is silent then.
 */

// --- settings (this browser) --------------------------------------------------------------------------

export type RecordSettings = {
  /** Record every conversation. */
  on: boolean;
  /** A folder on this computer, as a path (pasted in). Wins over a picked folder. */
  folder: string;
  /** The name of a folder chosen with the folder picker (its handle is kept in the browser's database). */
  pickedName: string;
  /** The microphone ('' = this computer's default input; 'none' = no microphone). */
  micId: string;
};
const KEY = 'record-conversation';
const DEFAULTS: RecordSettings = { on: false, folder: '', pickedName: '', micId: '' };
let settings: RecordSettings | null = null;
const settingListeners = new Set<() => void>();

function readSettings(): RecordSettings {
  if (settings) return settings;
  try {
    settings = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<RecordSettings>) };
  } catch {
    settings = DEFAULTS;
  }
  return settings;
}
export function setRecordSettings(change: Partial<RecordSettings>) {
  settings = { ...readSettings(), ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked: the settings last until the page closes.
  }
  settingListeners.forEach((l) => l());
}
const subscribeSettings = (l: () => void) => {
  settingListeners.add(l);
  return () => {
    settingListeners.delete(l);
  };
};
export const useRecordSettings = () => useSyncExternalStore(subscribeSettings, readSettings, () => DEFAULTS);
/** Whether there's somewhere to save to. */
export const hasRecordFolder = (s: RecordSettings) => Boolean(s.folder.trim() || s.pickedName);

// --- a folder chosen with the browser's folder picker ------------------------------------------------

type Permission = 'granted' | 'denied' | 'prompt';
type WritableFolder = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: 'readwrite' }): Promise<Permission>;
  requestPermission(options: { mode: 'readwrite' }): Promise<Permission>;
};
type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'readwrite' }) => Promise<WritableFolder>;
};
const FOLDER_KEY = 'recording-folder';

export const canPickRecordFolder = () =>
  typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function';

/** Asks for a folder to save recordings in (from a click). Its name, or null if the person cancels. */
export async function pickRecordFolder(): Promise<string | null> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('This browser can’t open a folder — use Chrome or Edge, or paste the folder’s path.');
  try {
    const folder = await picker.call(window, { id: 'chatbot-designer-recordings', mode: 'readwrite' });
    await run('media', 'readwrite', (s) => s.put(folder, FOLDER_KEY));
    setRecordSettings({ pickedName: folder.name, folder: '' });
    return folder.name;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}
async function pickedFolder(): Promise<WritableFolder | null> {
  try {
    return (await run<WritableFolder | undefined>('media', 'readonly', (s) => s.get(FOLDER_KEY))) ?? null;
  } catch {
    return null;
  }
}

// --- a folder given as a path: the app's own server checks it, and writes there ------------------------

export type FolderCheck = { ok: boolean; folder?: string; error?: string };
export async function checkRecordFolder(folder: string): Promise<FolderCheck> {
  try {
    const res = await fetch('/api/recording', {
      method: 'POST',
      headers: { 'x-action': 'check', 'x-folder': encodeURIComponent(folder) },
    });
    return (await res.json()) as FolderCheck;
  } catch {
    return { ok: false, error: 'Couldn’t reach the app on this computer.' };
  }
}

// --- microphones --------------------------------------------------------------------------------------

export type Microphone = { id: string; label: string };
/** This computer's inputs, by name (asks for the microphone first: without that the browser hides the names). */
export async function listMicrophones(): Promise<Microphone[]> {
  try {
    const once = await navigator.mediaDevices.getUserMedia({ audio: true });
    once.getTracks().forEach((t) => t.stop());
  } catch {
    // Refused: the list comes back unnamed, or empty.
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}
/** A microphone as it is: no echo cancelling, noise removal or automatic level (they'd thin out the room). */
export const microphoneStream = (micId: string) =>
  navigator.mediaDevices.getUserMedia({
    audio: {
      ...(micId ? { deviceId: { exact: micId } } : {}),
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

// --- what the recorder is doing -----------------------------------------------------------------------

export type RecordStatus =
  | { state: 'idle' }
  | { state: 'recording'; since: number; mic: 'on' | 'off' | 'missing' }
  | { state: 'saving' }
  | { state: 'saved'; where: string; note?: string }
  | { state: 'error'; message: string };
let status: RecordStatus = { state: 'idle' };
const IDLE: RecordStatus = { state: 'idle' };
const statusListeners = new Set<() => void>();
function setStatus(next: RecordStatus) {
  status = next;
  statusListeners.forEach((l) => l());
}
export const useRecordStatus = () =>
  useSyncExternalStore(
    (l) => {
      statusListeners.add(l);
      return () => {
        statusListeners.delete(l);
      };
    },
    () => status,
    () => IDLE,
  );

// --- recording ----------------------------------------------------------------------------------------

/** How long the recording runs on after the conversation ends. */
export const RECORD_TAIL_MS = 5000;

type Take = {
  ctx: AudioContext;
  recorder: MediaRecorder;
  chunks: Blob[];
  mic: MediaStream | null;
  stopHearing: () => void;
  name: string;
  /** Set once the conversation has ended: the recording stops when it runs out. */
  tail: ReturnType<typeof setTimeout> | null;
  ending: boolean;
  done: boolean;
};
let take: Take | null = null;

const two = (n: number) => String(n).padStart(2, '0');
function fileName(label: string) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
  const clean = label.replace(/[^\w .()-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `Conversation ${stamp}${clean ? ` - ${clean}` : ''}`;
}

/**
 * A conversation is starting (or carrying on): the recording starts, unless it's already running.
 * `label` goes in the file's name (the scene). One that is running out its last seconds — the
 * conversation before — is finished at once, and a new one starts.
 */
export function beginRecording(label: string) {
  const s = readSettings();
  if (!s.on) return;
  if (take && !take.ending) return;
  if (take) finish(take);
  if (!hasRecordFolder(s)) {
    setStatus({ state: 'error', message: 'Not recorded: choose a folder first (Record conversation).' });
    return;
  }
  try {
    const ctx = new AudioContext();
    const mix = ctx.createGain();
    const out = ctx.createMediaStreamDestination();
    mix.connect(out);
    const hear = (stream: MediaStream) => {
      try {
        ctx.createMediaStreamSource(stream).connect(mix);
      } catch {
        // A stream with no sound in it yet: nothing to hear.
      }
    };
    recordTapStreams().forEach(hear);
    const stopHearing = onRecordTap(hear);
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(out.stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 192_000 });
    const mine: Take = { ctx, recorder, chunks: [], mic: null, stopHearing, name: fileName(label), tail: null, ending: false, done: false };
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) mine.chunks.push(e.data);
    };
    recorder.onstop = () => void save(mine);
    recorder.start(1000);
    if (ctx.state === 'suspended') void ctx.resume();
    take = mine;
    const since = Date.now();
    setStatus({ state: 'recording', since, mic: s.micId === 'none' ? 'off' : 'missing' });
    // The microphone joins as soon as it answers (it mustn't hold up the start).
    if (s.micId !== 'none') {
      microphoneStream(s.micId)
        .then((mic) => {
          if (mine.done || mine.recorder.state === 'inactive') {
            mic.getTracks().forEach((t) => t.stop());
            return;
          }
          mine.mic = mic;
          hear(mic);
          if (take === mine) setStatus({ state: 'recording', since, mic: 'on' });
        })
        .catch(() => {
          // No microphone (unplugged, or not allowed): the recording goes on without it.
        });
    }
  } catch (err) {
    take = null;
    setStatus({ state: 'error', message: `Couldn’t start recording: ${err instanceof Error ? err.message : 'no audio'}` });
  }
}

/** The conversation has ended: the recording runs on for `tailMs`, then stops and is saved. */
export function endRecording(tailMs = RECORD_TAIL_MS) {
  const mine = take;
  if (!mine || mine.ending) return;
  mine.ending = true;
  if (tailMs <= 0) finish(mine);
  else mine.tail = setTimeout(() => finish(mine), tailMs);
}

function finish(mine: Take) {
  if (mine.done) return;
  mine.done = true;
  if (mine.tail) clearTimeout(mine.tail);
  if (take === mine) take = null;
  mine.stopHearing();
  try {
    mine.recorder.stop(); // → onstop → save
  } catch {
    void save(mine);
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function save(mine: Take) {
  mine.mic?.getTracks().forEach((t) => t.stop());
  void mine.ctx.close().catch(() => undefined);
  const raw = new Blob(mine.chunks, { type: mine.recorder.mimeType || 'audio/webm' });
  const rawName = `${mine.name}.${raw.type.includes('mp4') ? 'm4a' : 'webm'}`;
  if (raw.size === 0) {
    if (!take) setStatus({ state: 'error', message: 'Nothing was recorded.' });
    return;
  }
  // A new recording may have started meanwhile: its own status stays up.
  const say = (next: RecordStatus) => {
    if (!take) setStatus(next);
  };
  say({ state: 'saving' });
  const s = readSettings();
  const folder = s.folder.trim();
  try {
    const res = await fetch('/api/recording', {
      method: 'POST',
      headers: {
        'Content-Type': raw.type || 'audio/webm',
        'x-file-name': encodeURIComponent(mine.name),
        'x-folder': encodeURIComponent(folder),
      },
      body: raw,
    });
    if (folder) {
      // The app's server wrote it into the folder.
      const data = (await res.json()) as { ok: boolean; path?: string; converted?: boolean; error?: string };
      if (!data.ok || !data.path) throw new Error(data.error ?? 'It wasn’t saved.');
      say({
        state: 'saved',
        where: data.path,
        note: data.converted === false ? 'Saved as it was recorded (not MP3): ffmpeg isn’t installed — Media Library, Run npm install.' : undefined,
      });
      return;
    }
    // The MP3 comes back, and the browser writes it into the folder that was picked.
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'It couldn’t be made into an MP3.');
    const made = await res.blob();
    const name = res.headers.get('x-converted') === '0' ? rawName : `${mine.name}.mp3`;
    await writeToPicked(made, name, say);
  } catch (err) {
    // Not lost: it comes down as a download, as it was recorded.
    download(raw, rawName);
    say({
      state: 'error',
      message: `${err instanceof Error ? err.message : 'It wasn’t saved in the folder.'} The recording was downloaded instead (${rawName}).`,
    });
  }
}

async function writeToPicked(blob: Blob, name: string, say: (s: RecordStatus) => void) {
  const folder = await pickedFolder();
  // Writing needs the folder's permission, which the browser only renews from a click (in the dialog).
  if (!folder || (await folder.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    download(blob, name);
    say({
      state: 'saved',
      where: `Downloads/${name}`,
      note: 'The browser needs the folder chosen again (Record conversation, Choose folder) before it can save there — this one went to Downloads.',
    });
    return;
  }
  const file = await folder.getFileHandle(name, { create: true });
  const writer = await file.createWritable();
  await writer.write(blob);
  await writer.close();
  say({ state: 'saved', where: `${folder.name}/${name}` });
}

/** Renews the picked folder's permission (from a click). True once the browser may write there. */
export async function allowPickedFolder(): Promise<boolean> {
  const folder = await pickedFolder();
  if (!folder) return false;
  if ((await folder.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await folder.requestPermission({ mode: 'readwrite' })) === 'granted';
}
