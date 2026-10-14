import { sendHeldCues } from '@/lib/agent/runtime';
import type { AgentFlow, SessionState } from '@/lib/agent/types';

// Sends the TouchDesigner cues of a turn that was worked out early (with its
// cues held) once the app has confirmed it's using that turn.
export async function POST(req: Request) {
  const { flow, state, cues } = (await req.json()) as {
    flow: AgentFlow;
    state: SessionState;
    cues: { name: string; trigger: string }[];
  };
  return Response.json({ statuses: await sendHeldCues(flow, state, cues) });
}
