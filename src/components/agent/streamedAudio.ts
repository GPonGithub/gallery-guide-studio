'use client';

/**
 * Plays a voice clip while it's still arriving, from a single request.
 *
 * The voice route answers a POST (text, voice, key) with the audio itself,
 * streamed as ElevenLabs makes it. A plain <audio src> can't send a POST
 * body (and the key mustn't go in a URL), so the browser reads the stream
 * and feeds it to the player through Media Source — playback starts with
 * the first audio, not after the whole clip has downloaded.
 *
 * (This replaced a two-request "ticket" scheme that kept the audio in the
 * server's memory between requests — which breaks on a hosted copy, where
 * two requests can land on different servers.)
 *
 * The stream is read straight away, whether or not anything is playing it
 * yet: a sentence prepared early (or waiting its turn) never leaves the
 * ElevenLabs connection idle, which can make it break off.
 */

export type StreamedClip = {
  /** For an <audio> element. */
  src: string;
  /** Frees the clip once it has played (or won't be). */
  release: () => void;
};

/**
 * Starts a clip. Resolves once the voice route has accepted the request (so
 * a bad key or voice ID rejects straight away, with its message) — while the
 * audio itself is still arriving.
 */
export async function startStreamedClip(request: () => Promise<Response>): Promise<StreamedClip> {
  const res = await request();
  if (!res.ok || !res.body) throw new Error((await res.text().catch(() => '')) || `Voice failed (${res.status}).`);
  const type = res.headers.get('content-type')?.split(';')[0].trim() || 'audio/mpeg';

  // Browsers without Media Source for this format: download the clip, then play it.
  if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(type)) {
    const url = URL.createObjectURL(await res.blob());
    return { src: url, release: () => URL.revokeObjectURL(url) };
  }

  const source = new MediaSource();
  const url = URL.createObjectURL(source);
  const chunks: Uint8Array[] = [];
  let finished = false;
  let failed = false;
  let wake: (() => void) | null = null;
  const nudge = () => {
    const w = wake;
    wake = null;
    w?.();
  };

  // Read everything as it comes, into memory.
  void (async () => {
    const reader = res.body!.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
        nudge();
      }
    } catch {
      failed = true;
    }
    finished = true;
    nudge();
  })();

  // Once a player has the clip, pass it the audio in order.
  source.addEventListener(
    'sourceopen',
    () => {
      // The player holds on to the source now; the URL itself is no longer needed.
      URL.revokeObjectURL(url);
      void (async () => {
        try {
          const buffer = source.addSourceBuffer(type);
          const append = (data: Uint8Array) =>
            new Promise<void>((resolve, reject) => {
              buffer.addEventListener('updateend', () => resolve(), { once: true });
              buffer.addEventListener('error', () => reject(new Error('The voice audio could not be played.')), { once: true });
              buffer.appendBuffer(data as BufferSource);
            });
          for (;;) {
            const next = chunks.shift();
            if (next) {
              await append(next);
              continue;
            }
            if (finished) break;
            await new Promise<void>((resolve) => (wake = resolve));
          }
          // A stream that broke off ends as an error, so the player falls back (see SpeechQueue).
          source.endOfStream(failed ? 'network' : undefined);
        } catch {
          try {
            source.endOfStream('decode');
          } catch {
            // Already ended.
          }
        }
      })();
    },
    { once: true },
  );

  return { src: url, release: () => URL.revokeObjectURL(url) };
}
