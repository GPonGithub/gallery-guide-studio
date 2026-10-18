'use client';

/**
 * Speaks a reply sentence by sentence as it's being written. Each sentence's
 * audio is requested (and starts streaming in) the moment the sentence arrives (so sentence 2 is being
 * made while sentence 1 plays) and they play strictly in order, back to back.
 * The queue counts as "speaking" from the first sentence until the last one
 * has finished — so the open mic stays deaf for the whole reply, including
 * the short gaps between sentences.
 */

import type { StreamedClip } from './streamedAudio';

export type SpeechQueueOptions = {
  /** Starts a sentence's audio streaming in (see streamedAudio.ts and /api/tts/stream). */
  requestAudio: (text: string, previousText: string) => Promise<StreamedClip>;
  /** Safety net: the whole clip for a sentence, fetched in one go, if streaming it failed. */
  requestClip: (text: string, previousText: string) => Promise<Blob>;
  playbackRate: () => number;
  expressive: boolean;
  onSpeakingChange: (speaking: boolean) => void;
  /** The voice has actually started playing a sentence (audio coming out, not just requested). */
  onPlay?: () => void;
  /**
   * Runs before the first sentence plays, which waits for it — e.g. a sound
   * connected to "every time before you speak". The sentences keep streaming
   * in meanwhile, so the voice is ready the moment it finishes.
   */
  beforeFirst?: () => Promise<void>;
  onError: (message: string) => void;
};

export class SpeechQueue {
  private clips: { text: string; previous: string; clip: Promise<StreamedClip | null> }[] = [];
  private spokenSoFar = '';
  private playing: HTMLAudioElement | null = null;
  private finished = false;
  private cancelled = false;
  // From the first sentence until the reply has finished playing.
  private active = false;
  // Caught up with what's been written so far; waiting for the next sentence.
  private waiting = false;
  // beforeFirst has run (or is running).
  private begun = false;

  constructor(private options: SpeechQueueOptions) {}

  /**
   * Adds the next sentence of the reply. `headStart` is audio already being
   * made for it (asked for before the sentence was confirmed); if that
   * didn't work out, it's simply asked for again here.
   */
  add(sentence: string, headStart?: Promise<StreamedClip | null>) {
    if (this.cancelled) return;
    const previous = this.spokenSoFar;
    this.spokenSoFar = `${this.spokenSoFar} ${sentence}`.trim();
    const clip = (headStart ?? Promise.resolve(null))
      .then((early) => early ?? this.options.requestAudio(sentence, previous))
      .catch((err: unknown) => {
        this.options.onError(`Voice failed: ${err instanceof Error ? err.message : 'unknown error'}`);
        return null;
      });
    this.clips.push({ text: sentence, previous, clip });
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
    for (const item of this.clips) void item.clip.then((clip) => clip?.release());
    this.clips = [];
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
    if (!this.begun) {
      this.begun = true;
      await this.options.beforeFirst?.().catch(() => {});
      if (this.cancelled) return;
    }
    const next = this.clips.shift();
    if (!next) {
      this.playing = null;
      if (this.finished) this.goQuiet();
      // More sentences are still being written: add() picks up from here.
      else this.waiting = true;
      return;
    }
    const clip = await next.clip;
    if (this.cancelled) {
      clip?.release();
      return;
    }
    if (!clip) return this.playNext();
    this.play(clip.src, clip.release, () => this.playFallback(next));
  }

  // Plays one source; `onFail` runs instead of moving on if it can't play.
  // `release` frees the source once it's done with, either way.
  private play(src: string, release: () => void, onFail: (detail: string) => void) {
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
      release();
      onFail(detail);
    };
    audio.onended = () => {
      if (settled) return;
      settled = true;
      release();
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
      this.play(url, () => URL.revokeObjectURL(url), (detail) => {
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
