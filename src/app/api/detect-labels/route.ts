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
  try {
    const { annotatedImageDataUrl, count, anthropicApiKey } = (await req.json()) as {
      annotatedImageDataUrl: string;
      count: number;
      anthropicApiKey?: string;
    };
    const parsed = parseDataUrl(annotatedImageDataUrl);
    if (!parsed || !count) return Response.json({ labels: [] });

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
                `This flow diagram image has ${count} numbered red circle markers (1 through ${count}), each ` +
                "placed just above a button. For each numbered marker, find the title/label text printed at the " +
                "top of that button's enclosing card — it may be directly above the marker or a bit further up, " +
                'so look at the whole card the marker sits inside, not just the nearest line of text. Return the ' +
                'label exactly as printed (matching capitalization), one per marker, in order from 1 to ' +
                `${count}. If a label truly cannot be found for a marker, return an empty string for that entry.`,
            },
            { type: 'file', data: parsed.base64, mediaType: parsed.mediaType },
          ],
        },
      ],
    });

    return Response.json({ labels: output.labels });
  } catch (err) {
    console.error('detect-labels failed:', err instanceof Error ? err.message : err);
    return Response.json({ labels: [] });
  }
}
