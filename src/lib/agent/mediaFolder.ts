'use client';

import { useSyncExternalStore } from 'react';
import { run } from '@/lib/browserDb';
import {
  kindOf,
  readActionTiming,
  wordsSayLoop,
  type ActionKind,
  type ActionReading,
  type ActionTiming,
  type FoundFile,
  type MediaAsset,
  type MediaKind,
} from './media';

/**
 * Reading the media folder on this computer. The browser asks once which
 * folder (Chrome or Edge — Safari and Firefox can't open folders), and
 * remembers it; on a later visit it asks permission again before reading.
 * Nothing is uploaded: the app only lists the files, and opens one when the
 * test window shows it.
 */

// The parts of the File System Access API this uses (not all in TypeScript's own types yet).
type Permission = 'granted' | 'denied' | 'prompt';
type DirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
  queryPermission(options: { mode: 'read' }): Promise<Permission>;
  requestPermission(options: { mode: 'read' }): Promise<Permission>;
};
type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' }) => Promise<DirectoryHandle>;
};

export type MediaFolder = DirectoryHandle;

/** This browser can open a folder (Chrome, Edge). */
export const canPickFolder = () =>
  typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function';

/** Asks which folder holds the media, and remembers it. Null if the person cancels. */
export async function pickMediaFolder(): Promise<MediaFolder | null> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('This browser can’t open a folder — use Chrome or Edge.');
  try {
    const folder = await picker.call(window, { id: 'chatbot-designer-media', mode: 'read' });
    await run('media', 'readwrite', (s) => s.put(folder, 'folder'));
    return folder;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}

/** The folder chosen before, if any (its permission may need asking for again — see `allowed`). */
export async function savedMediaFolder(): Promise<MediaFolder | null> {
  try {
    return (await run<MediaFolder | undefined>('media', 'readonly', (s) => s.get('folder'))) ?? null;
  } catch {
    return null;
  }
}

/** Whether the app may read the folder now — asking if `ask` (only from a click: the browser needs one). */
export async function allowed(folder: MediaFolder, ask: boolean): Promise<boolean> {
  if ((await folder.queryPermission({ mode: 'read' })) === 'granted') return true;
  return ask && (await folder.requestPermission({ mode: 'read' })) === 'granted';
}

/** Every image, video and sound file in the folder and its subfolders (hidden files skipped). */
export async function scanMediaFolder(folder: MediaFolder): Promise<FoundFile[]> {
  const found: FoundFile[] = [];
  const walk = async (dir: DirectoryHandle, prefix: string, depth: number) => {
    for await (const entry of dir.values()) {
      if (entry.name.startsWith('.')) continue;
      if (entry.kind === 'directory') {
        if (depth < 8) await walk(entry as DirectoryHandle, `${prefix}${entry.name}/`, depth + 1);
      } else {
        const kind = kindOf(entry.name);
        if (kind) found.push({ path: prefix + entry.name, name: entry.name, kind });
      }
    }
  };
  await walk(folder, '', 0);
  return found;
}

/** Opens one file from the folder, by its path inside it. */
export async function openMediaFile(folder: MediaFolder, path: string): Promise<File> {
  const parts = path.split('/');
  let dir: FileSystemDirectoryHandle = folder;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  return (await dir.getFileHandle(parts.at(-1)!)).getFile();
}

/** The media list as last refreshed, kept in this browser (for when the sheet can't be reached). */
export type StoredLibrary = { folderName: string; assets: MediaAsset[]; refreshedAt: number };

export async function loadLibrary(): Promise<StoredLibrary | null> {
  try {
    return (await run<StoredLibrary | undefined>('media', 'readonly', (s) => s.get('library'))) ?? null;
  } catch {
    return null;
  }
}

export async function saveLibrary(library: StoredLibrary): Promise<void> {
  await run('media', 'readwrite', (s) => s.put(library, 'library'));
}

/**
 * A media file connected to one of a scene's media actions (row 8 of the
 * sheet) — e.g. a photograph of Maya to "Show picture of Maya when the nurse
 * asks to see it". The action is kept by its words, so if they're changed in
 * the sheet the connection shows as no longer found there.
 */
