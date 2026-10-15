import { DEFAULT_VOICE_ID, synthesize } from '@/lib/elevenlabs';
import { serverKey } from '@/lib/serverKeys';

export const maxDuration = 30;

// One sentence of the agent's voice, streamed back as ElevenLabs makes it —
// the browser plays it as it arrives (see streamedAudio.ts). A problem like a
// bad key or voice ID comes back straight away as an error with a message.
// Everything happens in this one request, so it works the same on a hosted
// copy, where consecutive requests can be answered by different servers.
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
  return synthesize(
    body.text ?? null,
    body.voiceId?.trim() || DEFAULT_VOICE_ID,
    body.apiKey?.trim() || serverKey('ELEVENLABS_API_KEY'),
    { stability: v.stability, similarity_boost: v.similarityBoost, style: v.style, speed: v.speed, use_speaker_boost: v.useSpeakerBoost },
    body.expressive === true,
    body.previousText?.slice(-1000),
  );
}
