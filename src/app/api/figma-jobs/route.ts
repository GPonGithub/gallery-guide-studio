import { createJob, claimNextJob, type FigmaJobKind } from '@/lib/figmaJobStore';

// Called from two different origins: the app itself (same-origin POST to
// queue a job) and the FigJam plugin's UI iframe (cross-origin GET to poll
// for one) — a different origin than this localhost dev server every time,
// and never with cookies/credentials attached, so a wildcard is the
// correct, simplest answer rather than trying to match Figma's iframe
// origin exactly.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const { kind, payload } = (await req.json()) as {
    kind?: FigmaJobKind;
    payload?: unknown;
  };
  const job = createJob(kind ?? 'generate', payload);
  return Response.json({ id: job.id }, { headers: CORS_HEADERS });
}

// Polled by the plugin's UI: `?claim=1` atomically takes the oldest pending
// job, if any.
export async function GET(req: Request) {
  const claim = new URL(req.url).searchParams.has('claim');
  if (!claim) {
    return Response.json({ error: 'claim query param is required' }, { status: 400, headers: CORS_HEADERS });
  }
  const job = claimNextJob();
  return Response.json({ job }, { headers: CORS_HEADERS });
}
