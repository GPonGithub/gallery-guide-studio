import { claimNextJob, createJob, figjamStoreReady, pluginLastSeen, queueFor, type FigmaJobKind } from '@/lib/figmaJobStore';
import { isHosted } from '@/lib/serverKeys';

// Called from two places: the app (queue a job, or ask whether the plugin is
// there) and the FigJam plugin's panel (poll for a job) — a different origin
// every time, never with cookies, so a wildcard is the simple right answer.
// On a hosted copy each request carries its connection code (see
// figmaJobStore); on your own computer the code is ignored.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS_HEADERS });

/** Why a hosted copy can't take this request, if it can't. */
function hostedProblem(queue: string | null): string | null {
  if (!isHosted) return null;
  if (!figjamStoreReady()) return 'FigJam isn’t set up on this hosted copy yet: it needs its job store (see HOSTING.md).';
  if (!queue) return 'Missing connection code — type the code shown in Chatbot Designer (section 6) into the plugin.';
  return null;
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const { kind, payload, code } = (await req.json()) as { kind?: FigmaJobKind; payload?: unknown; code?: string };
  const queue = queueFor(code);
  const problem = hostedProblem(queue);
  if (problem) return json({ error: problem }, 400);
  try {
    const job = await createJob(queue!, kind ?? 'generate', payload);
    return json({ id: job.id });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'The job couldn’t be queued.' }, 502);
  }
}

// `?status=1&code=…` — the app asking whether its plugin is there (claims nothing).
// `?claim=1&code=…` — the plugin taking the oldest pending job, if any.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const queue = queueFor(params.get('code'));
  const problem = hostedProblem(queue);
  try {
    if (params.has('status')) {
      if (problem) return json({ pluginLastSeenMsAgo: null, problem });
      const seen = await pluginLastSeen(queue!);
      return json({ pluginLastSeenMsAgo: seen === null ? null : Date.now() - seen });
    }
    if (!params.has('claim')) return json({ error: 'claim query param is required' }, 400);
    if (problem) return json({ error: problem }, 400);
    return json({ job: await claimNextJob(queue!) });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'The job store couldn’t be reached.' }, 502);
  }
}
