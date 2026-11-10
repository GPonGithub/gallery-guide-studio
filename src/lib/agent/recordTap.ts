'use client';

/**
 * Where a recording listens in. Everything the studio plays goes through Web Audio on its way to the
 * speakers (the chatbot's voice, the timeline's sounds and video sound in mediaPlayback.ts; the Music
 * panel's music in backgroundMusic.ts). Each of those audio contexts gets one tap: a side branch that
 * carries the same sound as a stream, mixed down to stereo, without changing what the speakers play.
 * Whatever is connected to the speakers is connected to its context's tap as well; the conversation
 * recorder (conversationRecorder.ts) records the taps.
 */

const taps = new Map<AudioContext, MediaStreamAudioDestinationNode>();
const listeners = new Set<(stream: MediaStream) => void>();

/** A context's tap (made the first time it's asked for): connect to it whatever goes to the speakers. */
export function recordTap(ctx: AudioContext): AudioNode {
  let tap = taps.get(ctx);
  if (!tap) {
    tap = ctx.createMediaStreamDestination();
    // Four room outputs come down to left and right (1 + 3, 2 + 4), as they would on two speakers.
    tap.channelCount = 2;
    tap.channelCountMode = 'explicit';
    tap.channelInterpretation = 'speakers';
    taps.set(ctx, tap);
    const stream = tap.stream;
    listeners.forEach((l) => l(stream));
  }
  return tap;
}

/** Every tap there is now, as a stream each. */
export const recordTapStreams = (): MediaStream[] => [...taps.values()].map((t) => t.stream);

/** Hears of a tap made later (a context that starts up mid-recording). Returns how to stop hearing. */
export function onRecordTap(listener: (stream: MediaStream) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
