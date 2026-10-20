'use client';

import { openDb, STORES } from './browserDb';
import { currentTeam } from './team';

/**
 * Export Project / Import Project: everything this team has in this browser, in one file — every
 * scene and conversation, voices and music, patients and what their scenes saved, the media library,
 * connections and timeline, layout and settings — so work can carry on later or on another computer.
 *
 * Left out: API keys (a project file gets passed around; on import the keys already in this browser
 * stay), the media folder's permission (the browser can't move it — choose the folder again; IDs and
 * connections carry over), and video thumbnails (made again as needed).
 */

const FORMAT = 'chatbot-designer-project';
const VERSION = 1;
/** Settings fields that are API keys: blanked on export, kept from this browser on import. */
const isKeyField = (name: string) => /apikey$/i.test(name);
/** Database entries not carried: the folder's permission, video thumbnails, a tour demo's backup. */
const skipEntry = (store: string, key: IDBValidKey) =>
  store === 'media' && (key === 'folder' || key === 'demo-backup' || (typeof key === 'string' && key.startsWith('thumb:')));

type Encoded = unknown;
type ProjectFile = {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  team: string;
  localStorage: Record<string, string>;
  db: Record<string, { key: IDBValidKey; value: Encoded }[]>;
};

// --- values in and out of JSON (files and music are kept as base64) ---------

async function encode(value: unknown): Promise<Encoded> {
  if (value instanceof Blob) {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(value);
    });
    return { __blob: true, type: value.type, name: value instanceof File ? value.name : undefined, data };
  }
  if (typeof FileSystemHandle !== 'undefined' && value instanceof FileSystemHandle) return undefined;
  if (Array.isArray(value)) return Promise.all(value.map(encode));
  if (value && typeof value === 'object') {
    const out: Record<string, Encoded> = {};
    for (const [k, v] of Object.entries(value)) out[k] = await encode(v);
    return out;
  }
  return value;
}

function decode(value: Encoded): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (v.__blob === true && typeof v.data === 'string') {
      const bytes = Uint8Array.from(atob(v.data), (c) => c.charCodeAt(0));
      const type = typeof v.type === 'string' ? v.type : '';
      return typeof v.name === 'string' ? new File([bytes], v.name, { type }) : new Blob([bytes], { type });
    }
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = decode(x);
    return out;
  }
  return value;
}

/** A settings value with its API-key fields blanked (or, with `keep`, filled from `keep`). */
function withKeys(raw: string, keep?: Record<string, string>): string {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return raw;
    let touched = false;
    const out = { ...(data as Record<string, unknown>) };
    for (const name of Object.keys(out)) {
      if (!isKeyField(name)) continue;
      out[name] = keep?.[name] ?? '';
      touched = true;
    }
    return touched ? JSON.stringify(out) : raw;
  } catch {
    return raw;
  }
}

/** This browser's API keys, by settings entry and field. */
function currentKeys(): Record<string, Record<string, string>> {
  const keys: Record<string, Record<string, string>> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const name = localStorage.key(i);
    if (!name) continue;
    try {
      const data = JSON.parse(localStorage.getItem(name) ?? '') as Record<string, unknown>;
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
      for (const [field, v] of Object.entries(data))
        if (isKeyField(field) && typeof v === 'string' && v) (keys[name] ??= {})[field] = v;
    } catch {
      // Not JSON: no keys in it.
    }
  }
  return keys;
}

// --- export ---------------------------------------------------------------

export async function exportProject(): Promise<void> {
  const file: ProjectFile = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    team: currentTeam(),
    localStorage: {},
    db: {},
  };
  // This team's settings only (localStorage is kept per team — see team.ts).
  for (let i = 0; i < localStorage.length; i++) {
    const name = localStorage.key(i);
    if (name) file.localStorage[name] = withKeys(localStorage.getItem(name) ?? '');
  }
  const db = await openDb();
  try {
    for (const store of STORES) {
      const [keys, values] = await new Promise<[IDBValidKey[], unknown[]]>((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const s = tx.objectStore(store);
        const k = s.getAllKeys();
        const v = s.getAll();
        tx.oncomplete = () => resolve([k.result, v.result]);
        tx.onerror = () => reject(tx.error);
      });
      file.db[store] = [];
      for (let i = 0; i < keys.length; i++) {
        if (skipEntry(store, keys[i])) continue;
        file.db[store].push({ key: keys[i], value: await encode(values[i]) });
      }
    }
  } finally {
    db.close();
  }
  const day = new Date().toLocaleDateString('en-CA');
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `chatbot-designer-project-team-${file.team}-${day}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// --- import ---------------------------------------------------------------

/** Reads a project file; throws a plain-English error if it isn't one. */
export async function readProjectFile(f: File): Promise<ProjectFile> {
  let data: Partial<ProjectFile>;
  try {
    data = JSON.parse(await f.text()) as Partial<ProjectFile>;
  } catch {
    throw new Error('That file isn’t a project file.');
  }
  if (data.format !== FORMAT || !data.localStorage || !data.db) throw new Error('That file isn’t a Chatbot Designer project.');
  return data as ProjectFile;
}

/**
 * Replaces everything this team has in this browser with the project, keeping this browser's API keys,
 * then reloads the page.
 */
export async function importProject(project: ProjectFile): Promise<void> {
  const keys = currentKeys();
  const db = await openDb();
  try {
    for (const store of STORES) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const s = tx.objectStore(store);
        s.clear();
        for (const { key, value } of project.db[store] ?? []) s.put(decode(value), key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  } finally {
    db.close();
  }
  // This team's settings only (localStorage.clear() is kept to the team — see team.ts).
  localStorage.clear();
  for (const [name, raw] of Object.entries(project.localStorage)) localStorage.setItem(name, withKeys(raw, keys[name]));
  window.location.reload();
}
