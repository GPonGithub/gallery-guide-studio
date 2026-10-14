'use client';

/**
 * The working copy of the open project's music file, kept in this browser
 * (IndexedDB — an MP3 is far too big for localStorage) so it survives a
 * reload before the project is saved. Saving the project stores the file
 * with the project on this computer (see /api/agent/projects/music). If
 * browser storage is blocked, the file is fetched from the project instead.
 */

const DB_NAME = 'goal-agent-studio';
const STORE = 'music';
const KEY = 'background';

/** `key` identifies this particular file (a new one is made for every file dropped in). */
export type StoredTrack = { name: string; key: string; blob: Blob };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function loadTrack(): Promise<StoredTrack | null> {
  try {
    return (await run<StoredTrack | undefined>('readonly', (store) => store.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

export async function saveTrack(track: StoredTrack): Promise<boolean> {
  try {
    await run('readwrite', (store) => store.put(track, KEY));
    return true;
  } catch {
    return false;
  }
}

/**
 * Music dropped in before music belonged to projects has no key. Gives it
 * one — in a single transaction, so two calls at once (React runs startup
 * effects twice in development) can't hand out two different keys. Returns
 * the track's name and key if it was such a track, otherwise null.
 */
export async function adoptKeylessTrack(): Promise<{ name: string; key: string } | null> {
  try {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
        const read = store.get(KEY);
        read.onerror = () => reject(read.error);
        read.onsuccess = () => {
          const track = read.result as StoredTrack | undefined;
          if (!track || track.key) return resolve(null);
          const key = crypto.randomUUID();
          const write = store.put({ ...track, key }, KEY);
          write.onerror = () => reject(write.error);
          write.onsuccess = () => resolve({ name: track.name, key });
        };
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function clearTrack(): Promise<void> {
  try {
    await run('readwrite', (store) => store.delete(KEY));
  } catch {
    // Nothing stored, or storage blocked — either way it's gone.
  }
}
