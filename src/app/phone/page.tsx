'use client';

import { useEffect, useState } from 'react';
import { ChatPanel } from '@/components/ChatPanel';
import { decodePhonePayload, type PhonePayload } from '@/lib/phonePayload';
import type { VoiceSettings } from '@/lib/types';
import { buttonOutline, fieldInput, fieldLabel } from '@/lib/styles';

// A separate, minimal entry point for testing a conversation on a phone —
// deliberately its own page rather than a responsive version of the main
// editor. Reads its whole starting state from the URL fragment (see
// phonePayload.ts and PhoneTestingModal.tsx, which generate that link from
// the main app) and otherwise runs fully independently: its own local
// React state, its own tiny localStorage slot for API keys, no connection
// back to the main app's StudioState at all.
const PHONE_KEYS_STORAGE = 'gallery-guide-studio:phone-keys';

type PhoneKeys = { anthropicApiKey: string; elevenLabsApiKey: string };
const EMPTY_KEYS: PhoneKeys = { anthropicApiKey: '', elevenLabsApiKey: '' };

function loadPhoneKeys(): PhoneKeys {
  try {
    const raw = window.localStorage.getItem(PHONE_KEYS_STORAGE);
    if (!raw) return EMPTY_KEYS;
    return { ...EMPTY_KEYS, ...(JSON.parse(raw) as Partial<PhoneKeys>) };
  } catch {
    return EMPTY_KEYS;
  }
}

export default function PhonePage() {
  const [payload, setPayload] = useState<PhonePayload | null | undefined>(undefined);
  const [keys, setKeys] = useState<PhoneKeys>(EMPTY_KEYS);
  const [activeBoxId, setActiveBoxId] = useState<string | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings | null>(null);
  const [voicePresets, setVoicePresets] = useState<(VoiceSettings | null)[]>([null, null, null, null]);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const decoded = hash ? decodePhonePayload(hash) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only: reading the URL fragment and this device's own localStorage, neither exists during SSR
    setPayload(decoded);
    if (decoded) {
      setVoiceSettings(decoded.voiceSettings);
      setVoicePresets(decoded.voicePresets);
      // Default to the flow's first playbook — the natural "start of the
      // conversation" — while still leaving the picker below free to jump
      // anywhere else.
      setActiveBoxId(decoded.boxes[0]?.id ?? null);
    }
    setKeys(loadPhoneKeys());
  }, []);

  const updateKeys = (patch: Partial<PhoneKeys>) => {
    setKeys((k) => {
      const next = { ...k, ...patch };
      window.localStorage.setItem(PHONE_KEYS_STORAGE, JSON.stringify(next));
      return next;
    });
  };

  const restart = (boxId: string | null) => {
    setActiveBoxId(boxId);
    setActiveStepIndex(0);
    setVariables({});
  };

  if (payload === undefined) return null; // avoid a flash of the "no flow" message before the hash is read

  if (!payload) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper p-6">
        <div className="max-w-sm border-2 border-ink bg-paper p-6 text-center">
          <p className="font-display text-lg text-ink">No flow loaded</p>
          <p className="mt-2 font-body text-sm text-muted-ink">
            Open this page using the link from the &ldquo;📱 Phone testing&rdquo; button on the computer — this
            page doesn&rsquo;t work visited directly.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col gap-3 bg-paper p-3">
      <h1 className="font-display text-lg text-ink">Gallery Guide Studio — Phone Test</h1>

      <details className="border-2 border-ink" open={!keys.anthropicApiKey}>
        <summary className="cursor-pointer px-3 py-2 font-label text-[11px] uppercase tracking-widest text-ink">
          API keys (stored only on this phone)
        </summary>
        <div className="flex flex-col gap-2 border-t-2 border-ink p-3">
          <label className={`flex flex-col gap-1 ${fieldLabel}`}>
            Anthropic API key
            <input
              type="password"
              autoComplete="off"
              value={keys.anthropicApiKey}
              onChange={(e) => updateKeys({ anthropicApiKey: e.target.value })}
              placeholder="sk-ant-…"
              className={fieldInput}
            />
          </label>
          <label className={`flex flex-col gap-1 ${fieldLabel}`}>
            ElevenLabs API key (optional — for voice replies)
            <input
              type="password"
              autoComplete="off"
              value={keys.elevenLabsApiKey}
              onChange={(e) => updateKeys({ elevenLabsApiKey: e.target.value })}
              placeholder="Optional"
              className={fieldInput}
            />
          </label>
          <p className="font-body text-xs italic text-muted-ink">
            Never sent anywhere except directly to Anthropic/ElevenLabs.
          </p>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-2 border-2 border-ink p-3">
        <span className={fieldLabel}>Start at</span>
        <select
          value={activeBoxId ?? ''}
          onChange={(e) => restart(e.target.value || null)}
          className={`flex-1 ${fieldInput}`}
        >
          {payload.boxes.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <button onClick={() => restart(activeBoxId)} className={buttonOutline} title="Clear this conversation and start over">
          Restart
        </button>
      </div>

      <div className="min-h-[70vh] flex-1 border-2 border-ink bg-paper p-3">
        <ChatPanel
          boxes={payload.boxes}
          activeBoxId={activeBoxId}
          activeStepIndex={activeStepIndex}
          variables={variables}
          masterPlaybook={payload.masterPlaybook}
          voiceId={payload.voiceId}
          voiceSettings={voiceSettings ?? payload.voiceSettings}
          voicePresets={voicePresets}
          anthropicApiKey={keys.anthropicApiKey}
          elevenLabsApiKey={keys.elevenLabsApiKey}
          onPositionChange={(boxId, stepIndex, variableUpdates) => {
            setActiveBoxId(boxId);
            setActiveStepIndex(stepIndex);
            setVariables((v) => ({ ...v, ...variableUpdates }));
          }}
          onVoiceSettingsChange={setVoiceSettings}
          onSaveVoicePreset={(index, settings) =>
            setVoicePresets((p) => p.map((preset, i) => (i === index ? settings : preset)))
          }
        />
      </div>

      {/* Room for whatever's floating over the bottom of the viewport on a
          phone browser (address bar, home indicator, extension overlays) —
          without this the mic/Send row can end up sitting right underneath
          it, unreachable. */}
      <div className="h-[100px] shrink-0" aria-hidden="true" />
    </main>
  );
}
