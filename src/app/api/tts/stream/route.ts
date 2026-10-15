import { DEFAULT_VOICE_ID, synthesize } from '@/lib/elevenlabs';
import { issueTicket, redeemTicket } from '@/lib/ttsTickets';
import { serverKey } from '@/lib/serverKeys';

export const maxDuration = 30;

// Step 1: start the ElevenLabs stream now (so problems like a bad key or
// voice ID come back as a readable error straight away) and hand back a
// one-time ticket for it.
export async function POST(req: Request) {
  const body = (await req.json()) as {
    text?: string;
    voiceId?: string;
    apiKey?: string;
    voiceSettings?: { stability?: number; similarityBoost?: number; style?: number; speed?: number; useSpeakerBoost?: boolean };
    expressive?: boolean;
    /** Earlier sentences of the same reply — keeps the delivery continuous. */
    previousText?: string;
  };
  const v = body.voiceSettings ?? {};
  const audio = await synthesize(
    body.text ?? null,
    body.voiceId?.trim() || DEFAULT_VOICE_ID,
    body.apiKey?.trim() || serverKey('ELEVENLABS_API_KEY'),
    { stability: v.stability, similarity_boost: v.similarityBoost, style: v.style, speed: v.speed, use_speaker_boost: v.useSpeakerBoost },
    body.expressive === true,
    body.previousText?.slice(-1000),
  );
  if (!audio.ok) return new Response(await audio.text(), { status: audio.status });
  return Response.json({ ticket: issueTicket(audio) });
}

// Step 2: the <audio> element plays this URL, receiving the audio as
// ElevenLabs produces it.
export function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('ticket') ?? '';
  const audio = redeemTicket(id);
  if (!audio) return new Response('This voice ticket has expired or was already used.', { status: 404 });
  return audio;
}
