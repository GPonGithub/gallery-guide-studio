import { blockedMemory } from '@/lib/agent/runtime';
import type { RememberedItem } from '@/lib/agent/types';

export const maxDuration = 30;

// Works out which of a patient's remembered items a scene isn't allowed to
// use, so the app can leave them out of everything it sends the agent.
export async function POST(req: Request) {
  const { cannotUse, items, anthropicApiKey } = (await req.json()) as {
    cannotUse?: string;
    items?: RememberedItem[];
    anthropicApiKey?: string;
  };
  try {
    return Response.json({ blocked: await blockedMemory(cannotUse ?? '', items ?? [], anthropicApiKey ?? '') });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Couldn’t check the restrictions.' }, { status: 500 });
  }
}
