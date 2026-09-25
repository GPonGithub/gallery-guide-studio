import { generateText, Output } from 'ai';
import { z } from 'zod';
import { anthropicModel } from '@/lib/anthropicModel';

export const maxDuration = 30;

function parseDataUrl(dataUrl: string): { base64: string; mediaType: string } | null {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) return null;
  return { mediaType: match[1], base64: match[2] };
}

export async function POST(req: Request) {
  const { annotatedImageDataUrl, count, anthropicApiKey } = (await req.json()) as {
    annotatedImageDataUrl?: string;
    count?: number;
    anthropicApiKey?: string;
  };

  const parsed = annotatedImageDataUrl ? parseDataUrl(annotatedImageDataUrl) : null;
  if (!parsed || !count) {
    return Response.json({ labels: [], error: 'Missing image or count.' }, { status: 400 });
  }

  try {
    const { output } = await generateText({
      model: anthropicModel(anthropicApiKey),
      output: Output.object({ schema: z.object({ labels: z.array(z.string()) }) }),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `This flow diagram has ${count} numbered red circle markers, each placed just above a blue ` +
                'button. For each marker, read the title/label printed on the card that button belongs to — ' +
                'the text near the top of that card, not the button itself. Return exactly one label per ' +
                'marker, in marker-number order (1 first). If a label genuinely cannot be read, use an empty ' +
                'string for that position rather than guessing.',
            },
            { type: 'file', data: parsed.base64, mediaType: parsed.mediaType },
          ],
        },
      ],
    });

    return Response.json({ labels: output.labels });
  } catch (err) {
    return Response.json(
      { labels: [], error: err instanceof Error ? err.message : 'Label detection failed.' },
      { status: 500 },
    );
  }
}
