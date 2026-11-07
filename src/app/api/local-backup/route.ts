import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isHosted } from '@/lib/serverKeys';

// This computer's copy of everything the app keeps in the browser (see localBackup.ts): the same file
// as Export Project, written here as work changes, so a browser that forgets its storage (an
// ephemeral Chrome profile, cleared site data) gets it back. One file per team, in the app's folder
// (.local-backup/, not in git). Only when the app runs on this computer, and only from its own page.

const DIR = path.join(process.cwd(), '.local-backup');
const LARGEST = 500 * 1024 ** 2; // 500 MB (music files are in it)
const fileFor = (team: string) =>
  path.join(DIR, `team-${team === 'AE' || team === 'Graham' ? team : 'ED'}.json`);

const sameSite = (req: Request) => {
  const origin = req.headers.get('origin');
  return Boolean(origin && new URL(origin).host === req.headers.get('host'));
};

export async function GET(req: Request) {
  if (isHosted) return Response.json({ hosted: true }, { status: 501 });
  const team = new URL(req.url).searchParams.get('team') ?? 'ED';
  try {
    const text = await readFile(fileFor(team), 'utf8');
    return new Response(text, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ none: true }, { status: 404 });
  }
}

export async function PUT(req: Request) {
  if (isHosted) return Response.json({ hosted: true }, { status: 501 });
  if (!sameSite(req)) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  if (Number(req.headers.get('content-length') ?? 0) > LARGEST)
    return Response.json({ error: 'Too big to keep.' }, { status: 413 });
  const team = new URL(req.url).searchParams.get('team') ?? 'ED';
  const text = await req.text();
  try {
    const data = JSON.parse(text) as { format?: string; db?: { projects?: unknown[] } };
    if (data.format !== 'chatbot-designer-project') throw new Error();
    // No saved scene: a browser that has forgotten its work (or never had any) — the copy here stays.
    if (!data.db?.projects?.length) return Response.json({ kept: true, reason: 'no scenes' });
  } catch {
    return Response.json({ error: 'That isn’t a project file.' }, { status: 400 });
  }
  await mkdir(DIR, { recursive: true });
  const file = fileFor(team);
  // Written beside it, then moved into place: a half-written backup never replaces a whole one. The one
  // before is kept as .previous.json.
  const temp = `${file}.writing`;
  await writeFile(temp, text, 'utf8');
  await rename(file, file.replace(/\.json$/, '.previous.json')).catch(() => undefined);
  await rename(temp, file);
  return Response.json({ ok: true, savedAt: new Date().toISOString(), bytes: text.length });
}
