import { DEFAULT_VOICE_ID, synthesize } from '@/lib/elevenlabs';

export const maxDuration = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const text = url.searchParams.get('text');
  const voiceId = url.searchParams.get('voiceId')?.trim() || DEFAULT_VOICE_ID;
  const apiKey = url.searchParams.get('apiKey')?.trim() || process.env.ELEVENLABS_API_KEY;

  // https://elevenlabs.io/docs/api-reference/text-to-speech/convert — all optional,
  // each falls back to ElevenLabs' own default when the query param is absent.
  const num = (name: string) => {
    const raw = url.searchParams.get(name);
    return raw === null || raw === '' ? undefined : Number(raw);
  };
  return synthesize(text, voiceId, apiKey, {
    stability: num('stability'),
    similarity_boost: num('similarityBoost'),
    style: num('style'),
    speed: num('speed'),
    use_speaker_boost: url.searchParams.has('speakerBoost') ? url.searchParams.get('speakerBoost') === 'true' : undefined,
  });
}

// Same as GET, but the key travels in the request body rather than the
// URL, where it would end up in server logs and anything that records
// addresses (used by the v4 goal-agent page).
export async function POST(req: Request) {
  const body = (await req.json()) as {
    text?: string;
    voiceId?: string;
    apiKey?: string;
    voiceSettings?: { stability?: number; similarityBoost?: number; style?: number; speed?: number; useSpeakerBoost?: boolean };
    /** Text with performance cues, for an expressive model (see EXPRESSIVE_MODELS). */
    expressive?: boolean;
  };
  const v = body.voiceSettings ?? {};
  return synthesize(body.text ?? null, body.voiceId?.trim() || DEFAULT_VOICE_ID, body.apiKey?.trim() || process.env.ELEVENLABS_API_KEY, {
    stability: v.stability,
    similarity_boost: v.similarityBoost,
    style: v.style,
    speed: v.speed,
    use_speaker_boost: v.useSpeakerBoost,
  }, body.expressive === true);
}
