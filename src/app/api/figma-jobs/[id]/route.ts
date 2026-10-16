import { getJob, updateJob, type FigmaJobStatus } from '@/lib/figmaJobStore';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// Polled by the app (same-origin) to track progress after queuing a job.
export async function GET(_req: Request, ctx: RouteContext<'/api/figma-jobs/[id]'>) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return Response.json({ error: 'Job not found' }, { status: 404, headers: CORS_HEADERS });
  return Response.json({ job }, { headers: CORS_HEADERS });
}

// Called by the plugin's UI (cross-origin) to report progress/completion.
export async function POST(req: Request, ctx: RouteContext<'/api/figma-jobs/[id]'>) {
  const { id } = await ctx.params;
  const { status, message, result } = (await req.json()) as { status?: FigmaJobStatus; message?: string; result?: unknown };
  const job = await updateJob(id, { status, message, result });
  if (!job) return Response.json({ error: 'Job not found' }, { status: 404, headers: CORS_HEADERS });
  return Response.json({ job }, { headers: CORS_HEADERS });
}
