import { generateText, Output } from 'ai';
import { z } from 'zod';
import { anthropicModel } from '@/lib/anthropicModel';

export const maxDuration = 30;

type StepInput = { option: 'BOT' | 'USER' | 'NAV'; instruction: string; navTarget?: string; variable?: string };
type ReferenceBox = { label: string; steps: StepInput[] };
type TargetBox = { id: string; label: string; x: number; y: number; leadsTo?: string[]; instructionPrompt?: string };
type BoxRef = { id: string; label: string };

const stepSchema = z.object({
  option: z.enum(['BOT', 'USER', 'NAV']),
  instruction: z.string(),
  navTarget: z.string().optional(),
  variable: z.string().optional(),
});

function parseDataUrl(dataUrl: string): { base64: string; mediaType: string } | null {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) return null;
  return { mediaType: match[1], base64: match[2] };
}

function formatSteps(steps: StepInput[]): string {
  return steps
    .map((s, i) => {
      const extra = [
        s.option === 'NAV' && s.navTarget ? `-> ${s.navTarget}` : '',
        s.variable ? `[save: ${s.variable}]` : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `${i + 1}. ${s.option}: ${s.instruction}${extra ? ` ${extra}` : ''}`;
    })
    .join('\n');
}

export async function POST(req: Request) {
  const { masterPlaybook, references, targets, allBoxes, imageDataUrl, anthropicApiKey } = (await req.json()) as {
    masterPlaybook?: string;
    references: ReferenceBox[];
    targets: TargetBox[];
    allBoxes: BoxRef[];
    imageDataUrl: string | null;
    anthropicApiKey?: string;
  };

  if (!targets?.length) return Response.json({ playbooks: [] });

  const promptParts: string[] = [];
  if (masterPlaybook?.trim()) {
    promptParts.push(`OVERALL CONTEXT (applies across every stage):\n${masterPlaybook.trim()}`);
  }

  promptParts.push(
    'Each stage of this flow is a step table, not free-form prose. Every step has an option — BOT (the agent ' +
    'speaks), USER (wait for the visitor\'s answer), or NAV (jump to another stage, unconditionally if it\'s the ' +
    'only NAV step at that point, or one of several conditions to classify between if there are more than one in ' +
    'a row). A USER step may optionally name a `variable` to save the visitor\'s answer under — assign one ' +
    'whenever the answer is worth remembering (e.g. their name, whether it\'s an emergency), and skip it when ' +
    'it isn\'t. A NAV step must set `navTarget` to the id of the stage it jumps to, taken only from the ids ' +
    `listed below — never invent one.\n\nAll stages in this flow:\n${allBoxes.map((b) => `- ${b.id}: "${b.label}"`).join('\n')}`,
  );

  if (references.length > 0) {
    promptParts.push(
      'Here are example step tables already written by the student for other stages of this flow. Match their ' +
      'granularity, tone, and level of detail exactly for the new tables you write below — but do not reuse ' +
      'their literal content, since each stage is about something different.',
    );
    references.forEach((ref, i) => {
      promptParts.push(`Reference ${i + 1} — "${ref.label}":\n${formatSteps(ref.steps)}`);
    });
  } else {
    promptParts.push(
      'No example step tables exist yet for this flow, so establish a reasonable structure yourself from the ' +
      'overall context above: typically a BOT step to speak, a USER step to collect the key answer for that ' +
      'stage (with a variable when worth saving), and — only when this stage should lead somewhere else — NAV ' +
      'step(s) at the end.',
    );
  }

  promptParts.push(
    'Now write one step table for each of the following target stages. When a target has its own brief below, ' +
    'that brief is the primary source of intent for it — follow it closely, and build a step table that keeps ' +
    'the conversation moving with no stalls (every question that expects an answer gets a USER step; never bury ' +
    'a condition inside a BOT line — a real branch needs NAV rows after a USER step or an implicit-wait question). ' +
    'When a target has no brief, fall back to the attached image — read the title and any text near the position ' +
    'given for it. Prefer a target\'s own listed neighbor ids (below) for any NAV step it needs. Return one step ' +
    'array per target, in the same order as listed.',
  );
  targets.forEach((t, i) => {
    const neighbors = t.leadsTo?.length ? ` Real neighbor stages this one connects to: ${t.leadsTo.join(', ')}.` : '';
    const brief = t.instructionPrompt?.trim() ? `\nBrief: ${t.instructionPrompt.trim()}` : '';
    promptParts.push(
      `Target ${i + 1} — id "${t.id}", "${t.label}", positioned at roughly ${Math.round(t.x)}% from the left, ` +
      `${Math.round(t.y)}% from the top of the image.${neighbors}${brief}`,
    );
  });

  const content: Array<{ type: 'text'; text: string } | { type: 'file'; data: string; mediaType: string }> = [
    { type: 'text', text: promptParts.join('\n\n') },
  ];
  const parsed = imageDataUrl ? parseDataUrl(imageDataUrl) : null;
  if (parsed) content.push({ type: 'file', data: parsed.base64, mediaType: parsed.mediaType });

  try {
    const { output } = await generateText({
      model: anthropicModel(anthropicApiKey),
      output: Output.object({ schema: z.object({ playbooks: z.array(z.array(stepSchema)) }) }),
      messages: [{ role: 'user', content }],
    });

    return Response.json({ playbooks: output.playbooks });
  } catch (err) {
    return Response.json(
      { playbooks: [], error: err instanceof Error ? err.message : 'Generation failed.' },
      { status: 500 },
    );
  }
}
