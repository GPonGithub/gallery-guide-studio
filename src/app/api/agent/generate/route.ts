import { generateFlow, reviseFlow } from '@/lib/agent/generate';
import type { AgentFlow } from '@/lib/agent/types';
import { withoutPauseLine } from '@/lib/agent/sentencePause';

export const maxDuration = 180;

// Designs a conversation from a description — or, given the current design
// and the description it was made from, revises just what changed.
export async function POST(req: Request) {
  const { brief: rawBrief, anthropicApiKey, knowledge, previous: rawPrevious } = (await req.json()) as {
    brief?: string;
    anthropicApiKey?: string;
    knowledge?: string;
    previous?: { brief: string; flow: AgentFlow };
  };
  if (!rawBrief?.trim()) return Response.json({ error: 'Describe the conversation first.' }, { status: 400 });
  // The pause between spoken sentences is the app's to keep (sentencePause.ts), not the designer's.
  const brief = withoutPauseLine(rawBrief);
  const previous = rawPrevious && { ...rawPrevious, brief: withoutPauseLine(rawPrevious.brief ?? '') };
  const started = Date.now();
  // In the server log: which kind of run it was, and how long it took.
  const log = (kind: string) => console.log(`[generate] ${kind} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  try {
    if (previous?.brief && previous.flow?.stages?.length) {
      const result = await reviseFlow(previous.brief, brief, previous.flow, anthropicApiKey ?? '', knowledge ?? '');
      log(previous.brief.trim() === brief.trim() ? 'unchanged — no AI call' : 'revised (only the changes)');
      return Response.json({ ...result, mode: 'revised' });
    }
    const result = await generateFlow(brief, anthropicApiKey ?? '', knowledge ?? '');
    log('full design');
    return Response.json({ ...result, mode: 'designed' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed.';
    log(`FAILED — ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}
