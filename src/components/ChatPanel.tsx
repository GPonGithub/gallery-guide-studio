'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import type { PlaybookBox, VoiceSettings } from '@/lib/types';
import { VoiceSettingsPanel } from './VoiceSettingsPanel';
import { VoicePresetButtons } from './VoicePresetButtons';
import { buttonIcon, buttonOutline, buttonPrimary, fieldInput } from '@/lib/styles';

type Transition = { toBoxId: string; toLabel: string; toStepNumber?: number };
type PositionData = { boxId: string | null; stepIndex: number; transitions: Transition[]; variableUpdates: Record<string, string> };
type ChatUIMessage = UIMessage<never, { position: PositionData }>;

type SpeechRecognitionResultLike = { transcript: string };
type SpeechRecognitionEventLike = { results: ArrayLike<ArrayLike<SpeechRecognitionResultLike>> };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

function getPosition(parts: ChatUIMessage['parts']): PositionData | undefined {
  const part = parts.find((p): p is Extract<ChatUIMessage['parts'][number], { type: 'data-position' }> => p.type === 'data-position');
  return part?.data;
}

function getMessageText(parts: ChatUIMessage['parts']): string {
  return parts
    .filter((p): p is Extract<ChatUIMessage['parts'][number], { type: 'text' }> => p.type === 'text')
    .map((p) => p.text ?? '')
    .join(' ')
    .trim();
}

// "Ready" and "error" both mean nothing is in flight — hands-free mode's
// mic should be free to resume listening in either case. Only an active
// request should hold it off.
function isRequestInFlight(status: string): boolean {
  return status === 'submitted' || status === 'streaming';
}

type Props = {
  boxes: PlaybookBox[];
  activeBoxId: string | null;
  activeStepIndex: number;
  variables: Record<string, string>;
  masterPlaybook: string;
  voiceId: string;
  voiceSettings: VoiceSettings;
  voicePresets: (VoiceSettings | null)[];
  anthropicApiKey: string;
  elevenLabsApiKey: string;
  onPositionChange: (boxId: string, stepIndex: number, variableUpdates: Record<string, string>) => void;
  onVoiceSettingsChange: (settings: VoiceSettings) => void;
  onSaveVoicePreset: (index: number, settings: VoiceSettings) => void;
  // 'phone' = the iPhone app's talk-only view: just the conversation and
  // the hands-free mic. Everything for building/tuning a flow (voice
  // settings, presets, variables, typed input) stays on the computer.
  variant?: 'studio' | 'phone';
  // Lets the phone app set the hands-free pause from its own settings
  // instead of the slider that only exists in the studio layout.
  pauseSecondsOverride?: number;
  onReset?: () => void;
  /** See StudioState.smartJumps. Defaults to on. */
  smartJumps?: boolean;
  onSmartJumpsChange?: (on: boolean) => void;
};

function voiceSettingsQuery(settings: VoiceSettings): string {
  return (
    `&stability=${settings.stability}` +
    `&similarityBoost=${settings.similarityBoost}` +
    `&style=${settings.style}` +
    `&speed=${settings.speed}` +
    `&speakerBoost=${settings.useSpeakerBoost}`
  );
}

const VOICE_TEST_PHRASE = 'Hi there, this is what I sound like right now. Pretty good, right?';

