import { deleteProject, listProjects, saveProject, type AgentProject } from '@/lib/agent/projectStore';
import { isHosted } from '@/lib/serverKeys';

// Projects are for the computer running the app only. The Cloudflare tunnel
// used for phone testing is public, and every request it relays carries
// cf-connecting-ip — a direct localhost request never does.
// (Also off on a hosted copy: there, projects live in each student's browser.)
function fromTunnel(req: Request) {
  return isHosted || req.headers.has('cf-connecting-ip');
}
const forbidden = () => Response.json({ error: 'Projects are only available on the computer running the app.' }, { status: 403 });

export function GET(req: Request) {
  if (fromTunnel(req)) return forbidden();
  return Response.json({ projects: listProjects() });
}

export async function POST(req: Request) {
  if (fromTunnel(req)) return forbidden();
  const body = (await req.json()) as Partial<AgentProject>;
  if (!body.name?.trim() || !body.flow) return Response.json({ error: 'A project needs a name and a flow.' }, { status: 400 });
  const project = saveProject({
    id: body.id,
    name: body.name.trim(),
    flow: body.flow,
    brief: body.brief ?? '',
    boardUrl: body.boardUrl ?? '',
    voice: body.voice,
    music: body.music ?? null,
  });
  return Response.json({ project });
}

export function DELETE(req: Request) {
  if (fromTunnel(req)) return forbidden();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });
  return Response.json({ deleted: deleteProject(id) });
}
