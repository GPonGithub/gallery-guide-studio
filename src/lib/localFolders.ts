import { readdir, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Server side: media folders on this computer, linked by where they are on disk (2026-11-25) — so a scene's
 * folder stays linked when the browser restarts, forgets its storage, or the project is exported and imported
 * again (a browser's own folder link can't be kept in a file). Only folders inside the work folders below are
 * ever read or written.
 */

const HOME = os.homedir();
export const LOCAL_ROOTS = [
  path.join(HOME, 'Documents', '2026 Fall Student Work'),
  path.join(HOME, 'Documents', '2026 Grahams Work', 'Fall 2026 Grahams Work'),
];

const inside = (p: string, root: string) => p === root || p.startsWith(root + path.sep);

/** The real path of `p` if it's inside one of the work folders (no `..`, no links out), else null. */
export async function safeLocalPath(p: string | null): Promise<string | null> {
  if (!p || !path.isAbsolute(p)) return null;
  const resolved = path.resolve(p);
  if (!LOCAL_ROOTS.some((r) => inside(resolved, r))) return null;
  try {
    const real = await realpath(resolved);
    const roots = await Promise.all(LOCAL_ROOTS.map((r) => realpath(r).catch(() => r)));
    return roots.some((r) => inside(real, r)) ? real : null;
  } catch {
    return null;
  }
}

/** Where a new file may go: its folder must be a safe, existing folder; the name a plain file name. */
export async function safeNewFilePath(p: string | null): Promise<string | null> {
  if (!p || !path.isAbsolute(p)) return null;
  const dir = await safeLocalPath(path.dirname(p));
  const name = path.basename(p);
  if (!dir || !name || name.startsWith('.') || name.includes('/')) return null;
  return path.join(dir, name);
}

const SKIP = new Set(['node_modules', 'Json Project Files', 'Backup']);

/**
 * Folders named `name` inside the work folders (up to four levels down), the team's own first: a scene's
 * folder found from the name its media list was made with. `team` is "Team AE", "Team ED" or "Graham".
 */
export async function findLocalFolders(name: string, team: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name) || e.name.startsWith('Originals before ')) continue;
      const full = path.join(dir, e.name);
      if (e.name === name) found.push(full);
      if (depth < 4) await walk(full, depth + 1);
    }
  };
  for (const root of LOCAL_ROOTS) await walk(root, 1);
  const own = (p: string) =>
    team === 'Graham' ? inside(p, LOCAL_ROOTS[1]) : p.split(path.sep).includes(team);
  return [...found.filter(own), ...found.filter((p) => !own(p))];
}

export async function isFolder(p: string): Promise<boolean> {
  return (await stat(p).catch(() => null))?.isDirectory() ?? false;
}
