/**
 * Shared ElevenLabs text-to-speech call, used by /api/tts (plays a whole
 * response) and /api/tts/stream (streams it back so the browser can start
 * playing as it arrives).
 */

export const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

export type VoiceSettingsBody = {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  speed?: number;
  use_speaker_boost?: boolean;
};

// Expressive lines carry performance cues ([warmly], [laughs softly]…).
// eleven_v4_turbo is ElevenLabs' real-time expressive model; eleven_v3 is
// the fallback if v4 isn't available on the account (more expressive still,
// but slower to start). Both only take stability and similarity — style,
// speed and speaker boost aren't part of these models.
const EXPRESSIVE_MODELS = ['eleven_v4_turbo', 'eleven_v3'];

async function callElevenLabs(url: string, apiKey: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function synthesize(
  text: string | null,
  voiceId: string,
  apiKey: string | undefined,
  voiceSettings: VoiceSettingsBody,
  expressive = false,
  /**
   * What was said just before (earlier sentences of the same reply), so a
   * reply spoken sentence by sentence still flows as one continuous line.
   */
  previousText?: string,
): Promise<Response> {
  if (!text) return new Response('Missing "text".', { status: 400 });
  if (!apiKey) {
    return new Response(
      'No ElevenLabs API key set. Add one via "API keys" in the header, or set ELEVENLABS_API_KEY in .env.local.',
      { status: 500 },
    );
  }

  const streamUrl = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`;
  let upstream: Response;
  let model = 'eleven_flash_v2_5';
  try {
    if (expressive) {
      upstream = new Response(null, { status: 500 });
      for (const candidate of EXPRESSIVE_MODELS) {
        model = candidate;
        upstream = await callElevenLabs(streamUrl, apiKey, {
          text,
          model_id: candidate,
          voice_settings: { stability: voiceSettings.stability, similarity_boost: voiceSettings.similarity_boost },
        });
        // Only an unavailable/unknown model is worth falling back from —
        // a bad key or no credit fails the same way on every model.
        if (upstream.ok || upstream.status === 401 || upstream.status === 402) break;
      }
    } else {
      const plain = { text, model_id: model, voice_settings: voiceSettings };
      upstream = await callElevenLabs(`${streamUrl}?optimize_streaming_latency=4`, apiKey, {
        ...plain,
        ...(previousText ? { previous_text: previousText } : {}),
      });
      // The continuity hint is a nice-to-have: if ElevenLabs ever rejects a
      // request because of it, say the sentence without it rather than fail.
      if (!upstream.ok && previousText && (upstream.status === 400 || upstream.status === 422)) {
        upstream = await callElevenLabs(`${streamUrl}?optimize_streaming_latency=4`, apiKey, plain);
      }
    }
  } catch (err) {
    return new Response(err instanceof Error ? err.message : 'Could not reach ElevenLabs.', { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const message = await upstream.text().catch(() => 'ElevenLabs request failed.');
    return new Response(message || 'ElevenLabs request failed.', { status: upstream.status || 502 });
  }

  // Pass the upstream stream straight through — no buffering.
  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
      'Cache-Control': 'no-store',
      'X-Voice-Model': model,
    },
  });
}
