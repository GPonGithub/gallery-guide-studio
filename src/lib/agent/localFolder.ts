'use client';

/**
 * A scene's media folder linked by where it is on this computer (2026-11-25), not by the browser's own folder
 * link. Chrome's link has to be allowed again after every restart, is lost when the browser forgets its
 * storage, and can't be carried in an exported project; this one is just the folder's path, so it stays —
 * through restarts, a restore from this computer's backup, and Export / Import Project.
 *
 * It's read through the app's own server (/api/local-folder), so it only works when the app runs on this
 * computer, and only for folders inside the work folders (Documents/2026 Fall Student Work, and Graham's).
 * It behaves like Chrome's folder for everything the app does with one — list, open a file, write show.json.
 */

/** What's kept for a scene (under `folder:<scene>`, and in exported projects). */
export type LocalFolderRecord = { localPath: string; name: string };

export const isLocalRecord = (v: unknown): v is LocalFolderRecord =>
  typeof v === 'object' && v !== null && typeof (v as LocalFolderRecord).localPath === 'string';

const api = (params: Record<string, string>) => `/api/local-folder?${new URLSearchParams(params)}`;
const join = (dir: string, name: string) => `${dir.replace(/\/+$/, '')}/${name}`;
const baseName = (p: string) => p.replace(/\/+$/, '').split('/').pop() ?? p;

function notFound(name: string) {
  return new DOMException(`“${name}” wasn’t found.`, 'NotFoundError');
}

class LocalFile {
  readonly kind = 'file' as const;
  constructor(
    readonly localPath: string,
    readonly name = baseName(localPath),
  ) {}
  async getFile(): Promise<File> {
    const res = await fetch(api({ op: 'file', path: this.localPath }), { cache: 'no-store' });
    if (!res.ok) throw notFound(this.name);
    const blob = await res.blob();
    const modified = Date.parse(res.headers.get('last-modified') ?? '');
    return new File([blob], this.name, { type: blob.type, lastModified: Number.isFinite(modified) ? modified : Date.now() });
  }
  async createWritable() {
    const parts: BlobPart[] = [];
    const path = this.localPath;
    return {
      async write(data: BlobPart) {
        parts.push(data);
      },
      async close() {
        const res = await fetch(api({ path }), { method: 'PUT', body: new Blob(parts) });
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Couldn’t save the file.');
      },
    };
  }
  async isSameEntry(other: unknown) {
    return other instanceof LocalFile && other.localPath === this.localPath;
  }
}

export class LocalDir {
  readonly kind = 'directory' as const;
  constructor(
    readonly localPath: string,
    readonly name = baseName(localPath),
  ) {}
  private async list(): Promise<{ name: string; kind: 'file' | 'directory' }[]> {
    const res = await fetch(api({ op: 'list', path: this.localPath }), { cache: 'no-store' });
    if (!res.ok) throw notFound(this.name);
    return ((await res.json()) as { entries: { name: string; kind: 'file' | 'directory' }[] }).entries;
  }
  async *values(): AsyncIterable<LocalDir | LocalFile> {
    for (const e of await this.list())
      yield e.kind === 'directory' ? new LocalDir(join(this.localPath, e.name), e.name) : new LocalFile(join(this.localPath, e.name), e.name);
  }
  async getDirectoryHandle(name: string) {
    // Checked when it's read (a missing folder fails then, as Chrome's does here).
    return new LocalDir(join(this.localPath, name), name);
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    void options;
    return new LocalFile(join(this.localPath, name), name);
  }
  async queryPermission() {
    return 'granted' as const;
  }
  async requestPermission() {
    return 'granted' as const;
  }
  async isSameEntry(other: unknown) {
    return other instanceof LocalDir && other.localPath === this.localPath;
  }
  /** What's kept for it. */
  record(): LocalFolderRecord {
    return { localPath: this.localPath, name: this.name };
  }
}

export const localDir = (record: LocalFolderRecord) => new LocalDir(record.localPath, record.name);

/** Whether this copy of the app can read folders on this computer (it runs here, not hosted). */
let canLink: Promise<boolean> | null = null;
export function canLinkLocally(): Promise<boolean> {
  canLink ??= fetch(api({ op: 'ping' }), { cache: 'no-store' })
    .then((r) => r.ok)
    .catch(() => false);
  return canLink;
}

/**
 * The folder with this name on this computer — the team's own first ("Team AE" / "Team ED" / "Graham") —
 * or null when there's none, or more than one of the team's own and nothing tells them apart.
 */
export async function findLocalFolder(name: string, team: string): Promise<LocalDir | null> {
  if (!name || !(await canLinkLocally())) return null;
  const res = await fetch(api({ op: 'find', name, team }), { cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return null;
  const { folders } = (await res.json()) as { folders: string[] };
  if (!folders.length) return null;
  const own = folders.filter((p) => (team === 'Graham' ? p.includes('/2026 Grahams Work/') : p.split('/').includes(team)));
  const pick = own.length ? own : folders;
  return pick.length === 1 || own.length === 1 ? new LocalDir(pick[0]) : null;
}
