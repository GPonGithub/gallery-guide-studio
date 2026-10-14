import { sendHeldCues } from '@/lib/agent/runtime';
import type { AgentFlow, CuePayload } from '@/lib/agent/types';

// Sends the TouchDesigner cues of a turn that was worked out early (with its
// cues held) the moment the app starts using that turn.
export async function POST(req: Request) {
  const { flow, payloads } = (await req.json()) as { flow: AgentFlow; payloads: CuePayload[] };
  return Response.json({ statuses: await sendHeldCues(flow, payloads) });
}
