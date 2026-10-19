'use client';

import { useSyncExternalStore } from 'react';
import { run } from '@/lib/browserDb';
import type { MediaAsset } from './media';
import { clearVisuals } from './mediaShow';
import { stopSounds } from './mediaPlayback';
import { forgetMediaHistory, updateMediaLinks } from './mediaFolder';

/**
 * The Adding Immersive Media tour's sandbox. While it's on, the media panel
 * works on a demo scene — its own stages and row-8 actions, and a demo media
 * folder of three small files (a video, a picture, a sound) — so the tour can
 * connect, drag, duplicate and delete for real without touching the student's
 * work. The student's media folder and library are put aside first and come
 * back untouched; the demo's connections are removed when it ends.
 */

export const DEMO_SHEET_ID = 'onboarding-demo';
export const DEMO_SCENE = { sheetId: DEMO_SHEET_ID, number: 'D', name: 'Demo · Nurse Visit' };
export const DEMO_STAGES = [
  { code: '1', name: 'Welcome' },
  { code: '2A', name: 'Check symptoms' },
  { code: '2B', name: 'Reschedule' },
  { code: '3', name: 'Medication' },
  { code: '4', name: 'Goodbye' },
];
/** Row 8 of the demo scene: one action per line, as a student writes them. */
export const DEMO_ACTIONS = [
  'Show the demo picture when the caller asks to see it',
  'Play the landscape video when the caller asks for it',
  'Play the ding every time before you speak',
];
/** The line "added to the sheet" in the tour's Refresh This Scene step. */
export const DEMO_NEW_ACTION = 'Play the landscape video at the end of the call';

const FOLDER_NAME = 'Onboarding demo media';
const FILES: Pick<MediaAsset, 'id' | 'name' | 'kind'>[] = [
  { id: 'DEMO-1', name: 'demo-landscape-video.mp4', kind: 'video' },
  { id: 'DEMO-2', name: 'demo-picture.jpg', kind: 'image' },
  { id: 'DEMO-3', name: 'demo-ding.mp3', kind: 'sound' },
];

export type MediaDemo = { actions: string[] };

let demo: MediaDemo | null = null;
type Backup = { folder: unknown; library: unknown };
// The student's folder and library while the demo runs — also kept in the database (BACKUP_KEY),
// so a page reloaded mid-tour still gets them back (see recover below).
const BACKUP_KEY = 'demo-backup';
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** The demo while the tour runs it (null otherwise). */
export const useMediaDemo = () =>
  useSyncExternalStore(
    subscribe,
    () => demo,
    () => null,
  );
export const mediaDemoOn = () => demo !== null;

const get = (key: string) => run<unknown>('media', 'readonly', (s) => s.get(key));
const put = (key: string, value: unknown) =>
  value === undefined
    ? run('media', 'readwrite', (s) => s.delete(key))
    : run('media', 'readwrite', (s) => s.put(value, key));

/** Puts the student's media folder and library aside and opens the demo (once; later calls do nothing). */
export async function beginMediaDemo(): Promise<void> {
  if (demo) return;
  await recovering;
  const backup: Backup = { folder: await get('folder'), library: await get('library') };
  await put(BACKUP_KEY, backup);
  // The demo files, copied into this site's private storage (OPFS) — a real folder the app can read.
  const root = await navigator.storage.getDirectory();
  const folder = await root.getDirectoryHandle(FOLDER_NAME, { create: true });
  for (const f of FILES) {
    const blob = await (await fetch(`/onboarding-media/${f.name}`)).blob();
    const writable = await (await folder.getFileHandle(f.name, { create: true })).createWritable();
    await writable.write(blob);
    await writable.close();
  }
  const today = new Date().toLocaleDateString('en-CA');
  await put('folder', folder);
  await put('library', {
    folderName: FOLDER_NAME,
    refreshedAt: Date.now(),
    assets: FILES.map((f) => ({ ...f, path: f.name, status: 'present', added: today })),
  });
  demo = { actions: [...DEMO_ACTIONS] };
  changed();
}

/** The tour's Refresh This Scene step: the demo sheet gains a line, as if a student had typed it in row 8. */
export function addDemoAction() {
  if (!demo || demo.actions.includes(DEMO_NEW_ACTION)) return;
  demo = { actions: [...demo.actions, DEMO_NEW_ACTION] };
  changed();
}

/** Ends the demo: its connections, room media and sounds go, and the student's folder and library come back. */
export async function endMediaDemo(): Promise<void> {
  if (!demo) return;
  demo = null;
  clearVisuals();
  stopSounds();
  await putBack();
  changed();
}

/** Brings the student's folder and library back, and clears away everything of the demo's. */
async function putBack() {
  updateMediaLinks((all) => all.filter((l) => l.sheetId !== DEMO_SHEET_ID));
  forgetMediaHistory();
  const backup = (await get(BACKUP_KEY).catch(() => undefined)) as Backup | undefined;
  if (backup) {
    await put('folder', backup.folder);
    await put('library', backup.library);
    await put(BACKUP_KEY, undefined);
  }
  try {
    await (await navigator.storage.getDirectory()).removeEntry(FOLDER_NAME, { recursive: true });
  } catch {
    // Already gone.
  }
}

// A tour left by reloading the page: put things back as soon as the app loads.
const recovering: Promise<void> =
  typeof window === 'undefined'
    ? Promise.resolve()
    : (async () => {
        if (await get(BACKUP_KEY).catch(() => undefined)) {
          await putBack();
          changed();
        }
      })().catch(() => undefined);
