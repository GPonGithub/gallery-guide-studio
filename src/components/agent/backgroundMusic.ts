'use client';

/**
 * A looping background soundtrack under the conversation. It plays from a
 * file already in the browser, through the Web Audio API, so it never waits
 * on the network and doesn't slow the agent down.
 *
 * Its volume goes through a gain node: every change (fading in, dipping while
 * the agent talks, coming back up) follows an ease-in-out curve rather than a
 * straight line, so it swells and settles instead of jumping.
 */

const FADE_IN_SECONDS = 1.5;
const FADE_OUT_SECONDS = 2;
// Dips quickly so the agent's first words are clear; comes back up gently.
const DUCK_DOWN_SECONDS = 0.4;
const DUCK_UP_SECONDS = 1.2;
const LEVEL_CHANGE_SECONDS = 0.15;
const CURVE_POINTS = 64;

const clamp10 = (n: number) => Math.max(0, Math.min(10, Number.isFinite(n) ? n : 0));

/** 0–10 on the slider → loudness. Squared, because ears hear loudness that way. */
export const levelToGain = (level: number) => (clamp10(level) / 10) ** 2;

/**
 * 0–10 on the dip slider → how loud the music stays while the agent talks,
 * as a share of its normal volume: 0 → 100% (no dip), 5 → 50%, 8 → 20%,
 * 10 → silent.
 */
export const dipToShare = (dip: number) => 1 - clamp10(dip) / 10;

/** Ease-in-out (half a cosine) from one gain to another. */
function easeCurve(from: number, to: number): Float32Array {
  const curve = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const t = i / (CURVE_POINTS - 1);
    curve[i] = from + (to - from) * ((1 - Math.cos(Math.PI * t)) / 2);
  }
  return curve;
}

export class BackgroundMusic {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private element: HTMLAudioElement | null = null;
  private url: string | null = null;
  private volume = 5;
  private dip = 6;
  private ducked = false;
  // The fade in progress (or last finished), so where the volume is right
  // now can be worked out exactly instead of asking the browser for it.
  private ramp = { from: 0, to: 0, start: 0, seconds: 0 };
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  playing = false;

  constructor(private onPlayingChange: (playing: boolean) => void) {}

  get hasTrack(): boolean {
    return this.url !== null;
  }

  /** Swaps in a new file (or none). Stops anything playing. */
  setTrack(blob: Blob | null) {
    this.stop(0);
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = blob ? URL.createObjectURL(blob) : null;
    if (this.element) {
      if (this.url) this.element.src = this.url;
      else this.element.removeAttribute('src');
    }
  }

  /** Volume 0–10 and dip 0–10 (10 = silent while the agent talks). Apply straight away. */
  setLevels(volume: number, dip: number) {
    this.volume = volume;
    this.dip = dip;
    if (this.playing) this.rampTo(this.target(), LEVEL_CHANGE_SECONDS);
  }

  /** Dips the music while the agent talks; brings it back afterwards. */
  duck(talking: boolean) {
    if (talking === this.ducked) return;
    this.ducked = talking;
    if (this.playing) this.rampTo(this.target(), talking ? DUCK_DOWN_SECONDS : DUCK_UP_SECONDS);
  }

  /**
   * Starts from the top with a fade in. Call it straight from a click —
   * browsers only let sound start in response to one.
   */
  start() {
    if (!this.url) return;
    this.ensureGraph();
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    void this.context!.resume();
    const element = this.element!;
    if (element.src !== this.url) element.src = this.url;
    element.currentTime = 0;
    const now = this.context!.currentTime;
    this.gain!.gain.cancelScheduledValues(0);
    this.gain!.gain.setValueAtTime(0, now);
    this.ramp = { from: 0, to: 0, start: now, seconds: 0 };
    element.play().catch(() => this.setPlaying(false));
    this.setPlaying(true);
    this.rampTo(this.target(), FADE_IN_SECONDS);
  }

  /** Fades out, then stops. `seconds` = 0 stops at once. */
  stop(seconds = FADE_OUT_SECONDS) {
    if (!this.playing) return;
    this.setPlaying(false);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    if (seconds <= 0) {
      this.element?.pause();
      return;
    }
    this.rampTo(0, seconds);
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null;
      if (!this.playing) this.element?.pause();
    }, seconds * 1000 + 50);
  }

  private target(): number {
    const full = levelToGain(this.volume);
    return this.ducked ? full * dipToShare(this.dip) : full;
  }

  private setPlaying(playing: boolean) {
    if (this.playing === playing) return;
    this.playing = playing;
    this.onPlayingChange(playing);
  }

  private ensureGraph() {
    if (this.context) return;
    this.context = new AudioContext();
    this.gain = this.context.createGain();
    this.gain.gain.value = 0;
    this.element = new Audio();
    this.element.loop = true;
    this.element.preload = 'auto';
    this.context.createMediaElementSource(this.element).connect(this.gain);
    this.gain.connect(this.context.destination);
    // If the browser suspends the audio (another sound starting, a change of
    // output device), pick it straight back up while the music is meant to play.
    this.context.onstatechange = () => {
      if (this.playing && this.context?.state !== 'running') void this.context?.resume();
    };
  }

  // Where the volume is right now along the fade in progress.
  private currentGain(): number {
    const { from, to, start, seconds } = this.ramp;
    const t = seconds > 0 ? Math.min(1, Math.max(0, (this.context!.currentTime - start) / seconds)) : 1;
    return from + (to - from) * ((1 - Math.cos(Math.PI * t)) / 2);
  }

  // From wherever the volume is right now (even halfway through another
  // fade) to `to`, along the ease curve.
  private rampTo(to: number, seconds: number) {
    if (!this.context || !this.gain) return;
    if (this.context.state !== 'running') void this.context.resume();
    const param = this.gain.gain;
    const now = this.context.currentTime;
    const from = this.currentGain();
    const start = now + 0.01;
    const length = Math.max(0.02, seconds);
    param.cancelScheduledValues(0);
    param.setValueAtTime(from, now);
    try {
      param.setValueCurveAtTime(easeCurve(from, to), start, length);
    } catch {
      // A browser that won't take the curve still gets a smooth glide.
      param.setTargetAtTime(to, start, length / 3);
    }
    this.ramp = { from, to, start, seconds: length };
  }
}
