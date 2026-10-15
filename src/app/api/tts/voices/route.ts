import { serverKey } from '@/lib/serverKeys';

export const maxDuration = 30;

/**
 * The voices in the user's ElevenLabs account ("My Voices", including any
 * library voices they've added), so the voice panel can offer them by name
 * instead of asking people to copy voice IDs out of the ElevenLabs site.
 */

type ElevenVoice = { voice_id: string; name: string; category?: string; labels?: Record<string, string> };

export type AccountVoice = { voiceId: string; name: string; description: string };

function describe(v: ElevenVoice): string {
  const labels = Object.values(v.labels ?? {}).filter(Boolean).slice(0, 3);
  return [v.category, ...labels].filter(Boolean).join(' · ');
}

async function fetchVoices(apiKey: string): Promise<ElevenVoice[]> {
  const headers = { 'xi-api-key': apiKey };
  const all: ElevenVoice[] = [];
  let token: string | null = null;
  // v2 is paginated; stop after a few pages — far more than ten slots need.
  for (let page = 0; page < 5; page++) {
    const url = new URL('https://api.elevenlabs.io/v2/voices');
    url.searchParams.set('page_size', '100');
    if (token) url.searchParams.set('next_page_token', token);
    const res = await fetch(url, { headers });
    if (!res.ok) {
      if (page === 0 && res.status === 404) break; // fall back to v1 below
      throw new Error(`ElevenLabs said ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as { voices: ElevenVoice[]; has_more?: boolean; next_page_token?: string | null };
    all.push(...data.voices);
    if (!data.has_more || !data.next_page_token) return all;
    token = data.next_page_token;
  }
  if (all.length > 0) return all;
  const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers });
  if (!res.ok) throw new Error(`ElevenLabs said ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { voices: ElevenVoice[] }).voices;
}

export async function POST(req: Request) {
  const { apiKey } = (await req.json()) as { apiKey?: string };
  const key = apiKey?.trim() || serverKey('ELEVENLABS_API_KEY');
  if (!key) return Response.json({ error: 'Add your ElevenLabs API key first (Keys, top right).' }, { status: 400 });
  try {
    const voices: AccountVoice[] = (await fetchVoices(key))
      .map((v) => ({ voiceId: v.voice_id, name: v.name, description: describe(v) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({ voices });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Couldn’t load your voices.' }, { status: 502 });
  }
}
