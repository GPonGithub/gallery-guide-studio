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
  /** Safety net: the whole clip for a sentence, fetched in one go, if streaming it failed. */
  requestClip: (text: string, previousText: string) => Promise<Blob>;
  playbackRate: () => number;
  expressive: boolean;
  onSpeakingChange: (speaking: boolean) => void;
  /** The voice has actually started playing a sentence (audio coming out, not just requested). */
  onPlay?: () => void;
  onError: (message: string) => void;
};

export class SpeechQueue {
  private tickets: { text: string; previous: string; ticket: Promise<string | null> }[] = [];
  private spokenSoFar = '';
  private playing: HTMLAudioElement | null = null;
  private finished = false;
  private cancelled = false;
  // From the first sentence until the reply has finished playing.
  private active = false;
  // Caught up with what's been written so far; waiting for the next sentence.
  private waiting = false;

  constructor(private options: SpeechQueueOptions) {}

  /**
   * Adds the next sentence of the reply. `headStart` is a ticket for audio
   * already being made for it (asked for before the sentence was confirmed);
   * if that didn't work out, it's simply asked for again here.
   */
  add(sentence: string, headStart?: Promise<string | null>) {
    if (this.cancelled) return;
    const previous = this.spokenSoFar;
    this.spokenSoFar = `${this.spokenSoFar} ${sentence}`.trim();
    const ticket = (headStart ?? Promise.resolve(null))
      .then((early) => early ?? this.options.requestTicket(sentence, previous))
      .catch((err: unknown) => {
        this.options.onError(`Voice failed: ${err instanceof Error ? err.message : 'unknown error'}`);
        return null;
      });
    this.tickets.push({ text: sentence, previous, ticket });
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
    const ticket = await next.ticket;
    if (this.cancelled) return;
    if (!ticket) return this.playNext();
    this.play(`/api/tts/stream?ticket=${encodeURIComponent(ticket)}`, () => this.playFallback(next));
  }

  // Plays one source; `onFail` runs instead of moving on if it can't play.
  private play(src: string, onFail: (detail: string) => void) {
    const audio = new Audio(src);
    this.playing = audio;
    if (this.options.expressive) {
      // The expressive models have no speed setting, so apply it here.
      audio.playbackRate = this.options.playbackRate();
      audio.preservesPitch = true;
    }
    let settled = false;
    const fail = (detail: string) => {
      if (settled || this.cancelled) return;
      settled = true;
      onFail(detail);
    };
    audio.onended = () => {
      if (settled) return;
      settled = true;
      if (src.startsWith('blob:')) URL.revokeObjectURL(src);
      void this.playNext();
    };
    audio.onplaying = () => this.options.onPlay?.();
    audio.onerror = () => fail(`error code ${audio.error?.code ?? '?'}${audio.error?.message ? `: ${audio.error.message}` : ''}`);
    audio.play().catch((err: unknown) => fail(err instanceof Error ? err.message : 'could not start'));
  }

  // Streaming that sentence failed (e.g. the connection broke off): fetch the
  // whole clip in one go and play it, so the reply carries on.
  private async playFallback(item: { text: string; previous: string }) {
    try {
      const blob = await this.options.requestClip(item.text, item.previous);
      if (this.cancelled) return;
      const url = URL.createObjectURL(blob);
      this.play(url, (detail) => {
        URL.revokeObjectURL(url);
        this.options.onError(`Voice playback stopped unexpectedly (${detail}) — try again, or check the voice in the Voice panel.`);
        void this.playNext();
      });
    } catch (err) {
      this.options.onError(`Voice failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      void this.playNext();
    }
  }

  /** Nothing playing or waiting to play (e.g. a reply with nothing to say). */
  get idle(): boolean {
    return !this.active;
  }

  get expressive(): boolean {
    return this.options.expressive;
  }

  /** The audio element playing right now, if any (for live speed changes). */
  current(): HTMLAudioElement | null {
    return this.playing;
  }
}
