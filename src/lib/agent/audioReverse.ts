'use client';

/**
 * A sound file played backwards: decoded in the browser, each channel's samples reversed, and made into a
 * WAV to play like any file. Nothing is written to the media folder. Kept per file (by its name, size and
 * date), so pressing again doesn't decode it again.
 */

const made = new Map<string, Promise<Blob>>();
const MOST_KEPT = 8;

export function reversedSound(file: File): Promise<Blob> {
  const key = `${file.name}|${file.size}|${file.lastModified}`;
  let blob = made.get(key);
  if (!blob) {
    blob = reverse(file);
    blob.catch(() => made.delete(key));
    made.set(key, blob);
    if (made.size > MOST_KEPT) made.delete(made.keys().next().value!);
  }
  return blob;
}

async function reverse(file: File): Promise<Blob> {
  const context = new OfflineAudioContext(1, 1, 44100);
  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error(`“${file.name}” couldn’t be read to play it backwards.`);
  }
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice().reverse());
  return wav(channels, buffer.sampleRate);
}

/** 16-bit PCM WAV of the channels (all the same length). */
function wav(channels: Float32Array[], sampleRate: number): Blob {
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytes = frames * count * 2;
  const view = new DataView(new ArrayBuffer(44 + bytes));
  const text = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, bytes, true);
  let at = 44;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < count; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      at += 2;
    }
  return new Blob([view.buffer], { type: 'audio/wav' });
}
