'use client';

/**
 * Speaks a reply sentence by sentence as it's being written. Each sentence's
 * audio is requested the moment the sentence arrives (so sentence 2 is being
 * made while sentence 1 plays) and they play strictly in order, back to back.
 * The queue counts as "speaking" from the first sentence until the last one
 * has finished — so the open mic stays deaf for the whole reply, including
 * the short gaps between sentences.
 */

export type SpeechQueueOptions = {
  /** Fetches a one-time playback ticket for a sentence (see /api/tts/stream). */
  requestTicket: (text: string, previousText: string) => Promise<string>;
  playbackRate: () => number;
  expressive: boolean;
  onSpeakingChange: (speaking: boolean) => void;
  onError: (message: string) => void;
};

export class SpeechQueue {
  private tickets: Promise<string | null>[] = [];
  private spokenSoFar = '';
  private playing: HTMLAudioElement | null = null;
  private finished = false;
  private cancelled = false;
  // From the first sentence until the reply has finished playing.
  private active = false;
  // Caught up with what's been written so far; waiting for the next sentence.
  private waiting = false;

  constructor(private options: SpeechQueueOptions) {}

  /** Adds the next sentence of the reply. */
  add(sentence: string) {
    if (this.cancelled) return;
    const previous = this.spokenSoFar;
    this.spokenSoFar = `${this.spokenSoFar} ${sentence}`.trim();
    const ticket = this.options.requestTicket(sentence, previous).catch((err: unknown) => {
      this.options.onError(`Voice failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      return null;
    });
    this.tickets.push(ticket);
    if (!this.active) {
      this.active = true;
      this.options.onSpeakingChange(true);
      void this.playNext();
    } else if (this.waiting) {
      this.waiting = false;
      void this.playNext();
    }
  }

  /** No more sentences are coming; the queue goes quiet once the last one has played. */
  finish() {
    this.finished = true;
    if (this.active && this.waiting) this.goQuiet();
  }

  /** Stops speaking immediately and drops anything still waiting. */
  cancel() {
    this.cancelled = true;
    this.tickets = [];
    this.playing?.pause();
    this.playing = null;
    if (this.active) this.goQuiet();
  }

  private goQuiet() {
    this.active = false;
    this.waiting = false;
    this.options.onSpeakingChange(false);
  }

  private async playNext(): Promise<void> {
    if (this.cancelled) return;
    const next = this.tickets.shift();
    if (!next) {
      this.playing = null;
      if (this.finished) this.goQuiet();
      // More sentences are still being written: add() picks up from here.
      else this.waiting = true;
      return;
    }
    const ticket = await next;
    if (this.cancelled) return;
    if (!ticket) return this.playNext();
    const audio = new Audio(`/api/tts/stream?ticket=${encodeURIComponent(ticket)}`);
    this.playing = audio;
    if (this.options.expressive) {
      // The expressive models have no speed setting, so apply it here.
      audio.playbackRate = this.options.playbackRate();
      audio.preservesPitch = true;
    }
    audio.onended = () => void this.playNext();
    audio.onerror = () => {
      this.options.onError('Voice playback stopped unexpectedly — try again, or check the voice in the Voice panel.');
      void this.playNext();
    };
    try {
      await audio.play();
    } catch {
      void this.playNext();
    }
  }

  get expressive(): boolean {
    return this.options.expressive;
  }

  /** The audio element playing right now, if any (for live speed changes). */
  current(): HTMLAudioElement | null {
    return this.playing;
  }
}
