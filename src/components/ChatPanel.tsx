'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage, type UIDataTypes } from 'ai';
import type { PlaybookBox, VoiceSettings } from '@/lib/types';
import { VoiceSettingsPanel } from './VoiceSettingsPanel';
import { VoicePresetButtons } from './VoicePresetButtons';
import { buttonIcon, buttonOutline, buttonPrimary, fieldInput } from '@/lib/styles';

type ChangeStageTool = {
  input: { stageId: string; reason: string };
  output: { stageId: string; reason: string };
};
type ChatUIMessage = UIMessage<never, UIDataTypes, { changeStage: ChangeStageTool }>;

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

type ChangeStagePart = Extract<ChatUIMessage['parts'][number], { type: 'tool-changeStage' }>;

/**
 * With the default `stopWhen` (stop after step 1 — see rebuild spec Priority
 * Directive #1), a tool's `execute` function never actually runs, so its part
 * never reaches the `output-available` state — it stops at `input-available`
 * with the full input already present. That state is final for this turn, so
 * treat it (as well as `output-available`, in case behavior ever differs) as
 * the point where the tool call is ready to act on.
 */
function findChangeStageCall(parts: ChatUIMessage['parts']): ChangeStagePart | undefined {
  return parts.find(
    (p): p is ChangeStagePart =>
      p.type === 'tool-changeStage' && (p.state === 'input-available' || p.state === 'output-available'),
  );
}

// The model is told to always write spoken reply text alongside a
// changeStage call, but it doesn't always comply — when it skips the text,
// there is no real spoken content for this turn. Do NOT fall back to the
// tool call's `reason` field here: that's an internal, third-person note
// ("patient confirmed they want an appointment; proceeding to booking
// playbook") never meant to be read aloud to the patient, and showing it as
// if it were dialogue is exactly the "off-script line" bug this guards
// against. Callers should treat an empty return as "nothing was said" and
// show their own fallback, not synthesize text from tool internals.
function getMessageText(parts: ChatUIMessage['parts']): string {
  return parts
    .filter((p): p is Extract<ChatUIMessage['parts'][number], { type: 'text' }> => p.type === 'text')
    .map((p) => p.text ?? '')
    .join(' ')
    .trim();
}

