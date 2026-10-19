'use client';

import { useEffect, useRef, useState } from 'react';

// Hands-free ("open mic") listening for the goal-agent chat: stays on across
// turns, sends what was said once the caller has been quiet for the chosen
// pause, and goes deaf while the agent is thinking. While the agent speaks it
// either goes deaf too, or (speak to interrupt) keeps listening for the caller
// talking over it — ignoring the agent's own words coming back through the
// speakers. Browser Web Speech API (Chrome on a computer).

type SpeechRecognitionLike = {
  interimResults: boolean;
  continuous: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

type Ctor = new () => SpeechRecognitionLike;

const RESTART_DELAY_MS = 300;
// The same words sent twice within this window is an echo/glitch, not a reply.
const DEDUPE_WINDOW_MS = 4000;
// Sessions dying this fast this many times in a row means something's wrong
// (blocked mic, no network for recognition) — stop instead of looping.
const RAPID_FAIL_MS = 1000;
const RAPID_FAIL_LIMIT = 5;
// Real speech, not a breath/"um"/noise blip: Chrome has confirmed a whole
// phrase, or there are at least this many words so far.
const MIN_WORDS_FOR_SPEECH = 3;
// While Chrome still thinks you're mid-phrase (its result isn't final yet),
// allow this much extra on top of the pause before treating you as done.
const MID_PHRASE_GRACE_MS = 2000;
// Talking over the agent: this many of the caller's own words (not the agent's, heard back through the
// speakers) interrupt it — or any one of these, said on its own.
const BARGE_IN_WORDS = 2;
const STOP_WORDS = new Set(['stop', 'wait', 'sorry', 'hold', 'hang', 'excuse', 'pause', 'hey', 'actually', 'no']);

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Whether what was heard is the caller talking, not just the agent's own voice coming back. */
function callerTalking(heard: string, agentSaid: string): boolean {
  const echo = new Set(wordsOf(agentSaid));
  const own = wordsOf(heard).filter((w) => !echo.has(w));
  return own.length >= BARGE_IN_WORDS || own.some((w) => STOP_WORDS.has(w));
}

export type OpenMicStatus = 'off' | 'listening' | 'hearing' | 'paused' | 'starting';

export type UtteranceTiming = { lastHeardAt: number; confirmedAt: number | null };

export function OpenMic({
  on,
  paused,
  pauseSeconds,
  onToggle,
  onTranscript,
  onUtterance,
  onPhraseFinal,
  onStatus,
  onError,
  agentSpeaking = false,
  agentText = '',
  onBargeIn,
}: {
  on: boolean;
  /** True while the mic should be deaf: the agent thinking (or speaking, without speak to interrupt), or the call ended. */
  paused: boolean;
  /** The agent is speaking and the mic listens through it, for the caller talking over it (speak to interrupt). */
  agentSpeaking?: boolean;
  /** What the agent is saying, so its own voice heard back through the speakers isn't taken for the caller. */
  agentText?: string;
  /** The caller has started talking over the agent: stop it. What they say then goes as normal. */
  onBargeIn?: () => void;
  pauseSeconds: number;
  onToggle: (on: boolean) => void;
  /** Live words as they're heard, for the input box. */
  onTranscript: (text: string) => void;
  /**
   * A finished utterance, after the pause. `timing` (performance.now() times)
   * says when the last words were heard and when Chrome confirmed the phrase
   * — for measuring how long the caller waits for a reply.
   */
  onUtterance: (text: string, timing: UtteranceTiming) => void;
  /**
   * Chrome has just confirmed a complete phrase — the pause timer is now
   * running. The app can start working on a reply early; if the caller
   * keeps talking, `onUtterance` later arrives with different text.
   */
  onPhraseFinal?: (text: string) => void;
  onStatus: (status: OpenMicStatus) => void;
  onError: (message: string) => void;
}) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef('');
  const timingRef = useRef<UtteranceTiming>({ lastHeardAt: 0, confirmedAt: null });
  // Nothing counts down until real speech has been heard in this listening session.
  const heardSpeechRef = useRef(false);
  const lastSentRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const startedAtRef = useRef(0);
  const rapidFailsRef = useRef(0);
  const [restartTick, setRestartTick] = useState(0);

  // Latest props for callbacks fired by the recognition engine later on.
  const latest = useRef({ on, paused, pauseSeconds, onToggle, onTranscript, onUtterance, onPhraseFinal, onStatus, onError, agentSpeaking, agentText, onBargeIn });
  useEffect(() => {
    latest.current = { on, paused, pauseSeconds, onToggle, onTranscript, onUtterance, onPhraseFinal, onStatus, onError, agentSpeaking, agentText, onBargeIn };
  });
  // Results before this one (in the current listening session) were the agent's voice, not the caller: skipped.
  const firstResultRef = useRef(0);
  const resultCountRef = useRef(0);
  // The caller just talked over the agent: what they're saying carries on from there.
  const bargedInRef = useRef(false);
  // The agent started speaking: what's heard from here is its voice until the caller talks over it.
  // It finished (without being interrupted): listening starts again from scratch — a fresh session,
  // as before the agent spoke — so the caller's first words can't be swallowed by a phrase that
  // began with the agent's voice. (When the caller talked over it, their words are kept.)
  const wasSpeaking = useRef(agentSpeaking);
  useEffect(() => {
    const finished = wasSpeaking.current && !agentSpeaking;
    wasSpeaking.current = agentSpeaking;
    if (bargedInRef.current) {
      bargedInRef.current = false;
      return;
    }
    firstResultRef.current = resultCountRef.current;
    // Stopping ends the session; it starts again by itself (onend), with nothing carried over.
    if (finished) recognitionRef.current?.stop();
  }, [agentSpeaking]);

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
  };

  useEffect(() => {
    if (!on) {
      clearSilenceTimer();
      recognitionRef.current?.stop();
      latest.current.onStatus('off');
      return;
    }
    if (paused) {
      clearSilenceTimer();
      recognitionRef.current?.stop();
      latest.current.onStatus('paused');
      return;
    }
    if (recognitionRef.current) return;

    const SR =
      (window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: Ctor }).webkitSpeechRecognition;
    if (!SR) {
      latest.current.onError('This browser has no speech recognition — use Chrome on a computer.');
      latest.current.onToggle(false);
      return;
    }

    const recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    transcriptRef.current = '';
    heardSpeechRef.current = false;
    firstResultRef.current = 0;
    resultCountRef.current = 0;

    recognition.onresult = (e) => {
      resultCountRef.current = e.results.length;
      // While the agent speaks: listen only for the caller talking over it. The first phrase with their
      // own words in it interrupts the agent, and from there on it's what they're saying.
      if (latest.current.agentSpeaking) {
        const at = Array.from(e.results).findIndex(
          (r, i) => i >= firstResultRef.current && callerTalking(r[0].transcript, latest.current.agentText),
        );
        if (at < 0) return;
        firstResultRef.current = at;
        latest.current.agentSpeaking = false;
        bargedInRef.current = true;
        latest.current.onBargeIn?.();
      }
      const results = Array.from(e.results).slice(firstResultRef.current);
      const text = results
        .map((r) => r[0].transcript)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      transcriptRef.current = text;
      latest.current.onTranscript(text);
      clearSilenceTimer();

      // Don't start the clock on a breath, an "um" or background noise —
      // only once you've genuinely started talking. Until then it just
      // keeps listening, however long you take to begin.
      const wordCount = text ? text.split(' ').length : 0;
      if (!heardSpeechRef.current && (results.some((r) => r.isFinal) || wordCount >= MIN_WORDS_FOR_SPEECH)) {
        heardSpeechRef.current = true;
      }
      if (!heardSpeechRef.current) return;
      latest.current.onStatus('hearing');
      const now = performance.now();

      // Chrome marks a phrase final once it judges you've stopped; until
      // then you're probably mid-sentence, so give extra room. Re-read the
      // slider every time, so a change applies to the very next pause.
      const midPhrase = !results[results.length - 1]?.isFinal;
      // A final result repeats words already heard, so it doesn't move "last heard".
      timingRef.current = midPhrase
        ? { lastHeardAt: now, confirmedAt: null }
        : { lastHeardAt: timingRef.current.lastHeardAt || now, confirmedAt: now };
      if (!midPhrase) latest.current.onPhraseFinal?.(text);
      const waitMs = Math.round(latest.current.pauseSeconds * 1000) + (midPhrase ? MID_PHRASE_GRACE_MS : 0);
      silenceTimerRef.current = setTimeout(() => {
        silenceTimerRef.current = null;
        const said = transcriptRef.current.trim();
        transcriptRef.current = '';
        recognition.stop();
        if (!said) return;
        const { text: lastText, at } = lastSentRef.current;
        if (said === lastText && Date.now() - at < DEDUPE_WINDOW_MS) return;
        lastSentRef.current = { text: said, at: Date.now() };
        const timing = timingRef.current;
        timingRef.current = { lastHeardAt: 0, confirmedAt: null };
        latest.current.onUtterance(said, timing);
      }, waitMs);
    };

    recognition.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        latest.current.onError('The microphone is blocked — allow it for this page (address bar → site settings) and try again.');
        latest.current.onToggle(false);
      }
      // 'no-speech', 'aborted', 'network' etc. just end the session; onend restarts it.
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      clearSilenceTimer();
      const lived = Date.now() - startedAtRef.current;
      rapidFailsRef.current = lived < RAPID_FAIL_MS ? rapidFailsRef.current + 1 : 0;
      if (rapidFailsRef.current >= RAPID_FAIL_LIMIT) {
        rapidFailsRef.current = 0;
        latest.current.onError('The open mic keeps stopping straight away — check the microphone and your connection, then turn it on again.');
        latest.current.onToggle(false);
        return;
      }
      // Browsers end recognition on their own after a while; come straight back.
      if (latest.current.on && !latest.current.paused) {
        setTimeout(() => setRestartTick((t) => t + 1), RESTART_DELAY_MS);
      }
    };

    recognitionRef.current = recognition;
    startedAtRef.current = Date.now();
    latest.current.onStatus('starting');
    try {
      recognition.start();
      latest.current.onStatus('listening');
    } catch {
      recognitionRef.current = null;
      setTimeout(() => setRestartTick((t) => t + 1), RESTART_DELAY_MS);
    }
  }, [on, paused, restartTick]);

  // Turn everything off when leaving the page.
  useEffect(
    () => () => {
      clearSilenceTimer();
      recognitionRef.current?.stop();
    },
    [],
  );

  return (
    <button
      onClick={() => onToggle(!on)}
      className={`h-[38px] w-[38px] shrink-0 border-2 font-body text-base transition-colors duration-100 ${
        on
          ? 'border-[#18a0fb] bg-[#18a0fb] text-white'
          : 'border-[#18a0fb] bg-paper text-[#18a0fb] hover:bg-[#18a0fb] hover:text-white'
      }`}
      title={on ? 'Open mic is on — click to turn it off' : 'Open mic: stays on and sends when you pause, no clicking needed'}
      aria-pressed={on}
    >
      🎙️
    </button>
  );
}
