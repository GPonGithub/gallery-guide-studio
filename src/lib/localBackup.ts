'use client';

import { useSyncExternalStore } from 'react';
import { onDbWrite, openDb } from './browserDb';
import { buildProjectFile, importProject, readProjectFile } from './projectBackup';
import { currentTeam } from './team';

/**
 * A copy of everything the app keeps in this browser, saved on this computer as work changes — the
 * same file as Export Project (API keys and folder permissions left out), written by
 * /api/local-backup into the app's folder.
 *
 * Why: some browsers forget their storage. The studio Mac's Chrome is managed with ephemeral profiles,
 * so quitting Chrome wipes every scene's media list, connections, settings and saved scenes; the
 * timeline then shows black thumbnails. When the app opens to a browser holding nothing at all, it
 * puts the last copy back (and reloads). A folder's permission can't be kept anywhere: step 1 of
 * Adding Immersive Media asks for each scene's folder again, by name, and its IDs carry on.
 *
 * Only when the app runs on this computer (a hosted copy has no folder to keep it in).
 */

const SAVE_AFTER_MS = 4000;
const NOTE_KEY = 'local-backup:restored';

let started = false;
let dirty = false;
let saving = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let restoring = false;

export type BackupState = { savedAt: string | null; problem: string | null; restoredFrom: string | null };
let state: BackupState = { savedAt: null, problem: null, restoredFrom: null };
const listeners = new Set<() => void>();
const set = (next: Partial<BackupState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

/** When this computer last got a copy, and whether the app was just put back from one. */
export const useLocalBackup = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => state,
    () => state,
  );

const url = () => `/api/local-backup?team=${currentTeam()}`;

function changed() {
  if (restoring) return;
  dirty = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void save(), SAVE_AFTER_MS);
}

async function save() {
  timer = null;
  if (!dirty || saving || restoring) return;
  saving = true;
  dirty = false;
  try {
    const file = await buildProjectFile();
    // A browser holding no saved scene (just wiped, its copy not yet put back — or another browser on this
    // computer with a stray setting or two) never replaces a copy: the work is in the scenes.
    if (!(file.db.projects?.length ?? 0)) return;
    const res = await fetch(url(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(file),
    });
    if (res.status === 501) return; // a hosted copy: nowhere to keep it
    if (!res.ok)
      throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
    set({ savedAt: new Date().toISOString(), problem: null });
  } catch (err) {
    dirty = true;
    set({
      problem: `This computer’s backup couldn’t be saved: ${err instanceof Error ? err.message : 'unknown problem'}`,
    });
  } finally {
    saving = false;
    if (dirty && !timer) timer = setTimeout(() => void save(), SAVE_AFTER_MS * 4);
  }
}

/**
 * Whether this browser has forgotten the app's work: no saved scenes. (The other stores aren't a guide:
 * thumbnails and folder handles land in the media store as soon as the page opens.)
 */
async function browserIsEmpty(): Promise<boolean> {
  const db = await openDb();
  try {
    const count = (store: string) =>
      new Promise<number>((resolve, reject) => {
        const r = db.transaction(store, 'readonly').objectStore(store).count();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    return (await count('projects')) === 0;
  } finally {
    db.close();
  }
}

/**
 * Starts keeping this computer's copy: first, if the browser has forgotten everything and a copy is
 * there, puts it back (the page reloads); then saves a fresh copy a few seconds after each change.
 * Call once, when the app opens.
 */
export async function startLocalBackup(): Promise<void> {
  if (started || typeof window === 'undefined') return;
  started = true;

  // Just put back (the page reloaded after it): say so, once.
  try {
    const restored = sessionStorage.getItem(NOTE_KEY);
    if (restored) {
      sessionStorage.removeItem(NOTE_KEY);
      set({ restoredFrom: restored });
    }
  } catch {
    // No session storage: no note.
  }

  try {
    if (!state.restoredFrom && (await browserIsEmpty())) {
      const res = await fetch(url(), { cache: 'no-store' });
      if (res.ok) {
        const file = await readProjectFile(new File([await res.blob()], 'backup.json'));
        if ((file.db.projects?.length ?? 0) > 0) {
          restoring = true;
          try {
            sessionStorage.setItem(NOTE_KEY, file.exportedAt);
          } catch {
            // As above.
          }
          await importProject(file); // reloads the page
          return;
        }
      }
    }
  } catch (err) {
    restoring = false;
    set({
      problem: `This computer’s backup couldn’t be read back: ${err instanceof Error ? err.message : 'unknown problem'}`,
    });
  }

  // From here on, every change is kept: the database's writes, and settings (localStorage).
  onDbWrite(changed);
  const proto = Storage.prototype;
  const setItem = proto.setItem;
  const removeItem = proto.removeItem;
  proto.setItem = function (this: Storage, key: string, value: string) {
    setItem.call(this, key, value);
    if (this === window.localStorage) changed();
  };
  proto.removeItem = function (this: Storage, key: string) {
    removeItem.call(this, key);
    if (this === window.localStorage) changed();
  };
  // A first copy now, so there is one even before anything changes.
  changed();
  // Leaving the page (or quitting Chrome): save what's waiting, if it can be done in time.
  window.addEventListener('pagehide', () => {
    if (dirty) void save();
  });
}
