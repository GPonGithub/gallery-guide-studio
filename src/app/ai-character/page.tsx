'use client';

/**
 * Test bench for the AI character (AiCharacterOrb): the orb full screen on black, made to speak a
 * line with the ElevenLabs voice saved in the Chatbot Designer (this browser, this team), or a
 * built-in test voice that needs no key. Open at /ai-character.
 */

import { useRef, useState } from 'react';
import AiCharacterOrb from '@/components/agent/AiCharacterOrb';
import { voiceAnalyser } from '@/lib/agent/voiceLevel';

const STORAGE_KEY = 'gallery-guide-agent:v1'; // the Chatbot Designer's saved settings (src/app/agent/page.tsx)
const TEST_VOICE = '/ai-character/test-voice.m4a';

function savedVoice(): { apiKey: string; voiceId: string } {
  try {
    const s = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as {
      elevenLabsApiKey?: string;
      voiceId?: string;
    };
    return { apiKey: s.elevenLabsApiKey?.trim() ?? '', voiceId: s.voiceId?.trim() ?? '' };
  } catch {
    return { apiKey: '', voiceId: '' };
  }
}

export default function AiCharacterTestPage() {
  const [text, setText] = useState(
    "Hello, everyone, and welcome to the Immersive Lab. I'm Maya. Let's take a look at how we can transform this room.",
  );
  const [color, setColor] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = async (src: string, release?: () => void) => {
    audioRef.current?.pause();
    const ctx = (ctxRef.current ??= new AudioContext());
    if (ctx.state === 'suspended') await ctx.resume();
    const audio = new Audio(src);
    const node = ctx.createMediaElementSource(audio);
    node.connect(ctx.destination);
    node.connect(voiceAnalyser(ctx));
    audioRef.current = audio;
    audio.onended = () => {
      setStatus('');
      release?.();
    };
    await audio.play();
  };

  const speak = async () => {
    const { apiKey, voiceId } = savedVoice();
    if (!apiKey) {
      setStatus(
        'No ElevenLabs key saved in this browser — add it in the Chatbot Designer (Keys), or use the test voice.',
      );
      return;
    }
    setBusy(true);
    setStatus('Asking ElevenLabs…');
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceId, apiKey }),
      });
      if (!res.ok) throw new Error((await res.text()) || `ElevenLabs said ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      setStatus('Speaking (ElevenLabs)');
      await play(url, () => URL.revokeObjectURL(url));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const testVoice = async () => {
    setStatus('Speaking (test voice)');
    try {
      await play(TEST_VOICE);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const button =
    'rounded-full border border-white/20 px-4 py-2 text-sm text-white/90 hover:bg-white/10 disabled:opacity-40';
  return (
    <main className="flex h-screen flex-col bg-black text-white">
      <div className="min-h-0 flex-1">
        <AiCharacterOrb color={color} />
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pb-6">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-xl border border-white/15 bg-white/5 p-3 text-sm text-white/90 outline-none focus:border-white/40"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button className={button} disabled={busy || !text.trim()} onClick={speak}>
            Speak with ElevenLabs
          </button>
          <button className={button} onClick={testVoice}>
            Play test voice
          </button>
          <button className={button} onClick={() => audioRef.current?.pause()}>
            Stop
          </button>
          <span className="ml-auto flex items-center gap-2 text-sm text-white/70">
            Colour
            <input
              type="color"
              value={color ?? '#36d6ff'}
              onChange={(e) => setColor(e.target.value)}
              className="h-8 w-10 cursor-pointer rounded border border-white/20 bg-transparent"
            />
            <button className={button} onClick={() => setColor(null)} disabled={color === null}>
              Spectrum
            </button>
          </span>
        </div>
        <p className="min-h-5 text-xs text-white/50">{status}</p>
      </div>
    </main>
  );
}
