import { generateText, Output } from 'ai';
import { z } from 'zod';
import { anthropicModel } from '@/lib/anthropicModel';

export const maxDuration = 30;

type ReferenceBox = { label: string; instructions: string };
type TargetBox = { label: string; x: number; y: number };

function parseDataUrl(dataUrl: string): { base64: string; mediaType: string } | null {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) return null;
  return { mediaType: match[1], base64: match[2] };
}

export async function POST(req: Request) {
  const { masterPlaybook, references, targets, imageDataUrl, anthropicApiKey } = (await req.json()) as {
    masterPlaybook?: string;
    references: ReferenceBox[];
    targets: TargetBox[];
    imageDataUrl: string | null;
    anthropicApiKey?: string;
  };

  if (!targets?.length) return Response.json({ playbooks: [] });

  const promptParts: string[] = [];
  if (masterPlaybook?.trim()) {
    promptParts.push(`OVERALL CONTEXT (applies across every stage):\n${masterPlaybook.trim()}`);
  }

  promptParts.push(
    'Here are example playbooks already written by the student for other stages of this flow. Match their ' +
    'format, structure, length, and tone exactly for the new playbooks you write below — but do not reuse their ' +
    'literal content, since each stage is about something different.',
  );
  references.forEach((ref, i) => {
    promptParts.push(`Reference ${i + 1} — "${ref.label}":\n${ref.instructions}`);
  });

  promptParts.push(
    'Now write one playbook for each of the following target stages. Use the attached image to see what each ' +
    'stage is actually about — read the title and any text near the position given for each one. Return one ' +
    'playbook per target, in the same order as listed.',
  );
  targets.forEach((t, i) => {
    promptParts.push(
      `Target ${i + 1} — "${t.label}", positioned at roughly ${Math.round(t.x)}% from the left, ` +
      `${Math.round(t.y)}% from the top of the image.`,
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
      output: Output.object({ schema: z.object({ playbooks: z.array(z.string()) }) }),
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
