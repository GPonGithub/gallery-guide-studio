'use client';

import { openDb, STORES } from './browserDb';
import { currentTeam, isTeamControlKey, teamFileTag, teamImportProblem, type Team } from './team';

/**
 * Export Project / Import Project: everything this team has in this browser, in one file — every
 * scene and conversation, voices and music, patients and what their scenes saved, the media library,
 * connections and timeline, layout and settings — so work can carry on later or on another computer.
 *
 * API keys (Anthropic, ElevenLabs, Figma) are carried in the file (since 2026-11-21, so a project opens
 * ready to use without typing them again): on import, the file's keys are saved in this browser; a key the
 * file doesn't have keeps the one already here. Treat an exported file like a password — share it only
 * with the team. The lab Mac's automatic backup (localBackup.ts) carries them the same way.
 *
 * Left out: the media folder's permission (the browser can't move it — choose the folder again; IDs and
 * connections carry over), and video thumbnails (made again as needed).
 */

const FORMAT = 'chatbot-designer-project';
const VERSION = 1;
/** Settings fields that are API keys: carried in the file; on import a blank one keeps this browser's. */
const isKeyField = (name: string) => /apikey$/i.test(name);
/**
 * Database entries not carried: the browser's own folder links (one per scene — they can't go in a file),
 * video thumbnails, a tour demo's backup. A folder linked by its place on this computer (localFolder.ts,
 * `{ localPath, name }`) is carried, so an imported project has its folders attached again.
 */
const isLocalFolderRecord = (v: unknown) => typeof v === 'object' && v !== null && typeof (v as { localPath?: unknown }).localPath === 'string';
const skipEntry = (store: string, key: IDBValidKey, value: unknown) =>
  store === 'media' &&
  (key === 'folder' ||
    key === 'demo-backup' ||
    (typeof key === 'string' && (key.startsWith('thumb:') || (key.startsWith('folder:') && !isLocalFolderRecord(value)))));

type Encoded = unknown;
export type ProjectFile = {
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

/** A settings value from a project file, its blank API-key fields filled from `keep` (this browser's keys). */
function withKeys(raw: string, keep?: Record<string, string>): string {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return raw;
    let touched = false;
    const out = { ...(data as Record<string, unknown>) };
    for (const name of Object.keys(out)) {
      if (!isKeyField(name) || (typeof out[name] === 'string' && out[name])) continue;
      if (!keep?.[name]) continue;
      out[name] = keep[name];
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

/** Everything this team has in this browser, as a project file (API keys included). */
export async function buildProjectFile(): Promise<ProjectFile> {
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
    if (name && !isTeamControlKey(name)) file.localStorage[name] = localStorage.getItem(name) ?? '';
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
        if (skipEntry(store, keys[i], values[i])) continue;
        file.db[store].push({ key: keys[i], value: await encode(values[i]) });
      }
    }
  } finally {
    db.close();
  }
  return file;
}

export async function exportProject(): Promise<void> {
  const file = await buildProjectFile();
  const day = new Date().toLocaleDateString('en-CA');
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `chatbot-designer-project-${teamFileTag(file.team as Team)}-${day}.json`;
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
 * Replaces everything this team has in this browser with the project, then reloads the page. The file's
 * API keys are saved in this browser; where the file has none (an older export), this browser's stay.
 */
export async function importProject(project: ProjectFile, fileName = ''): Promise<void> {
  // Only ever into the team it was exported from (see teamImportProblem).
  const problem = teamImportProblem(project.team, fileName);
  if (problem) throw new Error(problem);
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
  // Never another team's settings, nor which team this browser is on (see isTeamControlKey).
  for (const [name, raw] of Object.entries(project.localStorage))
    if (!isTeamControlKey(name)) localStorage.setItem(name, withKeys(raw, keys[name]));
  window.location.reload();
}
