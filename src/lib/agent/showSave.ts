'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { sortStages } from './flow';
import { listProjects } from './localProjects';
import { mediaDemoOn } from './mediaDemo';
import { loadLibrary, loadMediaLinks, type MediaFolder, type MediaLink, type StoredLibrary } from './mediaFolder';
import { buildShow, SHOW_FILE_NAME, showText, type SceneInfo, type Show } from './showFile';

/**
 * Keeping show.json in the media folder up to date (see showFile.ts): written
 * a moment after each change to the connections or the library, once the
 * browser has been allowed to save there (Allow saving — it asks once).
 */

export type SaveStatus =
  | { state: 'off' }
  | { state: 'needs-permission' }
  | { state: 'saving' }
  | { state: 'saved'; at: number }
  | { state: 'error'; message: string };

let status: SaveStatus = { state: 'off' };
const listeners = new Set<() => void>();
const setStatus = (next: SaveStatus) => {
  status = next;
  listeners.forEach((l) => l());
};
export const useShowSaveStatus = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => status,
    () => status,
  );

/** Every scene from the sheet (archived ones left out), with its stages in order. */
export async function sceneInfos(): Promise<SceneInfo[]> {
  const projects = await listProjects();
  return projects
    .filter((p) => !p.archived && p.sheet)
    .map((p) => ({
      sheetId: p.sheet!.sheetId,
      number: p.sheet!.number,
      name: p.name,
      stages: sortStages(p.flow.stages).map((s) => ({
        code: s.code,
        name: s.name,
        ...(s.goal.trim() && { goal: s.goal.trim() }),
      })),
    }));
}

/** The show as it stands now. */
export async function currentShow(): Promise<Show> {
  const [library, links, scenes] = await Promise.all([loadLibrary(), loadMediaLinks(), sceneInfos()]);
  return buildShow(library?.folderName ?? '', library?.assets ?? [], links, scenes);
}

/** Whether the app may write into the folder — asking if `ask` (only from a click). */
export async function canWrite(folder: MediaFolder, ask: boolean): Promise<boolean> {
  if ((await folder.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return ask && (await folder.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Writes show.json into the media folder (if allowed — `ask` only from a click). */
export async function saveShowToFolder(folder: MediaFolder, ask = false): Promise<boolean> {
  if (mediaDemoOn()) return false; // the tour's demo folder is never written to
  if (!(await canWrite(folder, ask))) {
    setStatus({ state: 'needs-permission' });
    return false;
  }
  setStatus({ state: 'saving' });
  try {
    const text = showText(await currentShow());
    const handle = await folder.getFileHandle(SHOW_FILE_NAME, { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    setStatus({ state: 'saved', at: Date.now() });
    return true;
  } catch (err) {
    setStatus({ state: 'error', message: err instanceof Error ? err.message : 'The show file couldn’t be saved.' });
    return false;
  }
}

const SAVE_DELAY_MS = 1500;

/**
 * Saves show.json a moment after the connections or the library change (and
 * once when the folder is first known). Nothing is asked for here: without
 * permission the status says so, and Allow saving asks.
 */
export function useShowAutosave(folder: MediaFolder | null, library: StoredLibrary | null, links: MediaLink[]) {
  useEffect(() => {
    if (!folder) {
      setStatus({ state: 'off' });
      return;
    }
    if (mediaDemoOn()) return;
    const timer = setTimeout(() => void saveShowToFolder(folder), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [folder, library, links]);
}

/** Downloads the show as a file (Save a Copy). */
export async function downloadShow() {
  const show = await currentShow();
  const url = URL.createObjectURL(new Blob([showText(show)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = SHOW_FILE_NAME;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