export type MediaLink = {
  assetId: string;
  /** The scene: its sheet and number (as in the sheet), and its name to show. */
  sheetId: string;
  sceneNumber: string;
  sceneName: string;
  action: string;
  /** The student's own choices of when it fires and what the voice does (over what the words suggest). */
  timing?: Partial<Pick<ActionTiming, 'kind' | 'when' | 'voice' | 'delay'>>;
  /** A video loops for as long as it's on screen (the default), or plays once and holds its last frame (false). */
  loop?: boolean;
  /** The file's name and kind when it was connected (for its bar on the timeline). */
  assetName?: string;
  assetKind?: MediaKind;
  /**
   * Its bar on the scene's timeline: which track (a projection area, or the
   * sound track) and which stages it spans, by stage code. Placed when it first
   * appears there; the student drags it from then on.
   */
  bar?: TimelineBar;
  /**
   * When it plays (its kind) as its bars were last laid out for. When the kind
   * changes — the student's choice, or a new reading of the words — the bars
   * are laid out again for it (see MediaTimeline).
   */
  barsKind?: ActionKind;
  /**
   * More bars for the same connection (Option-drag a bar to duplicate it) —
   * e.g. the same picture on several screens. Each is placed like `bar`.
   */
  copies?: TimelineBar[];
};

/**
 * A bar on the timeline: its track — a projection area (1–11), one of an area's
 * extra tracks ('5-2' … '5-5': still area 5), or a sound track ('sound' is the
 * first, then 'sound-2'…) — and the stages it spans, by code.
 */
export type TimelineBar = {
  track: number | `${number}-${number}` | 'sound' | `sound-${number}`;
  from: string;
  to: string;
};

/** The projection area a track shows on (5 for 5 and '5-3'), or null for a sound track. */
export function areaOfTrack(track: TimelineBar['track']): number | null {
  if (typeof track === 'number') return track;
  const m = /^(\d+)-\d+$/.exec(track);
  return m ? Number(m[1]) : null;
}

/** A connection's bars: the first, then any duplicates. */
export const barsOf = (link: MediaLink): TimelineBar[] => (link.bar ? [link.bar, ...(link.copies ?? [])] : []);

// The connections, shared by the Media Library and the timeline — both see every change at once.
const NO_LINKS: MediaLink[] = [];
let shared: MediaLink[] | null = null;
let loading = false;
const sharedListeners = new Set<() => void>();
const tellAll = () => sharedListeners.forEach((listener) => listener());

function subscribeMediaLinks(listener: () => void) {
  sharedListeners.add(listener);
  if (!shared && !loading) {
    loading = true;
    void loadMediaLinks().then((links) => {
      shared ??= links;
      tellAll();
    });
  }
  return () => {
    sharedListeners.delete(listener);
  };
}

/** The connections (kept in this browser), kept up to date as they change. */
export const useMediaLinks = () =>
  useSyncExternalStore(
    subscribeMediaLinks,
    () => shared ?? NO_LINKS,
    () => NO_LINKS,
  );

/**
 * Changes the connections — saved, and shown everywhere at once. With a
 * `label` it's something the student did ("Move bar"), and can be undone;
 * without one it's the app following along (placing a new bar, following a
 * reworded action), which is folded into whatever the student did last.
 */
export function updateMediaLinks(update: (links: MediaLink[]) => MediaLink[], label?: string) {
  const before = shared ?? [];
  const next = update(before);
  if (next === before) return;
  if (label) {
    undoSteps.push({ links: before, label });
    if (undoSteps.length > MAX_UNDO) undoSteps.shift();
    redoSteps.length = 0;
  }
  setLinks(next);
}

function setLinks(next: MediaLink[]) {
  shared = next;
  void saveMediaLinks(next);
  tellAll();
}

// Undo and redo (⌘Z, ⌘⇧Z / ⌘X): each step keeps the connections as they were on its other side.
const MAX_UNDO = 100;
type Step = { links: MediaLink[]; label: string };
const undoSteps: Step[] = [];
const redoSteps: Step[] = [];
/** The last undo or redo, for a moment's notice of what it did. */
export type HistoryNote = { did: 'Undo' | 'Redo'; label: string; at: number };
let lastNote: HistoryNote | null = null;
const noteListeners = new Set<() => void>();

