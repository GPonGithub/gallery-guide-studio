import { copyMusic, getProject, readMusic, writeMusic } from '@/lib/agent/projectStore';

export const maxDuration = 60;

// A project's background music file: PUT stores it (raw bytes), GET plays it
// back, POST ?from=<id> copies another project's (for "Save as copy").
// Like the rest of projects, only for the computer running the app.
const MAX_BYTES = 50 * 1024 * 1024;

function fromTunnel(req: Request) {
  return req.headers.has('cf-connecting-ip');
}
const forbidden = () => Response.json({ error: 'Projects are only available on the computer running the app.' }, { status: 403 });

const TYPES: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg' };

export async function PUT(req: Request) {
  if (fromTunnel(req)) return forbidden();
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!getProject(id)) return Response.json({ error: 'Save the project first.' }, { status: 404 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) return Response.json({ error: 'No music file was sent.' }, { status: 400 });
  if (bytes.length > MAX_BYTES) return Response.json({ error: 'That music file is over 50 MB.' }, { status: 413 });
  if (!writeMusic(id, bytes)) return Response.json({ error: 'Bad project id.' }, { status: 400 });
  return Response.json({ ok: true });
}

export async function POST(req: Request) {
  if (fromTunnel(req)) return forbidden();
  const params = new URL(req.url).searchParams;
  const ok = copyMusic(params.get('from') ?? '', params.get('id') ?? '');
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}

export function GET(req: Request) {
  if (fromTunnel(req)) return forbidden();
  const id = new URL(req.url).searchParams.get('id') ?? '';
  const project = getProject(id);
  const bytes = project?.music ? readMusic(id) : null;
  if (!project?.music || !bytes) return Response.json({ error: 'This project has no music file.' }, { status: 404 });
  const ext = project.music.name.split('.').pop()?.toLowerCase() ?? '';
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': TYPES[ext] ?? 'audio/mpeg', 'Cache-Control': 'no-store' },
  });
}
