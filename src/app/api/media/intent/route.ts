import { generateText, Output } from 'ai';
import { z } from 'zod';
import { anthropicModel } from '@/lib/anthropicModel';
import type { ActionControl, ActionReading } from '@/lib/agent/media';

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
      controls: z
        .array(
          z.object({
            do: z.enum(['stop', 'volume']),
            target: z
              .enum(['sounds', 'visuals', 'all'])
              .optional()
              .describe('For "stop": sounds (music, soundtracks, audio), visuals (pictures, video), or all'),
            seconds: z
              .number()
              .optional()
              .describe('For "stop" of sounds: the fade-out time in seconds. 2 if it says fade without a time; 0 if it says stop or cut without fading'),
            level: z.number().optional().describe('For "volume": percent of the normal volume, 0-100 (half = 50, back to normal = 100)'),
          }),
        )
        .describe('What it does to OTHER media already playing or showing, before its own starts. Empty if nothing.'),
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

An action may also say what happens to the OTHER media already playing or showing when it happens. List these as "controls" (empty if it says nothing of the kind):
- "after fading out all soundtracks", "fade the music out first", "stop any other sounds", "silence everything else" → do "stop", target "sounds", with "seconds" (the time it gives; 2 if it fades without a time; 0 if it stops or cuts without fading).
- "remove all the pictures", "clear the screens first", "take down the other videos" → do "stop", target "visuals".
- "stop everything else", "clear the room first" → do "stop", target "all".
- "turn the music down to half", "lower the other sounds", "bring the music back up" → do "volume", with "level" in percent (half = 50, quiet ≈ 25, back to normal = 100).
Controls are only about other media: an action removing its OWN media later ("remove it when the nurse asks") is not a control. Anything about the chatbot's voice ("let the chatbot voice function as normal", "keep talking") is not a control either and does not change the kind: the voice always carries on.

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
      maxOutputTokens: 3000,
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
        controls: r.controls.flatMap((c): ActionControl[] => {
          if (c.do === 'volume') return c.level === undefined ? [] : [{ do: 'volume', level: Math.max(0, Math.min(100, c.level)) }];
          return [{ do: 'stop', target: c.target ?? 'sounds', ...(c.seconds !== undefined && { seconds: Math.max(0, c.seconds) }) }];
        }),
        ...(!r.clear && r.options?.length && { options: [...new Set([r.kind, ...r.options])] }),
      };
    }
    return Response.json({ readings });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'The actions couldn’t be read.' }, { status: 500 });
  }
}