function travel(from: Step[], to: Step[], did: HistoryNote['did']): boolean {
  const step = from.pop();
  if (!step) return false;
  to.push({ links: shared ?? [], label: step.label });
  setLinks(step.links);
  lastNote = { did, label: step.label, at: Date.now() };
  noteListeners.forEach((listener) => listener());
  return true;
}

/** Undoes the last change to the media connections and bars; false if there's nothing to undo. */
export const undoMediaLinks = () => travel(undoSteps, redoSteps, 'Undo');
/** Redoes the last change undone; false if there's nothing to redo. */
export const redoMediaLinks = () => travel(redoSteps, undoSteps, 'Redo');

/** The last undo or redo (null until one happens), kept up to date. */
export const useHistoryNote = () =>
  useSyncExternalStore(
    (listener) => {
      noteListeners.add(listener);
      return () => {
        noteListeners.delete(listener);
      };
    },
    () => lastNote,
    () => null,
  );

/** A connection's timing: what its action's words suggest, with the student's own choices on top. */
export const timingOf = (link: MediaLink): ActionTiming => {
  const words = readActionTiming(link.action);
  const read = readingNow(link.action);
  const when = read?.when ?? words.when;
  return {
    ...words,
    ...(read && {
      kind: read.kind,
      when,
      voice: read.voice ?? (read.when ? (when === 'before-reply' ? 'wait' : 'over') : words.voice),
    }),
    ...link.timing,
  };
};

/**
 * Whether a connection's video or sound loops while it's on: the student's choice
 * ("Loop, when user instructs"); otherwise, for a "once" action, what its words
 * say (Claude's reading, then the words alone) — once unless they ask to loop;
 * every other kind loops while it's on.
 */
export function loopOf(link: MediaLink): boolean {
  if (link.loop !== undefined) return link.loop;
  if (timingOf(link).kind !== 'once') return true;
  return readingNow(link.action)?.loop ?? wordsSayLoop(link.action);
}

// Claude's readings of the actions (see /api/media/intent), by their exact
// words — kept in this browser, so each wording is only read once.
let readings: Record<string, ActionReading> | null = null;
let readingsLoading: Promise<void> | null = null;
const readingListeners = new Set<() => void>();
const NO_READINGS: Record<string, ActionReading> = {};
const tellReaders = () => readingListeners.forEach((listener) => listener());

function loadReadings(): Promise<void> {
  readingsLoading ??= run<Record<string, ActionReading> | undefined>('media', 'readonly', (s) => s.get('readings'))
    .then((kept) => {
      readings = { ...kept, ...readings };
      tellReaders();
    })
    .catch(() => {
      readings ??= {};
    });
  return readingsLoading;
}

/** An action's reading by Claude, if it has been read (and the readings are loaded). */
export const readingNow = (action: string): ActionReading | undefined => readings?.[action.trim()];

/** The readings, kept up to date (re-renders as actions are read). */
export const useActionReadings = () =>
  useSyncExternalStore(
    (listener) => {
      readingListeners.add(listener);
      void loadReadings();
      return () => {
        readingListeners.delete(listener);
      };
    },
    () => readings ?? NO_READINGS,
    () => NO_READINGS,
  );

/** Makes sure the readings are loaded (before playing anything that depends on them). */
export const readingsReady = () => loadReadings();

const beingRead = new Set<string>();

/**
 * Has Claude read any of these actions not read before (in any wording or
 * language). Without a key, or if it can't be reached, they stay unread and
 * the words alone are used (readActionTiming).
 */
export async function readActions(actions: string[], anthropicApiKey: string): Promise<void> {
  await loadReadings();
  const unread = [...new Set(actions.map((a) => a.trim()))].filter((a) => a && !readings?.[a] && !beingRead.has(a));
  if (unread.length === 0) return;
  unread.forEach((a) => beingRead.add(a));
  try {
    const res = await fetch('/api/media/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions: unread, anthropicApiKey }),
    });
    const data = (await res.json()) as { readings?: Record<string, ActionReading> };
    if (!data.readings || Object.keys(data.readings).length === 0) return;
    readings = { ...readings, ...data.readings };
    tellReaders();
    await run('media', 'readwrite', (s) => s.put(readings, 'readings')).catch(() => {});
  } catch {
    // Not read: the words alone are used until next time.
  } finally {
    unread.forEach((a) => beingRead.delete(a));
  }
}

