import { createReadStream } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { findLocalFolders, isFolder, safeLocalPath, safeNewFilePath } from '@/lib/localFolders';
import { isHosted } from '@/lib/serverKeys';

// A scene's media folder read by where it is on this computer (see lib/localFolders.ts and
// lib/agent/localFolder.ts): its list of files and folders, a file, the folders with a given name, and
// writing show.json. Only when the app runs on this computer, only from the app's own page, and only
// inside the work folders.
//   GET ?op=list&path=…   GET ?op=file&path=…   GET ?op=find&name=…&team=…   PUT ?path=… (body = the file)

const ownPage = (req: Request) => {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.get('origin');
  return !origin || new URL(origin).host === req.headers.get('host');
};

const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', json: 'application/json',
};

export async function GET(req: Request) {
  if (isHosted) return Response.json({ error: 'Only when the app runs on this computer.' }, { status: 501 });
  if (!ownPage(req)) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  const url = new URL(req.url);
  const op = url.searchParams.get('op');

  if (op === 'ping') return Response.json({ ok: true });
  if (op === 'find') {
    const name = (url.searchParams.get('name') ?? '').trim();
    if (!name || name.includes('/')) return Response.json({ folders: [] });
    return Response.json({ folders: await findLocalFolders(name, url.searchParams.get('team') ?? '') });
  }

  const p = await safeLocalPath(url.searchParams.get('path'));
  if (!p) return Response.json({ error: 'Not a folder this app may read.' }, { status: 404 });

  if (op === 'list') {
    if (!(await isFolder(p))) return Response.json({ error: 'Not a folder.' }, { status: 404 });
    const entries = await readdir(p, { withFileTypes: true });
    return Response.json({
      entries: entries
        .filter((e) => e.isDirectory() || e.isFile())
        .map((e) => ({ name: e.name, kind: e.isDirectory() ? 'directory' : 'file' })),
    });
  }

  if (op === 'file') {
    const info = await stat(p).catch(() => null);
    if (!info?.isFile()) return Response.json({ error: 'No such file.' }, { status: 404 });
    const ext = path.extname(p).slice(1).toLowerCase();
    const type = TYPES[ext] ?? 'application/octet-stream';
    return new Response(Readable.toWeb(createReadStream(p)) as ReadableStream, {
      headers: {
        'Content-Type': type,
        'Content-Length': String(info.size),
        'Last-Modified': info.mtime.toUTCString(),
        'Cache-Control': 'no-store',
      },
    });
  }
  return Response.json({ error: 'Unknown request.' }, { status: 400 });
}

const LARGEST = 20 * 1024 ** 2; // 20 MB: show.json and the like, not media

export async function PUT(req: Request) {
  if (isHosted) return Response.json({ error: 'Only when the app runs on this computer.' }, { status: 501 });
  if (!ownPage(req) || !req.headers.get('origin')) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  const p = await safeNewFilePath(new URL(req.url).searchParams.get('path'));
  if (!p) return Response.json({ error: 'Not a place this app may write.' }, { status: 403 });
  const body = Buffer.from(await req.arrayBuffer());
  if (body.length > LARGEST) return Response.json({ error: 'Too big.' }, { status: 413 });
  await writeFile(p, body);
  return Response.json({ ok: true });
}
