'use client';

/**
 * This browser's own storage for the studio (IndexedDB — big enough for
 * music files, unlike localStorage). Nothing here leaves the computer.
 *
 *   music         the open project's music file, as a working copy
 *   projects      saved projects, by id (see localProjects.ts)
 *   projectMusic  each saved project's music file, by project id
 *   patients      each patient and what their scenes have saved (see memory.ts)
 *   media         the media folder (its handle, not its files) and its media list (see mediaFolder.ts)
 */

const DB_NAME = 'goal-agent-studio';
const VERSION = 4;
export const STORES = ['music', 'projects', 'projectMusic', 'patients', 'media'] as const;
export type StoreName = (typeof STORES)[number];

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** One request against one store, in its own transaction. */
export async function run<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(storeName, mode).objectStore(storeName));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
