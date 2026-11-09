/**
 * How loud the chatbot's voice is right now, for the AI character's animation.
 *
 * One AnalyserNode per AudioContext listens to the voice (it's a side branch: nothing
 * it hears is changed or played twice). The voice's Web Audio route connects into
 * voiceAnalyser(ctx); the animation reads readVoice() every frame.
 */

const analysers = new WeakMap<BaseAudioContext, AnalyserNode>();
let latest: AnalyserNode | null = null;

/** The voice's listener in this context (made the first time). Connect the voice into it. */
export function voiceAnalyser(ctx: AudioContext): AnalyserNode {
  let a = analysers.get(ctx);
  if (!a) {
    a = ctx.createAnalyser();
    a.fftSize = 1024;
    a.smoothingTimeConstant = 0.35;
    // Kept running by a silent path to the output (a branch that leads nowhere can be skipped).
    const mute = ctx.createGain();
    mute.gain.value = 0;
    a.connect(mute);
    mute.connect(ctx.destination);
    analysers.set(ctx, a);
  }
  latest = a;
  startSending();
  return a;
}

/*
 * The voice plays in the Chatbot Designer's tab, but the character is shown in its own window
 * (/ai-character, e.g. full screen on a projector). So while the voice is heard, its readings go
 * out ~60 times a second on a BroadcastChannel, and any character window in this browser follows them.
 */
const CHANNEL = 'ai-character-voice';
let channel: BroadcastChannel | null = null;
const getChannel = () => {
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e: MessageEvent<VoiceReading>) => {
      heard = e.data;
      heardAt = performance.now();
    };
  }
  return channel;
};
let sending = 0;
let wasQuiet = true;
let tick = 0;
/** Also told each reading (~30 a second, silence once): TouchDesigner's link passes them on to its characters. */
const followers = new Set<(r: VoiceReading) => void>();
export function onVoiceReading(f: (r: VoiceReading) => void): () => void {
  followers.add(f);
  return () => {
    followers.delete(f);
  };
}
function startSending() {
  if (sending || typeof window === 'undefined') return;
  // A timer, not animation frames: the Designer's tab may be behind the character's window,
  // and a tab that is playing sound keeps its timers running at full speed.
  sending = window.setInterval(() => {
    const r = readVoice(latest);
    const quiet = r.level < 0.01;
    if (quiet && wasQuiet) return; // silence is sent once, not every tick
    const first = quiet !== wasQuiet;
    wasQuiet = quiet;
    getChannel()?.postMessage(r);
    if (first || ++tick % 2 === 0) followers.forEach((f) => f(r));
  }, 16);
}

let heard: VoiceReading | null = null;
let heardAt = 0;

/**
 * What the character should follow: the voice playing in this tab, or the one heard from another
 * tab, whichever is louder. A reading from another tab older than a quarter second counts as silence.
 */
export function currentVoiceReading(): VoiceReading {
  getChannel();
  const here = readVoice(latest);
  const there = heard && performance.now() - heardAt < 250 ? heard : SILENT;
  return there.level > here.level ? there : here;
}

/** The analyser the voice last went through, or null before the voice has played. */
export function currentVoiceAnalyser(): AnalyserNode | null {
  return latest;
}

export type VoiceReading = {
  /** Overall loudness, 0 (silent) to 1 (loud speech). */
  level: number;
  /** Loudness in three bands, each 0–1: the voice's body, its vowels, its consonants. */
  low: number;
  mid: number;
  high: number;
};

const SILENT: VoiceReading = { level: 0, low: 0, mid: 0, high: 0 };
const buffers = new WeakMap<AnalyserNode, { wave: Float32Array<ArrayBuffer>; freq: Uint8Array<ArrayBuffer> }>();

/** dB → 0–1: −52 dB and below is silence, −6 dB and above is full (loud speech peaks just under). */
const fromDb = (db: number) => Math.max(0, Math.min(1, (db + 52) / 46));

export function readVoice(a: AnalyserNode | null): VoiceReading {
  if (!a) return SILENT;
  let b = buffers.get(a);
  if (!b) {
    b = { wave: new Float32Array(a.fftSize), freq: new Uint8Array(a.frequencyBinCount) };
    buffers.set(a, b);
  }
  a.getFloatTimeDomainData(b.wave);
  let sum = 0;
  for (let i = 0; i < b.wave.length; i++) sum += b.wave[i] * b.wave[i];
  const rms = Math.sqrt(sum / b.wave.length);
  const level = rms > 0 ? fromDb(20 * Math.log10(rms)) : 0;

  a.getByteFrequencyData(b.freq);
  const hz = a.context.sampleRate / a.fftSize;
  const band = (from: number, to: number) => {
    const i0 = Math.max(1, Math.floor(from / hz));
    const i1 = Math.min(b.freq.length - 1, Math.ceil(to / hz));
    let s = 0;
    for (let i = i0; i <= i1; i++) s += b.freq[i];
    return Math.min(1, s / ((i1 - i0 + 1) * 200));
  };
  return { level, low: band(80, 350), mid: band(350, 2000), high: band(2000, 7000) };
}
