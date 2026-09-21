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
    if (!parsed || !count) return Response.json({ connections: [] });

    const { output } = await generateText({
      model: anthropicModel(anthropicApiKey),
      output: Output.object({
        schema: z.object({
          connections: z.array(
            z.object({
              from: z.number().int().describe('Marker number the arrow starts at (the tail, no arrowhead)'),
              to: z.number().int().describe('Marker number the arrow points to (the head, with the arrowhead)'),
            }),
          ),
        }),
      }),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `This flow diagram image has ${count} numbered purple circle markers (1 through ${count}), ` +
                'each placed at the center of one box in the flow. Trace every arrow drawn in the diagram — a ' +
                'thin black line connecting two boxes, ending in an arrowhead — and report which two markers it ' +
                'connects. An arrow can travel in a straight line, bend at right angles, or loop a long way ' +
                'around other boxes to reach its target; follow the full line from end to end rather than ' +
                'assuming it goes to the nearest box. Report `from` as the marker at the tail (no arrowhead) and ' +
                '`to` as the marker at the arrowhead end. Only report an arrow you can actually see and trace — ' +
                "do not infer a connection just because two boxes look related. If you can't confidently trace " +
                'any arrows, return an empty list.',
            },
            { type: 'file', data: parsed.base64, mediaType: parsed.mediaType },
          ],
        },
      ],
    });

    return Response.json({ connections: output.connections });
  } catch (err) {
    console.error('detect-connections failed:', err instanceof Error ? err.message : err);
    return Response.json({ connections: [] });
  }
}
