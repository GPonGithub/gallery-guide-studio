import { generateText, Output } from 'ai';
import { z } from 'zod';
import { anthropicModel } from '@/lib/anthropicModel';

export const maxDuration = 30;

// Decides which "once, when…" media actions (row 8 of the sheet) the latest
// exchange of the conversation has triggered — in any wording or language.
// An action can say when to show something and when to take it away again
// ("Show the picture of Maya when the nurse asks to see it, remove it when
// the nurse asks"), so each is told whether its media is showing now.

const FAST_MODEL = 'claude-haiku-4-5-20251001';

export type MomentAction = { line: string; showing: boolean };
export type MomentResult = { line: string; do: 'show' | 'remove' };

const schema = z.object({
  triggered: z.array(
    z.object({
      action: z.number().describe('The number of the action, as given'),
      do: z.enum(['show', 'remove']),
    }),
  ),
});

const SYSTEM = `You watch a voice-call role play in an immersive room and decide when media actions happen. Each action says what to show or play and the moment it happens, and may also say when to remove it. They may be in any language or wording.

You get the actions (each marked SHOWING if its media is showing now, or NOT SHOWING), then the latest exchange: what the agent said just before (if anything), what the caller said, and what the agent replied (if it has replied yet).

List an action with do "show" when the moment it describes for showing/playing clearly happened in this exchange and it is NOT SHOWING. List it with do "remove" when the moment it describes for removing clearly happened and it is SHOWING. An action that only says when to show is never removed. Requests count however they are phrased ("can I see her?", "do you have a photo?"). Only list what clearly happened in this exchange — not things that happened earlier or might happen later. Return an empty list if nothing happened.

When the caller's line is marked ALREADY CHECKED, it was judged on its own a moment ago: it is only there so you understand the reply. Then list only what the agent's reply itself makes happen (e.g. the agent offering to show the picture, or saying it is putting it away).`;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    actions?: MomentAction[];
    before?: string | null;
    caller?: string | null;
    reply?: string | null;
    /** The caller's line was checked on its own already: with the reply, it's only context. */
    callerChecked?: boolean;
    anthropicApiKey?: string;
  };
  const actions = (body.actions ?? []).filter((a) => a?.line?.trim()).slice(0, 40);
  if (actions.length === 0 || !(body.caller?.trim() || body.reply?.trim())) return Response.json({ triggered: [] });
  try {
    const { output } = await generateText({
      model: anthropicModel(body.anthropicApiKey, FAST_MODEL),
      providerOptions: { anthropic: { thinking: { type: 'disabled' } } },
      temperature: 0,
      system: SYSTEM,
      prompt: [
        `ACTIONS:\n${actions.map((a, i) => `${i + 1}. [${a.showing ? 'SHOWING' : 'NOT SHOWING'}] ${a.line.trim()}`).join('\n')}`,
        body.before?.trim() ? `AGENT (just before): ${body.before.trim()}` : '',
        body.caller?.trim() ? `CALLER${body.callerChecked ? ' (ALREADY CHECKED)' : ''}: ${body.caller.trim()}` : '',
        body.reply?.trim() ? `AGENT (reply): ${body.reply.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      output: Output.object({ schema }),
      maxOutputTokens: 300,
    });
    const triggered: MomentResult[] = output.triggered.flatMap((t) => {
      const a = actions[t.action - 1];
      if (!a || (t.do === 'show') === a.showing) return [];
      return [{ line: a.line, do: t.do }];
    });
    return Response.json({ triggered });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'The moments couldn’t be checked.' },
      { status: 500 },
    );
  }
}