export function ChatPanel({
  boxes,
  activeBoxId,
  activeStepIndex,
  variables,
  masterPlaybook,
  voiceId,
  voiceSettings,
  voicePresets,
  anthropicApiKey,
  elevenLabsApiKey,
  onPositionChange,
  onVoiceSettingsChange,
  onSaveVoicePreset,
  variant = 'studio',
  pauseSecondsOverride,
  onReset,
  smartJumps = true,
  onSmartJumpsChange,
}: Props) {
  const boxesRef = useRef(boxes);
  const activeBoxIdRef = useRef(activeBoxId);
  const activeStepIndexRef = useRef(activeStepIndex);
  const variablesRef = useRef(variables);
  const masterPlaybookRef = useRef(masterPlaybook);
  const anthropicApiKeyRef = useRef(anthropicApiKey);
  const smartJumpsRef = useRef(smartJumps);

  useEffect(() => {
    boxesRef.current = boxes;
    activeBoxIdRef.current = activeBoxId;
    activeStepIndexRef.current = activeStepIndex;
    variablesRef.current = variables;
    masterPlaybookRef.current = masterPlaybook;
    anthropicApiKeyRef.current = anthropicApiKey;
    smartJumpsRef.current = smartJumps;
  });

  const transport = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- `body` is a lazy callback invoked per-request, not during render
      new DefaultChatTransport<ChatUIMessage>({
        api: '/api/chat',
        body: () => ({
          activeBoxId: activeBoxIdRef.current,
          activeStepIndex: activeStepIndexRef.current,
          variables: variablesRef.current,
          boxes: boxesRef.current.map((b) => ({
            id: b.id,
            label: b.label,
            steps: b.steps,
            leadsTo: b.leadsTo,
          })),
          masterPlaybook: masterPlaybookRef.current,
          anthropicApiKey: anthropicApiKeyRef.current,
          smartJumps: smartJumpsRef.current,
        }),
      }),
    [],
  );

  const { messages, setMessages, sendMessage, status, stop, error } = useChat<ChatUIMessage>({
    transport,
  });

  const [inputValue, setInputValue] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [voiceTestError, setVoiceTestError] = useState<string | null>(null);
  const spokenIds = useRef(new Set<string>());
  const appliedPositions = useRef(new Set<string>());
  const warmedRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // The one <audio> element every reply is ever played through — see
  // unlockAudio/speak below for why this needs to be a single reused
  // element rather than a fresh one per reply.
  const sharedAudioRef = useRef<HTMLAudioElement | null>(null);

  // iOS Safari only allows audio playback that's tied to a real tap, and
  // that permission is granted per-element, not page-wide — so the fix
  // isn't "play something once," it's "play this exact element once, then
  // always reuse this exact element." Called from both mic buttons' tap
  // handlers; safe to call repeatedly (a mic toggled on and off a few
  // times just re-unlocks the same element, effectively a no-op).
  const unlockAudio = () => {
    try {
      const audio = sharedAudioRef.current ?? new Audio();
      sharedAudioRef.current = audio;
      audio.src = 'data:audio/wav;base64,UklGRiQAAAAWQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
      audio.play().catch(() => {});
    } catch {
      // Not fatal either way — worst case, iOS still blocks the real replies.
    }
  };

  // Hands-free voice mode (the blue mic) — kept entirely separate from the
  // manual mic/Send above so that path is untouched and easy to fall back
  // to. Listens continuously, auto-sends after a pause in speech, and mutes
  // itself while the bot is talking so it can't pick up its own voice.
  const [autoModeOn, setAutoModeOn] = useState(false);
  const [autoListening, setAutoListening] = useState(false);
  // Adjustable via the slider next to "Reset conversation", 0–3s in 0.2s
  // steps; 3s was the original fixed value.
  const [pauseSecondsState, setPauseSeconds] = useState(3);
  const pauseSeconds = pauseSecondsOverride ?? pauseSecondsState;
  const autoRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Set while a native (Capacitor) recognition session is active — the
  // native plugin has no object-per-session handle the way the browser's
  // SpeechRecognition does, so this stands in for "is one running" on that
  // platform. See startNativeListening/stopListening below.
  const nativeSessionActiveRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors of state read from inside recognition callbacks, which close
  // over whatever these were at recognition-start time — same pattern as
  // activeBoxIdRef above, needed because onresult/onend fire well after
  // that render.
  const autoModeOnRef = useRef(false);
  const speakingIdRef = useRef<string | null>(null);
  const statusRef = useRef(status);
  const pauseSecondsRef = useRef(3);
  const rapidFailCountRef = useRef(0);
  // Guards against a real race at short pause settings: the instant an
  // auto-send fires, a fresh recognition session starts right back up
  // (nothing else is happening yet — the bot hasn't started replying, so
  // there's nothing to mute for) and can pick up the tail end of the
  // visitor's own last utterance — trailing audio, breath, room echo — as
  // if it were a brand new one, sending the same text again a moment
  // later. A short cooldown before listening resumes, plus refusing to
  // resend identical text right after sending it, closes both the timing
  // gap and its symptom.
  const RESTART_COOLDOWN_MS = 700;
  const DEDUPE_WINDOW_MS = 4000;
  const lastAutoSendRef = useRef<{ text: string; at: number } | null>(null);

  // iOS Safari's speech recognition can go silently unresponsive while
  // still reporting itself as active — no error, no onend, just a session
  // that stops actually hearing anything. Left alone, only iOS's own
  // internal timeout (observed at 20-30s) eventually ends it. Tracking the
  // last time anything real happened lets a watchdog notice much sooner
  // and force a fresh session instead of waiting that out.
  const WATCHDOG_STALL_MS = 8000;
  const lastRecognitionActivityRef = useRef(0);

  // Warm the ElevenLabs connection the moment this panel mounts.
  useEffect(() => {
    if (warmedRef.current) return;
    warmedRef.current = true;
    fetch(
      `/api/tts?text=${encodeURIComponent('Hi')}&voiceId=${encodeURIComponent(voiceId)}` +
        `&apiKey=${encodeURIComponent(elevenLabsApiKey)}${voiceSettingsQuery(voiceSettings)}`,
    )
      .then((res) => res.body?.cancel())
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const speak = useCallback(
    async (id: string, text: string) => {
      try {
        setSpeakingId(id);
        const streamUrl =
          `/api/tts?text=${encodeURIComponent(text)}&voiceId=${encodeURIComponent(voiceId)}` +
          `&apiKey=${encodeURIComponent(elevenLabsApiKey)}${voiceSettingsQuery(voiceSettings)}`;
        await new Promise<void>((resolve, reject) => {
          // Reuse the one shared, unlocked element (see unlockAudio below)
          // rather than `new Audio(...)` every time — iOS Safari's autoplay
          // permission is tied to a specific element having played inside a
          // real tap, not to the page in general, so a fresh element each
          // call would need re-unlocking every single time.
          const audio = sharedAudioRef.current ?? new Audio();
          sharedAudioRef.current = audio;
          audio.src = streamUrl;
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error('Audio playback failed'));
          audio.play().catch(reject);
        });
        setSpeakingId((current) => (current === id ? null : current));
      } catch (err) {
        console.error('ElevenLabs playback failed:', err);
        setSpeakingId((current) => (current === id ? null : current));
      }
    },
    [voiceId, elevenLabsApiKey, voiceSettings],
  );

  const testVoice = useCallback(async () => {
    setIsTestingVoice(true);
    setVoiceTestError(null);
    try {
      const streamUrl =
        `/api/tts?text=${encodeURIComponent(VOICE_TEST_PHRASE)}&voiceId=${encodeURIComponent(voiceId)}` +
        `&apiKey=${encodeURIComponent(elevenLabsApiKey)}${voiceSettingsQuery(voiceSettings)}`;
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(streamUrl);
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error('Could not play the test voice — check your ElevenLabs API key.'));
        audio.play().catch(reject);
      });
    } catch (err) {
      setVoiceTestError(err instanceof Error ? err.message : 'Could not play the test voice.');
    } finally {
      setIsTestingVoice(false);
    }
  }, [voiceId, elevenLabsApiKey, voiceSettings]);

  // Speak the most recent finished assistant reply, once, if voice is on.
  useEffect(() => {
    if (!voiceEnabled || status !== 'ready') return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || spokenIds.current.has(last.id)) return;
    const text = getMessageText(last.parts);
    if (!text) return;
    spokenIds.current.add(last.id);
    queueMicrotask(() => void speak(last.id, text));
  }, [messages, status, voiceEnabled, speak]);

  // Apply the server's deterministic new position (and any captured
  // variables) once a turn finishes — this is the app's own accounting, not
  // an LLM decision, so there's nothing to retry or second-guess here.
  useEffect(() => {
    if (status !== 'ready') return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || appliedPositions.current.has(last.id)) return;
    const position = getPosition(last.parts);
    if (!position?.boxId) return;
    appliedPositions.current.add(last.id);
    onPositionChange(position.boxId, position.stepIndex, position.variableUpdates);
  }, [messages, status, onPositionChange]);

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text || !activeBoxId) return;
    recognitionRef.current?.stop();
    setIsListening(false);
    sendMessage({ text });
    setInputValue('');
  };

  const startRecognition = (attempt = 1) => {
    const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      window.alert('Voice input isn’t supported in this browser. Try Chrome or Edge.');
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    // Keep listening until the mic is clicked again or a message is sent —
    // otherwise the browser stops it on its own after each pause in speech.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0]?.transcript ?? '')
        .join('');
      setInputValue(transcript);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    try {
      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);
    } catch {
      // The previous session's audio capture sometimes hasn't fully released
      // yet right after stop() — starting immediately throws. Give it a
      // moment and retry once before giving up.
      if (attempt < 3) {
        setTimeout(() => startRecognition(attempt + 1), 250);
      } else {
        setIsListening(false);
        window.alert('Could not start the microphone. Try clicking it again in a moment.');
      }
    }
  };

  const toggleMic = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }
    // The manual and hands-free mics share one physical mic input — only
    // one recognition session should ever run at a time.
    if (autoModeOn) setAutoModeOn(false);
    unlockAudio();
    startRecognition();
  };

  useEffect(() => {
    autoModeOnRef.current = autoModeOn;
    speakingIdRef.current = speakingId;
    statusRef.current = status;
    pauseSecondsRef.current = pauseSeconds;
  });

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  // Shared between the web (Web Speech API) and native (Capacitor plugin)
  // listening paths — same silence-timer/dedupe/cooldown-triggering logic
  // either way, so the two platforms can't drift out of sync on exactly
  // the behavior that took several rounds to get right. `stopSession` is
  // the one platform-specific part — "how do I actually end this session"
  // differs between a Web Speech API object and the native plugin.
  const handleAutoTranscript = (transcript: string, stopSession: () => void) => {
    lastRecognitionActivityRef.current = Date.now();
    setInputValue(transcript);
    // Reset the pause timer on every new bit of speech — only once this
    // goes quiet for the full window does the visitor's turn count as
    // finished. Captures `transcript` directly rather than reading
    // inputValue state back later, so there's nothing to go stale.
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      silenceTimerRef.current = null;
      const text = transcript.trim();
      const now = Date.now();
      const last = lastAutoSendRef.current;
      const isRepeat = last && now - last.at < DEDUPE_WINDOW_MS && last.text.toLowerCase() === text.toLowerCase();
      if (text && activeBoxIdRef.current && !isRepeat) {
        lastAutoSendRef.current = { text, at: now };
        sendMessage({ text });
        setInputValue('');
      }
      // Stop and let the platform-specific restart logic pick a fresh
      // session back up — continuous mode's transcript only ever grows,
      // so without this the next utterance would arrive with this one
      // still glued to the front of it.
      stopSession();
      // Read fresh each time rather than capturing once, so dragging the
      // slider mid-conversation takes effect on the very next pause.
    }, Math.round(pauseSecondsRef.current * 1000));
  };

  // Requests iOS speech-recognition + microphone permission once, the
  // first time hands-free mode is used natively — after that, checking is
  // enough. Returns whether it's now safe to actually start listening.
  const ensureNativeSpeechPermission = async (): Promise<boolean> => {
    const { speechRecognition } = await SpeechRecognition.checkPermissions();
    if (speechRecognition === 'granted') return true;
    const requested = await SpeechRecognition.requestPermissions();
    return requested.speechRecognition === 'granted';
  };

  // The native counterpart to startAutoRecognition below — same job
  // (start listening, feed results through handleAutoTranscript, restart
  // after a stop unless muted/mode off/a reply's in flight), but through
  // the Capacitor plugin wrapping iOS's real SFSpeechRecognizer instead of
  // the browser's SpeechRecognition. Its partialResults/listeningState
  // events are wired up once, for the component's lifetime, in the effect
  // below — this function only ever needs to kick a session off.
  const startNativeListening = async (attempt = 1) => {
    try {
      const { available } = await SpeechRecognition.available();
      if (!available) {
        window.alert('Speech recognition isn’t available on this device.');
        setAutoModeOn(false);
        return;
      }
      if (!(await ensureNativeSpeechPermission())) {
        window.alert(
          'Speech recognition permission was denied — enable it for this app in Settings to use hands-free mode.',
        );
        setAutoModeOn(false);
        return;
      }
      nativeSessionActiveRef.current = true;
      // eslint-disable-next-line react-hooks/purity -- same as startAutoRecognition's startedAt, only ever runs from an effect or a click handler
      lastRecognitionActivityRef.current = Date.now();
      setAutoListening(true);
      await SpeechRecognition.start({ language: 'en-US', partialResults: true });
    } catch {
      nativeSessionActiveRef.current = false;
      // Right after the bot's voice finishes, iOS can still be switching the
      // audio route back to the mic for a second or two ("Microphone not
      // ready yet") — back off progressively rather than giving up fast.
      if (attempt < 6) {
        setTimeout(() => {
          if (autoModeOnRef.current) startNativeListening(attempt + 1);
        }, 300 * attempt);
      } else {
        setAutoListening(false);
        setAutoModeOn(false);
        window.alert('Could not start the microphone. Try clicking it again in a moment.');
      }
    }
  };

  // Single entry point regardless of platform — every call site (toggle,
  // the "should be listening" effect, the watchdog, the restart-after-stop
  // logic below) just calls this, and it dispatches to the native plugin
  // when running inside the Capacitor shell, or the browser's Web Speech
  // API otherwise. Keeps the platform check in one place instead of
  // duplicated at every caller.
  const startAutoRecognition = (attempt = 1) => {
    if (Capacitor.isNativePlatform()) {
      void startNativeListening(attempt);
      return;
    }
    const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      window.alert('Voice input isn’t supported in this browser. Try Chrome or Edge.');
      setAutoModeOn(false);
      return;
    }
    // eslint-disable-next-line react-hooks/purity -- startAutoRecognition only ever runs from an effect or a click handler, never during render
    const startedAt = Date.now();
    // Tracks whether THIS session's end was our own doing (stopped right
    // after a successful auto-send) vs. Chrome ending it unprompted (denied
    // permission, no mic, etc.) — a short pause setting makes short-but-
    // healthy sessions normal, so only the latter should count toward the
    // rapid-failure safety net below.
    let stoppedAfterSend = false;
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0]?.transcript ?? '')
        .join('');
      handleAutoTranscript(transcript, () => {
        stoppedAfterSend = true;
        autoRecognitionRef.current?.stop();
      });
    };
    recognition.onerror = () => setAutoListening(false);
    recognition.onend = () => {
      autoRecognitionRef.current = null;
      setAutoListening(false);
      // A session that ended almost immediately (denied mic permission, no
      // mic present, etc.) would otherwise retry forever, silently, on
      // every tick — count consecutive rapid failures and give up with a
      // clear message instead of spinning. A session we stopped ourselves
      // after a successful send is never a failure, however short it ran —
      // a low pause setting makes that the normal case, not a problem.
      if (stoppedAfterSend) {
        rapidFailCountRef.current = 0;
      } else if (Date.now() - startedAt < 1000) {
        rapidFailCountRef.current += 1;
      } else {
        rapidFailCountRef.current = 0;
      }
      if (rapidFailCountRef.current >= 3) {
        setAutoModeOn(false);
        window.alert('The microphone keeps failing to start — check mic permission for this site, then try again.');
        return;
      }
      // Chrome's continuous mode can end on its own well before the
      // visitor turns the mic off — pick it back up automatically as long
      // as hands-free mode is still on, the bot isn't mid-reply, and no
      // reply is currently in flight (`status`) — that last check matters
      // on iOS specifically, where every stop/start cycle triggers a
      // system beep: without it, a just-sent turn would restart here, then
      // immediately get stopped again seconds later once the reply starts
      // speaking — two extra, avoidable beeps every single turn. Checking
      // "not in flight" rather than "status is ready" specifically, since
      // status also lands on 'error' after any failed request and nothing
      // but a fresh send ever moves it off that — gating on 'ready' alone
      // would permanently wedge the mic off after a single hiccup.
      if (autoModeOnRef.current && !speakingIdRef.current && !isRequestInFlight(statusRef.current)) {
        const sinceLastSend = lastAutoSendRef.current ? Date.now() - lastAutoSendRef.current.at : Infinity;
        const remaining = RESTART_COOLDOWN_MS - sinceLastSend;
        if (remaining > 0) {
          setTimeout(() => {
            if (autoModeOnRef.current && !speakingIdRef.current && !isRequestInFlight(statusRef.current)) startAutoRecognition();
          }, remaining);
        } else {
          startAutoRecognition();
        }
      }
    };
    try {
      recognition.start();
      autoRecognitionRef.current = recognition;
      // eslint-disable-next-line react-hooks/purity -- same as startedAt above, only ever runs from an effect or a click handler
      lastRecognitionActivityRef.current = Date.now();
      setAutoListening(true);
    } catch {
      if (attempt < 3) {
        setTimeout(() => startAutoRecognition(attempt + 1), 250);
      } else {
        setAutoListening(false);
        setAutoModeOn(false);
        window.alert('Could not start the microphone. Try clicking it again in a moment.');
      }
    }
  };

  // Dispatches a stop to whichever platform's session is actually running.
  // On native this only fires the request — nativeSessionActiveRef itself
  // gets cleared by the listeningState('stopped') handler below, once iOS
  // confirms it, not optimistically here.
  const stopListening = () => {
    if (Capacitor.isNativePlatform()) {
      if (nativeSessionActiveRef.current) SpeechRecognition.stop().catch(() => {});
    } else {
      autoRecognitionRef.current?.stop();
    }
  };

  const hasActiveSession = () =>
    Capacitor.isNativePlatform() ? nativeSessionActiveRef.current : Boolean(autoRecognitionRef.current);

  // The native plugin has no per-session object with its own onresult/onend
  // — instead it emits two app-wide events, wired up once here for the
  // component's lifetime rather than per session. partialResults feeds the
  // exact same handleAutoTranscript path the web recognition object uses;
  // listeningState('stopped') mirrors the web path's onend restart logic
  // (see the matching comment there for why the in-flight check matters).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const partialSub = SpeechRecognition.addListener('partialResults', (data) => {
      const transcript = data.matches?.[0] ?? '';
      handleAutoTranscript(transcript, () => {
        nativeSessionActiveRef.current = false;
        SpeechRecognition.stop().catch(() => {});
      });
    });
    const stateSub = SpeechRecognition.addListener('listeningState', (data) => {
      if (data.status === 'started') {
        nativeSessionActiveRef.current = true;
        lastRecognitionActivityRef.current = Date.now();
        setAutoListening(true);
        return;
      }
      nativeSessionActiveRef.current = false;
      setAutoListening(false);
      if (autoModeOnRef.current && !speakingIdRef.current && !isRequestInFlight(statusRef.current)) {
        const sinceLastSend = lastAutoSendRef.current ? Date.now() - lastAutoSendRef.current.at : Infinity;
        const remaining = RESTART_COOLDOWN_MS - sinceLastSend;
        if (remaining > 0) {
          setTimeout(() => {
            if (autoModeOnRef.current && !speakingIdRef.current && !isRequestInFlight(statusRef.current)) {
              startAutoRecognition();
            }
          }, remaining);
        } else {
          startAutoRecognition();
        }
      }
    });
    return () => {
      partialSub.then((h) => h.remove()).catch(() => {});
      stateSub.then((h) => h.remove()).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleAutoTranscript/startAutoRecognition are stable enough for this; registered once for the component's lifetime, not per session
  }, []);

  // The single source of truth for "should the hands-free mic be running
  // right now" — on when the mode is toggled on, the bot isn't talking, and
  // no reply is currently in flight (`status`), off otherwise. Covers
  // turning the mode on/off and muting/resuming around a whole turn (reply
  // generation + speech) from one place, rather than restarting partway
  // through and immediately stopping again — see the matching comment in
  // startAutoRecognition's onend for why that extra cycle matters on iOS.
  useEffect(() => {
    if (autoModeOn && !speakingId && !isRequestInFlight(status)) {
      if (!hasActiveSession()) startAutoRecognition();
    } else {
      stopListening();
      clearSilenceTimer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startAutoRecognition is stable enough for this; re-running it on its own identity would defeat the point
  }, [autoModeOn, speakingId, status]);

  // Watchdog for the iOS "still reports listening, silently isn't" failure
  // mode described above — checks every couple of seconds while a session
  // should be live, and force-restarts it if nothing (not even an interim
  // result) has happened in a while. Only runs while actually supposed to
  // be listening, so it never fights the deliberate stops (muted for bot
  // speech, cooldown after a send, mode off). Primarily a web-path concern
  // — the native plugin wraps a real SFSpeechRecognizer session and isn't
  // expected to silently go dead the same way, but there's no real cost to
  // covering both, and it's a useful safety net either way.
  useEffect(() => {
    if (!autoModeOn) return;
    const interval = setInterval(() => {
      if (!hasActiveSession()) return;
      if (Date.now() - lastRecognitionActivityRef.current > WATCHDOG_STALL_MS) {
        // .stop() is async — the eventual onend/listeningState (which
        // clears the active-session tracking and re-stamps activity on the
        // next session) may not have fired before the next tick. Stamping
        // here too means a still-stopping session isn't stopped again
        // every 2s until it actually finishes — repeated stop() calls on
        // one session, on an engine already this unreliable, seemed like a
        // real way to make things worse rather than better.
        lastRecognitionActivityRef.current = Date.now();
        stopListening();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [autoModeOn]);

  const toggleAutoMode = () => {
    if (autoModeOn) {
      setAutoModeOn(false);
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    }
    unlockAudio();
    rapidFailCountRef.current = 0;
    setInputValue('');
    setAutoModeOn(true);
  };

  const activeBox = boxes.find((b) => b.id === activeBoxId);
  const variableEntries = Object.entries(variables);

  const conversation = (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-2">
      {messages.length === 0 && (
        <p className="text-center font-label text-[11px] uppercase tracking-widest text-muted-ink">
          {variant === 'phone'
            ? 'Tap the blue mic and say hello.'
            : activeBoxId
              ? 'Say hello to start testing this playbook.'
              : 'Select a playbook box to begin.'}
        </p>
      )}
      {messages.map((m) => {
        const text = getMessageText(m.parts);
        const transitions = m.role === 'assistant' ? getPosition(m.parts)?.transitions ?? [] : [];
        return (
          <div key={m.id}>
            {variant === 'studio' && transitions.map((t, i) => (
              <div key={`${t.toBoxId}-${i}`} className="my-2 flex justify-center">
                <span className="border border-ink px-2.5 py-0.5 font-label text-[10px] uppercase tracking-widest text-ink">
                  {t.toStepNumber ? `↝ Smart jump to step ${t.toStepNumber}` : `↝ Moved to ${t.toLabel}`}
                </span>
              </div>
            ))}
            {text && (
              <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] px-3 py-2 font-body text-sm ${
                    m.role === 'user' ? 'bg-ink text-paper' : 'border-2 border-ink bg-paper text-ink'
                  }`}
                >
                  {text}
                  {speakingId === m.id && (
                    <span className="ml-1.5 font-label text-[10px] uppercase tracking-widest text-muted-ink">
                      speaking…
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {error && (
        <div className="flex justify-start">
          <div className="max-w-[85%] bg-ink px-3 py-2 text-paper">
            <span className="font-label text-[10px] uppercase tracking-widest">Error — </span>
            <span className="font-body text-sm">{error.message}</span>
          </div>
        </div>
      )}
      {!error && status === 'ready' && (() => {
        const last = messages[messages.length - 1];
        if (!last || last.role !== 'assistant' || getMessageText(last.parts)) return null;
        // A real dead end (the table ran out, or a NAV step landed in a
        // box with no steps yet) — not a retry-able failure, just nothing
        // more configured at this point in the flow.
        const transitioned = (getPosition(last.parts)?.transitions.length ?? 0) > 0;
        return (
          <div className="flex justify-start">
            <div className="max-w-[85%] border-4 border-ink px-3 py-2">
              <span className="font-label text-[10px] uppercase tracking-widest text-ink">Note — </span>
              <span className="font-body text-sm text-ink">
                {variant === 'phone'
                  ? 'End of the conversation.'
                  : transitioned
                  ? 'The flow moved playbooks but there was nothing to say there — check that box has steps.'
                  : 'Nothing left in this playbook’s step table from here. Add more steps, or a NAV step to move on.'}
              </span>
            </div>
          </div>
        );
      })()}
    </div>
  );

  const statusLine = autoModeOn && (
    <div className="flex items-center gap-2 pt-2 font-label text-[10px] uppercase tracking-widest text-muted-ink">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          speakingId ? 'bg-ink' : autoListening ? 'animate-pulse bg-[#18a0fb]' : 'bg-hair'
        }`}
        aria-hidden="true"
      />
      {speakingId
        ? 'Bot is speaking — mic paused so it can’t hear itself'
        : isRequestInFlight(status)
          ? 'Waiting for a reply…'
          : autoListening
            ? 'Listening…'
            : 'Reconnecting the mic…'}
    </div>
  );

  if (variant === 'phone') {
    return (
      <div className="flex h-full flex-col gap-3">
        {conversation}
        {statusLine}
        <div className="grid grid-cols-3 items-center border-t-2 border-ink pt-4">
          <button
            onClick={() => {
              stop();
              setMessages([]);
              onReset?.();
            }}
            disabled={messages.length === 0}
            className={`justify-self-start ${buttonOutline}`}
          >
            Restart
          </button>
          <button
            onClick={toggleAutoMode}
            aria-label={autoModeOn ? 'Turn the microphone off' : 'Turn the microphone on'}
            className={`flex h-[76px] w-[76px] items-center justify-center justify-self-center rounded-full border-2 border-[#18a0fb] text-3xl transition-colors duration-100 ${
              autoModeOn ? 'bg-[#18a0fb] text-white' : 'bg-paper text-[#18a0fb]'
            }`}
          >
            🎙️
          </button>
          <span className="justify-self-end font-label text-[10px] uppercase tracking-widest text-muted-ink">
            {autoModeOn ? 'Tap to stop' : 'Tap to talk'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b-2 border-ink pb-3">
        <div className="font-label text-[11px] uppercase tracking-widest text-muted-ink">
          Active playbook: <span className="text-ink">{activeBox?.label ?? 'None'}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-1.5 font-label text-[11px] uppercase tracking-widest text-muted-ink">
            <input
              type="checkbox"
              checked={voiceEnabled}
              onChange={(e) => setVoiceEnabled(e.target.checked)}
              className="accent-ink"
            />
            Voice replies
          </label>
          {onSmartJumpsChange && (
            <label
              className="flex items-center gap-1.5 font-label text-[11px] uppercase tracking-widest text-muted-ink"
              title="When a branch points back to its own playbook, jump to the step it most likely means instead of restarting the playbook. Check what it decided in Flow Snapshot."
            >
              <input
                type="checkbox"
                checked={smartJumps}
                onChange={(e) => onSmartJumpsChange(e.target.checked)}
                className="accent-ink"
              />
              Smart jumps
            </label>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-stretch gap-2">
        <VoiceSettingsPanel value={voiceSettings} onChange={onVoiceSettingsChange} />
        <button
          onClick={testVoice}
          disabled={isTestingVoice}
          title="Play a test line with the current voice settings"
          className={`flex flex-col items-center justify-center gap-0.5 ${buttonOutline}`}
        >
          <span className="text-base leading-none">🔊</span>
          {isTestingVoice ? 'Playing…' : 'Test voice'}
        </button>
        <VoicePresetButtons
          presets={voicePresets}
          currentSettings={voiceSettings}
          onApply={onVoiceSettingsChange}
          onSave={onSaveVoicePreset}
        />
        <button
          onClick={() => {
            stop();
            setMessages([]);
            if (activeBoxId) onPositionChange(activeBoxId, 0, {});
          }}
          disabled={messages.length === 0}
          title="Clear every message in this conversation"
          className={buttonOutline}
        >
          Reset conversation
        </button>
        <label
          className="flex items-center gap-2 border-2 border-ink bg-paper px-3 py-2 font-label text-[10px] uppercase tracking-wide text-ink"
          title="How long hands-free voice (the blue mic) waits after you stop talking before it auto-sends"
        >
          Hands-free pause
          <input
            type="range"
            min={0}
            max={3}
            step={0.2}
            value={pauseSeconds}
            onChange={(e) => setPauseSeconds(Number(e.target.value))}
            className="accent-ink"
          />
          <span className="tabular-nums normal-case text-muted-ink">{pauseSeconds.toFixed(1)}s</span>
        </label>
      </div>
      {voiceTestError && (
        <p className="border-l-4 border-ink pl-2 font-label text-[10px] uppercase tracking-wide text-ink">
          {voiceTestError}
        </p>
      )}

      {variableEntries.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-ink pb-3 font-label text-[10px] uppercase tracking-wide text-muted-ink">
          <span>Variables:</span>
          {variableEntries.map(([key, value]) => (
            <span key={key} className="text-ink">
              {key}=&ldquo;{value}&rdquo;
            </span>
          ))}
        </div>
      )}

      {conversation}

      {statusLine}

      <div className="flex items-center gap-2 border-t-2 border-ink pt-3">
        <button
          onClick={toggleMic}
          className={`h-[38px] w-[38px] shrink-0 ${buttonIcon} ${isListening ? 'bg-ink text-paper' : ''}`}
          title="Voice input — click to talk, click Send when done"
        >
          🎤
        </button>
        <button
          onClick={toggleAutoMode}
          className={`h-[38px] w-[38px] shrink-0 border-2 font-body text-base transition-colors duration-100 ${
            autoModeOn
              ? 'border-[#18a0fb] bg-[#18a0fb] text-white'
              : 'border-[#18a0fb] bg-paper text-[#18a0fb] hover:bg-[#18a0fb] hover:text-white'
          }`}
          title={
            autoModeOn
              ? autoListening
                ? `Hands-free voice is on and listening — sends automatically ${pauseSeconds.toFixed(1)}s after you stop talking`
                : 'Hands-free voice is on, paused while the bot is speaking'
              : 'Hands-free voice — stays open and auto-sends after a pause (adjustable below), no Send needed (experimental, test build)'
          }
        >
          🎙️
        </button>
        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSend();
          }}
          disabled={!activeBoxId}
          placeholder={activeBoxId ? 'Type a message…' : 'Select a playbook box first'}
          className={`flex-1 disabled:bg-muted ${fieldInput}`}
        />
        <button onClick={handleSend} disabled={!activeBoxId || !inputValue.trim()} className={buttonPrimary}>
          Send
        </button>
      </div>
    </div>
  );
}
