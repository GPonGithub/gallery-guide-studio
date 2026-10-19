import { generateText, Output } from 'ai';
import { z } from 'zod';
import { anthropicModel } from '@/lib/anthropicModel';
import type { ActionReading } from '@/lib/agent/media';

export const maxDuration = 60;

// Reads what each media action (a line from row 8 of the sheet) means — in
// any wording or language — so students don't have to use set phrases: when
// it plays (once at a moment, every time something happens, throughout the
// scene, at the start, at the end), and for "every time" ones, when and what
// the voice does. If an action could mean more than one thing, it says so and
// suggests the likely choices, for the student to pick from.

const FAST_MODEL = 'claude-haiku-4-5-20251001';
const KINDS = ['once', 'every', 'throughout', 'start', 'end'] as const;

const readingSchema = z.object({
  readings: z.array(
    z.object({
      line: z.number().describe('The number of the action, as given'),
      kind: z.enum(KINDS),
      when: z
        .enum(['before-reply', 'reply-start', 'after-reply', 'caller-speaks'])
        .optional()
        .describe('Only for kind "every": the repeating event it follows'),
      voice: z
        .enum(['wait', 'over'])
        .optional()
        .describe('Only for kind "every" with when "before-reply": does the chatbot wait for it to finish before speaking'),
      loop: z
        .boolean()
        .optional()
        .describe('Only for kind "once": true if it should keep looping/repeating until removed, false if it plays once'),
      clear: z.boolean().describe('false if the action could reasonably mean more than one kind'),
      options: z.array(z.enum(KINDS)).optional().describe('When not clear: the 2–3 likely kinds, most likely first'),
    }),
  ),
});

const SYSTEM = `You read the media actions students write for a chatbot scene in an immersive room. Each action says what media to play or show, and when. They may be written in any language, in any wording, with typos.

For each action decide WHEN it happens:
- "once": at one particular moment in the conversation (e.g. "when the nurse asks to see it", "when the patient mentions pain", "when the user asks"). Showing something and later removing it is still "once".
  Then "loop": true if it should keep looping or repeating until it's removed ("loop the video when…", "play it on repeat when…", "keep playing"), false if it plays once.
- "every": each time a repeating event happens (e.g. "every time before you speak", "after each reply", "whenever the caller talks").
  Then "when" is: before-reply (just before the chatbot speaks), reply-start (as the chatbot starts speaking), after-reply (after it finishes), or caller-speaks (when the caller/visitor/patient speaks).
  And for before-reply, "voice": wait (the chatbot waits for the sound to finish — the usual meaning of "before you speak") or over (they overlap).
- "throughout": for the whole scene, continuously — background music, ambience, a soundscape, "during the scene", "loop", "the whole time".
- "start": once, when the call/scene begins ("at the start", "to open the scene", "when the call begins").
- "end": once, when the call/scene ends ("at the end", "to close", "when the call finishes").

Set clear to false only when a careful reader could honestly take it more than one way (e.g. "play the chime" with no timing at all, or "play music at the start" which could mean only at the start or from the start throughout), and give the likely options, most likely first. Otherwise clear is true.`;

export async function POST(req: Request) {
  const { actions, anthropicApiKey } = (await req.json().catch(() => ({}))) as {
    actions?: string[];
    anthropicApiKey?: string;
  };
  const lines = (actions ?? []).map((a) => String(a).trim()).filter(Boolean).slice(0, 40);
  if (lines.length === 0) return Response.json({ readings: {} });
  try {
    const { output } = await generateText({
      model: anthropicModel(anthropicApiKey, FAST_MODEL),
      providerOptions: { anthropic: { thinking: { type: 'disabled' } } },
      temperature: 0,
      system: SYSTEM,
      prompt: lines.map((line, i) => `${i + 1}. ${line}`).join('\n'),
      output: Output.object({ schema: readingSchema }),
      maxOutputTokens: 1500,
    });
    const readings: Record<string, ActionReading> = {};
    for (const r of output.readings) {
      const line = lines[r.line - 1];
      if (!line) continue;
      readings[line] = {
        kind: r.kind,
        clear: r.clear,
        ...(r.kind === 'every' && r.when && { when: r.when }),
        ...(r.kind === 'every' && r.voice && { voice: r.voice }),
        ...(r.kind === 'once' && r.loop !== undefined && { loop: r.loop }),
        ...(!r.clear && r.options?.length && { options: [...new Set([r.kind, ...r.options])] }),
      };
    }
    return Response.json({ readings });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'The actions couldn’t be read.' }, { status: 500 });
  }
}