type Props = {
  boxes: PlaybookBox[];
  activeBoxId: string | null;
  masterPlaybook: string;
  voiceId: string;
  voiceSettings: VoiceSettings;
  voicePresets: (VoiceSettings | null)[];
  anthropicApiKey: string;
  elevenLabsApiKey: string;
  onActiveBoxChange: (id: string) => void;
  onVoiceSettingsChange: (settings: VoiceSettings) => void;
  onSaveVoicePreset: (index: number, settings: VoiceSettings) => void;
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
  masterPlaybook,
  voiceId,
  voiceSettings,
  voicePresets,
  anthropicApiKey,
  elevenLabsApiKey,
  onActiveBoxChange,
  onVoiceSettingsChange,
  onSaveVoicePreset,
}: Props) {
  const boxesRef = useRef(boxes);
  const activeBoxIdRef = useRef(activeBoxId);
  const masterPlaybookRef = useRef(masterPlaybook);
  const anthropicApiKeyRef = useRef(anthropicApiKey);

  useEffect(() => {
    boxesRef.current = boxes;
    activeBoxIdRef.current = activeBoxId;
    masterPlaybookRef.current = masterPlaybook;
    anthropicApiKeyRef.current = anthropicApiKey;
  });

  const transport = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- `body` is a lazy callback invoked per-request, not during render
      new DefaultChatTransport<ChatUIMessage>({
        api: '/api/chat',
        body: () => ({
          activeBoxId: activeBoxIdRef.current,
          boxes: boxesRef.current.map((b) => ({ id: b.id, label: b.label, instructions: b.instructions })),
          masterPlaybook: masterPlaybookRef.current,
          anthropicApiKey: anthropicApiKeyRef.current,
        }),
      }),
    [],
  );

  const { messages, setMessages, sendMessage, status, stop, error } = useChat<ChatUIMessage>({ transport });

  const [inputValue, setInputValue] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [voiceTestError, setVoiceTestError] = useState<string | null>(null);
  const spokenIds = useRef(new Set<string>());
  const handledTransitions = useRef(new Set<string>());
  const warmedRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

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
          const audio = new Audio(streamUrl);
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

  // React to a changeStage tool call, once per unique toolCallId.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    for (const part of last.parts) {
      if (
        part.type === 'tool-changeStage' &&
        (part.state === 'input-available' || part.state === 'output-available') &&
        !handledTransitions.current.has(part.toolCallId)
      ) {
        handledTransitions.current.add(part.toolCallId);
        const stageId = part.input?.stageId;
        if (stageId) queueMicrotask(() => onActiveBoxChange(stageId));
      }
    }
  }, [messages, onActiveBoxChange]);

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
    startRecognition();
  };

  const activeBox = boxes.find((b) => b.id === activeBoxId);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between border-b-2 border-ink pb-3">
        <div className="font-label text-[11px] uppercase tracking-widest text-muted-ink">
          Active playbook: <span className="text-ink">{activeBox?.label ?? 'None'}</span>
        </div>
        <label className="flex items-center gap-1.5 font-label text-[11px] uppercase tracking-widest text-muted-ink">
          <input
            type="checkbox"
            checked={voiceEnabled}
            onChange={(e) => setVoiceEnabled(e.target.checked)}
            className="accent-ink"
          />
          Voice replies
        </label>
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
          }}
          disabled={messages.length === 0}
          title="Clear every message in this conversation"
          className={buttonOutline}
        >
          Reset conversation
        </button>
      </div>
      {voiceTestError && (
        <p className="border-l-4 border-ink pl-2 font-label text-[10px] uppercase tracking-wide text-ink">
          {voiceTestError}
        </p>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto py-2">
        {messages.length === 0 && (
          <p className="text-center font-label text-[11px] uppercase tracking-widest text-muted-ink">
            {activeBoxId ? 'Say hello to start testing this playbook.' : 'Select a playbook box to begin.'}
          </p>
        )}
        {messages.map((m) => {
          const text = getMessageText(m.parts);
          const transitionCall = findChangeStageCall(m.parts);
          const transitionLabel = transitionCall
            ? boxes.find((b) => b.id === transitionCall.input?.stageId)?.label
            : null;
          return (
            <div key={m.id}>
              {transitionLabel && (
                <div className="my-2 flex justify-center">
                  <span className="border border-ink px-2.5 py-0.5 font-label text-[10px] uppercase tracking-widest text-ink">
                    ↝ Moved to {transitionLabel}
                  </span>
                </div>
              )}
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
          if (!last) return null;
          const noReplyText =
            last.role === 'user' || (last.role === 'assistant' && !getMessageText(last.parts));
          if (!noReplyText) return null;
          // The stage-change tag above (if any) is real and already applied —
          // only the spoken line is missing. Say so honestly rather than
          // inventing dialogue from the tool call's internal `reason` field.
          const transitioned = last.role === 'assistant' && Boolean(findChangeStageCall(last.parts));
          return (
            <div className="flex justify-start">
              <div className="max-w-[85%] border-4 border-ink px-3 py-2">
                <span className="font-label text-[10px] uppercase tracking-widest text-ink">Note — </span>
                <span className="font-body text-sm text-ink">
                  {transitioned
                    ? 'The agent moved playbooks but didn’t say anything to the patient this turn. Send another message to continue.'
                    : 'The agent finished without sending any text or action for this turn. Try rephrasing, or check your API key under “API keys” in the header.'}
                </span>
              </div>
            </div>
          );
        })()}
      </div>

      <div className="flex items-center gap-2 border-t-2 border-ink pt-3">
        <button
          onClick={toggleMic}
          className={`h-[38px] w-[38px] shrink-0 ${buttonIcon} ${isListening ? 'bg-ink text-paper' : ''}`}
          title="Voice input"
        >
          🎤
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
