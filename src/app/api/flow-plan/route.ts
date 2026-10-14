import { anthropicModel } from '@/lib/anthropicModel';
import { getFlowPlans, needsPlan } from '@/lib/flowPlan';

export const maxDuration = 60;

type Body = {
  boxes: { id: string; label: string; steps: { id: string; option: 'BOT' | 'USER' | 'NAV'; instruction: string; navTarget?: string; variable?: string }[] }[];
  anthropicApiKey?: string;
};

// Works out (or returns the cached) smart-jump plans for a whole flow — the
// same cache /api/chat reads from. Called by the studio to show the plans
// in Flow Snapshot for review, and on "Send to iPhone app" so the phone's
// first trip into a looping playbook doesn't wait on it.
export async function POST(req: Request) {
  const { boxes, anthropicApiKey } = (await req.json()) as Body;
  const needing = boxes.filter(needsPlan).length;
  const plans = await getFlowPlans(anthropicModel(anthropicApiKey), boxes);
  return Response.json({ plans, failed: needing - Object.keys(plans).length });
}
