export const maxDuration = 30;
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const text = url.searchParams.get('text');
  const voiceId = url.searchParams.get('voiceId')?.trim() || DEFAULT_VOICE_ID;
  const apiKey = url.searchParams.get('apiKey')?.trim() || process.env.ELEVENLABS_API_KEY;

  if (!text) return new Response('Missing "text" query parameter.', { status: 400 });
  if (!apiKey) {
    return new Response(
      'No ElevenLabs API key set. Add one via "API keys" in the header, or set ELEVENLABS_API_KEY in .env.local.',
      { status: 500 },
    );
  }

  // https://elevenlabs.io/docs/api-reference/text-to-speech/convert — all optional,
  // each falls back to ElevenLabs' own default when the query param is absent.
  const num = (name: string) => {
    const raw = url.searchParams.get(name);
    return raw === null || raw === '' ? undefined : Number(raw);
  };
  const voiceSettings = {
    stability: num('stability'),
    similarity_boost: num('similarityBoost'),
    style: num('style'),
    speed: num('speed'),
    use_speaker_boost: url.searchParams.has('speakerBoost') ? url.searchParams.get('speakerBoost') === 'true' : undefined,
  };

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?optimize_streaming_latency=4`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5', voice_settings: voiceSettings }),
      },
    );
  } catch (err) {
    return new Response(err instanceof Error ? err.message : 'Could not reach ElevenLabs.', { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const message = await upstream.text().catch(() => 'ElevenLabs request failed.');
    return new Response(message || 'ElevenLabs request failed.', { status: upstream.status || 502 });
  }

  // Pass the upstream stream straight through — no buffering.
  return new Response(upstream.body, {
    headers: { 'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg', 'Cache-Control': 'no-store' },
  });
}
