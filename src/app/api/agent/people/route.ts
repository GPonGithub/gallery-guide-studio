import { generateText } from 'ai';
import { anthropicModel } from '@/lib/anthropicModel';

export const maxDuration = 30;

// Dual microphones: the people a scene's sheet says the agent talks with (a doctor and a nurse, say), so
// each can be put on a microphone. Reads the scene's description, persona and stages; answers
// {people: [{name, role}]}. Never invents anyone.
export async function POST(req: Request) {
  const { text, anthropicApiKey } = (await req.json()) as { text?: string; anthropicApiKey?: string };
  if (!text?.trim()) return Response.json({ people: [] });
  try {
    const { text: out } = await generateText({
      model: anthropicModel(anthropicApiKey, 'claude-haiku-4-5-20251001'),
      temperature: 0,
      providerOptions: { anthropic: { thinking: { type: 'disabled' } } },
      system:
        'You read the script for one scene of a voice conversation with an AI agent, and list the people the agent ' +
        'talks WITH in it: the visitors, callers or staff who speak to the agent (for example a doctor and a nurse, ' +
        'or a visitor named Graham). Never the agent itself, and never people only mentioned in passing. For each, ' +
        'one line: NAME | ROLE — the name as the script gives it (or the role in Title Case if it gives no name, ' +
        'e.g. "The Doctor"), then their role in two or three words (or blank). Nothing else. If there are none, write NONE.',
      prompt: text.slice(0, 24_000),
    });
    const people = out
      .split('\n')
      .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
      .filter((line) => line && !/^none$/i.test(line))
      .map((line) => {
        const [name, role = ''] = line.split('|').map((x) => x.trim());
        return { name, role };
      })
      .filter((p) => p.name && p.name.length <= 60)
      .slice(0, 8);
    return Response.json({ people });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Couldn’t read the names.' }, { status: 500 });
  }
}
