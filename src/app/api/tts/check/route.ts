import { createHash } from 'node:crypto';
import { serverKey } from '@/lib/serverKeys';

export const maxDuration = 60;

/**
 * Does each voice setting actually change the audio? ElevenLabs never makes
 * exactly the same audio twice, so comparing clips by ear proves little —
 * but with a fixed `seed` the output is repeatable. So: render one sentence
 * with the current settings, again identically (the control), then once per
 * setting pushed to an extreme. A setting "works" if its clip differs from
 * the control, which itself should match the first render. Uses exactly
 * the same model and latency options as the real conversation voice.
 */

const SAMPLE = 'Hi there, thanks for calling. How can I help you today?';
const SEED = 4242;
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
// mp3 at 128 kbps → bytes to seconds, close enough to compare lengths.
const secondsOf = (bytes: number) => (bytes * 8) / 128_000;

type Settings = { stability: number; similarityBoost: number; style: number; speed: number; useSpeakerBoost: boolean };

async function render(apiKey: string, voiceId: string, s: Settings): Promise<Buffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?optimize_streaming_latency=4&output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: SAMPLE,
        model_id: 'eleven_flash_v2_5',
        seed: SEED,
        voice_settings: {
          stability: s.stability,
          similarity_boost: s.similarityBoost,
          style: s.style,
          speed: s.speed,
          use_speaker_boost: s.useSpeakerBoost,
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs said ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

const hash = (b: Buffer) => createHash('sha1').update(b).digest('hex');

export async function POST(req: Request) {
  const { apiKey, voiceId, voiceSettings } = (await req.json()) as {
    apiKey?: string;
    voiceId?: string;
    voiceSettings: Settings;
  };
  const key = apiKey?.trim() || serverKey('ELEVENLABS_API_KEY');
  if (!key) return Response.json({ error: 'Add your ElevenLabs API key first.' }, { status: 400 });
  const voice = voiceId?.trim() || DEFAULT_VOICE_ID;
  const base = voiceSettings;

  const variants: { setting: string; from: number; to: number; settings: Settings }[] = [
    { setting: 'Stability', from: base.stability, to: base.stability >= 0.5 ? 0 : 1, settings: { ...base, stability: base.stability >= 0.5 ? 0 : 1 } },
    { setting: 'Similarity', from: base.similarityBoost, to: base.similarityBoost >= 0.5 ? 0 : 1, settings: { ...base, similarityBoost: base.similarityBoost >= 0.5 ? 0 : 1 } },
    { setting: 'Style', from: base.style, to: base.style >= 0.5 ? 0 : 1, settings: { ...base, style: base.style >= 0.5 ? 0 : 1 } },
    { setting: 'Speed', from: base.speed, to: base.speed >= 1 ? 0.7 : 1.2, settings: { ...base, speed: base.speed >= 1 ? 0.7 : 1.2 } },
  ];

  try {
    const [first, control, ...others] = await Promise.all([
      render(key, voice, base),
      render(key, voice, base),
      ...variants.map((v) => render(key, voice, v.settings)),
    ]);
    const repeatable = hash(first) === hash(control);
    const results = variants.map((v, i) => ({
      setting: v.setting,
      from: v.from,
      to: v.to,
      changedAudio: hash(others[i]) !== hash(control),
      seconds: Number(secondsOf(others[i].length).toFixed(2)),
    }));
    const summary = {
      repeatable,
      controlSeconds: Number(secondsOf(control.length).toFixed(2)),
      results,
    };
    // Also in the dev-server log, so it can be read without the browser.
    console.log('[voice check]', JSON.stringify(summary));
    return Response.json(summary);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Voice check failed.' }, { status: 502 });
  }
}
