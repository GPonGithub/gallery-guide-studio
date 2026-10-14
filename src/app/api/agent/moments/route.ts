import { runMoments } from '@/lib/agent/runtime';
import type { AgentFlow, SessionState } from '@/lib/agent/types';

export const maxDuration = 30;

// Checked after the reply is already on screen and being spoken — see runMoments.
export async function POST(req: Request) {
  const body = (await req.json()) as {
    flow: AgentFlow;
    state: SessionState;
    userText: string | null;
    reply: string;
    anthropicApiKey: string;
  };
  try {
    return Response.json({ events: await runMoments(body) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Moment check failed.' }, { status: 500 });
  }
}
