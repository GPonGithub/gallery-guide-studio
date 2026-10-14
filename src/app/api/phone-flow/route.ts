import { getPhoneFlow, setPhoneFlow } from '@/lib/phoneFlowStore';
import type { PhonePayload } from '@/lib/phonePayload';

// Read by the iPhone app (through the Cloudflare tunnel), written only by
// the computer. The tunnel URL is public, so anyone holding it could
// otherwise overwrite what the phone runs — Cloudflare stamps every request
// it relays with cf-connecting-ip, which a direct localhost request never
// carries, so that's the line between "the computer" and "anyone else".
export async function POST(req: Request) {
  if (req.headers.has('cf-connecting-ip')) {
    return Response.json({ error: 'Flows can only be sent from the computer running the app.' }, { status: 403 });
  }
  const flow = (await req.json()) as PhonePayload;
  if (!Array.isArray(flow?.boxes) || flow.boxes.length === 0) {
    return Response.json({ error: 'No playbooks to send' }, { status: 400 });
  }
  const { sentAt } = setPhoneFlow(flow);
  return Response.json({ sentAt });
}

export function GET() {
  return Response.json(getPhoneFlow() ?? { flow: null, sentAt: null });
}
