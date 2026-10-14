import { generateFlow } from '@/lib/agent/generate';

export const maxDuration = 180;

export async function POST(req: Request) {
  const { brief, anthropicApiKey } = (await req.json()) as { brief?: string; anthropicApiKey?: string };
  if (!brief?.trim()) return Response.json({ error: 'Describe the conversation first.' }, { status: 400 });
  try {
    return Response.json(await generateFlow(brief, anthropicApiKey ?? ''));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Generation failed.' }, { status: 500 });
  }
}
