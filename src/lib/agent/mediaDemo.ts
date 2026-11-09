'use client';

import { useSyncExternalStore } from 'react';
import { run } from '@/lib/browserDb';
import type { MediaAsset } from './media';
import { clearVisuals } from './mediaShow';
import { stopSounds } from './mediaPlayback';
import {
  forgetMediaHistory,
  forgetSceneMedia,
  mediaSceneKey,
  setDemoMediaScene,
  setSceneMedia,
  updateMediaLinks,
  type MediaFolder,
} from './mediaFolder';

/**
 * The Adding Immersive Media tour's sandbox. While it's on, the media panel
 * works on a demo scene — its own stages and row-8 actions, and a demo media
 * folder of three small files (a video, a picture, a sound) — so the tour can
 * connect, drag, duplicate and delete for real without touching the student's
 * work. The demo scene has its own folder and library (every scene does — see
 * mediaFolder.ts), so the student's are never touched; the demo's are removed
 * when it ends, with its connections.
 */

export const DEMO_SHEET_ID = 'onboarding-demo';
export const DEMO_SCENE = { sheetId: DEMO_SHEET_ID, number: 'D', name: 'Demo · Nurse Visit' };
const DEMO_KEY = mediaSceneKey(DEMO_SCENE);
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

const FOLDER_NAME = 'Onboarding demo media';
const FILES: Pick<MediaAsset, 'id' | 'name' | 'kind'>[] = [
  { id: 'DEMO-1', name: 'demo-landscape-video.mp4', kind: 'video' },
  { id: 'DEMO-2', name: 'demo-picture.jpg', kind: 'image' },
  { id: 'DEMO-3', name: 'demo-ding.mp3', kind: 'sound' },
];

export type MediaDemo = { actions: string[] };

let demo: MediaDemo | null = null;
/** Goes up each time the media folder in storage is swapped (demo in, student's back) — panels re-read it then. */
let revision = 0;
/** The demo being set up (so a second call waits for the same one instead of starting another). */
let starting: Promise<void> | null = null;
// From before every scene had its own folder: the student's single folder and library, put aside while
// a demo ran. Only ever read now — to put them back (see `recovering`).
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
/** Changes whenever the stored media folder and library have just been swapped (see `revision`). */
export const useMediaFolderRevision = () => useSyncExternalStore(subscribe, () => revision, () => 0);

const get = (key: string) => run<unknown>('media', 'readonly', (s) => s.get(key));
const put = (key: string, value: unknown) =>
  value === undefined
    ? run('media', 'readwrite', (s) => s.delete(key))
    : run('media', 'readwrite', (s) => s.put(value, key));

/** Opens the demo, with its own media folder and library (once; later calls do nothing). */
export function beginMediaDemo(): Promise<void> {
  if (demo) return Promise.resolve();
  starting ??= setUp().finally(() => {
    starting = null;
  });
  return starting;
}

async function setUp() {
  await recovering;
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
  // An OPFS folder: the same kind of handle as a chosen one, as far as the app reads it.
  await setSceneMedia(DEMO_KEY, folder as unknown as MediaFolder, {
    folderName: FOLDER_NAME,
    refreshedAt: Date.now(),
    assets: FILES.map((f) => ({ ...f, path: f.name, status: 'present' as const, added: today })),
  });
  demo = { actions: [...DEMO_ACTIONS] };
  setDemoMediaScene(DEMO_KEY);
  revision++;
  changed();
}

/** Ends the demo: its connections, room media, sounds, folder and library go; the open scene's media is back in use. */
export async function endMediaDemo(): Promise<void> {
  // Closed while it was still being set up: let that finish, then undo it.
  if (starting) await starting.catch(() => undefined);
  if (!demo) return;
  clearVisuals();
  stopSounds();
  await putBack();
  setDemoMediaScene(null);
  demo = null;
  revision++;
  changed();
}

/** Clears away everything of the demo's (and puts back a single folder set aside by an older version). */
async function putBack() {
  updateMediaLinks((all) => all.filter((l) => l.sheetId !== DEMO_SHEET_ID));
  forgetMediaHistory();
  await forgetSceneMedia(DEMO_KEY).catch(() => undefined);
  const backup = (await get(BACKUP_KEY).catch(() => undefined)) as { folder: unknown; library: unknown } | undefined;
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
        const left = (await get(BACKUP_KEY).catch(() => undefined)) || (await get(`library:${DEMO_KEY}`).catch(() => undefined));
        if (left) {
          await putBack();
          revision++;
          changed();
        }
      })().catch(() => undefined);