export async function loadMediaLinks(): Promise<MediaLink[]> {
  try {
    return (await run<MediaLink[] | undefined>('media', 'readonly', (s) => s.get('links'))) ?? [];
  } catch {
    return [];
  }
}

export async function saveMediaLinks(links: MediaLink[]): Promise<void> {
  await run('media', 'readwrite', (s) => s.put(links, 'links'));
}

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** How alike two wordings are, 0–1: one containing the other counts as the same action. */
function likeness(was: string, now: string): number {
  const a = words(was).join(' ');
  const b = words(now).join(' ');
  if (!a || !b) return 0;
  if (a === b || b.includes(a) || a.includes(b)) return 1;
  const setA = new Set(words(was));
  const setB = new Set(words(now));
  const shared = [...setA].filter((w) => setB.has(w)).length;
  return shared / Math.max(setA.size, setB.size);
}

/**
 * A scene's connections after its actions (row 8) have been read again: one
 * whose action is no longer there follows the line that's plainly the same
 * action reworded (containing the old words, or sharing most of them), so
 * editing the sheet doesn't break it. Each new line is taken by at most one
 * old wording. Its bars stay where they are; but the student's choice of
 * *when* it plays is dropped, so the new wording decides that again (a reworded
 * action usually means a changed intent — "every time" → "when the user asks").
 * Returns null if nothing changed.
 */
export function followRewording(
  links: MediaLink[],
  scene: { sheetId: string; number: string },
  actions: string[],
): MediaLink[] | null {
  const here = (l: MediaLink) => l.sheetId === scene.sheetId && l.sceneNumber === scene.number;
  const lost = [...new Set(links.filter((l) => here(l) && !actions.includes(l.action)).map((l) => l.action))];
  if (lost.length === 0) return null;
  const free = actions.filter((a) => !links.some((l) => here(l) && l.action === a));
  const renamed = new Map<string, string>();
  for (const was of lost) {
    let best: { action: string; score: number } | null = null;
    for (const now of free) {
      if ([...renamed.values()].includes(now)) continue;
      const score = likeness(was, now);
      if (score >= 0.6 && (!best || score > best.score)) best = { action: now, score };
    }
    if (best) renamed.set(was, best.action);
  }
  if (renamed.size === 0) return null;
  return links.map((l) => {
    if (!here(l) || !renamed.has(l.action)) return l;
    const { kind: _wasKind, ...keep } = l.timing ?? {};
    void _wasKind;
    // Whether it loops is part of when it plays: the new wording decides that too.
    return { ...l, action: renamed.get(l.action)!, timing: keep, loop: undefined };
  });
}

/**
 * Thumbnails made by ffmpeg (for video the browser can't show itself — see
 * /api/media/thumbnail), kept in this browser so each file is only sent once:
 * until it changes (size or date), or another file takes its ID.
 */
type StoredThumb = { size: number; modified: number; path: string; image: Blob };

export async function loadThumbnail(assetId: string, file: File, path: string): Promise<Blob | null> {
  try {
    const kept = await run<StoredThumb | undefined>('media', 'readonly', (s) => s.get(`thumb:${assetId}`));
    return kept && kept.size === file.size && kept.modified === file.lastModified && kept.path === path
      ? kept.image
      : null;
  } catch {
    return null;
  }
}

/** Has ffmpeg (on this computer) make a thumbnail from a video's first frame, and keeps it. */
export async function makeThumbnail(assetId: string, file: File, path: string): Promise<Blob> {
  const res = await fetch('/api/media/thumbnail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
    body: file,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? 'The thumbnail couldn’t be made.');
  }
  const image = await res.blob();
  try {
    const kept: StoredThumb = { size: file.size, modified: file.lastModified, path, image };
    await run('media', 'readwrite', (s) => s.put(kept, `thumb:${assetId}`));
  } catch {
    // Not kept: it's simply made again next time.
  }
  return image;
}
