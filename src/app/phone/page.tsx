'use client';

import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { ChatPanel } from '@/components/ChatPanel';
import { decodePhonePayload, type PhonePayload } from '@/lib/phonePayload';
import type { SentPhoneFlow } from '@/lib/phoneFlowStore';
import { getStartBox, sortByCode } from '@/lib/startBox';
import { buttonOutline, buttonPrimary, fieldInput, fieldLabel } from '@/lib/styles';

// The talk-only side of the system: the computer builds the conversation
// (FigJam → web app), this page just runs it — the conversation and the
// hands-free mic, nothing for editing. Two ways a flow arrives:
//   1. A Phone testing link opened in Safari — the whole flow is in the URL
//      fragment (phonePayload.ts), a fixed snapshot.
//   2. No fragment (always the case in the iPhone app, which opens a fixed
//      URL) — fetched from /api/phone-flow, whatever the computer last sent
//      with "Send to iPhone app". Checked again periodically so a newer send
//      can be picked up without reinstalling or relaunching anything.
// API keys never travel with the flow either way: typed in here once,
// stored only on this device.
const PHONE_KEYS_STORAGE = 'gallery-guide-studio:phone-keys';
const PHONE_SETTINGS_STORAGE = 'gallery-guide-studio:phone-settings';
const NEWER_FLOW_POLL_MS = 10_000;

type PhoneKeys = { anthropicApiKey: string; elevenLabsApiKey: string };
const EMPTY_KEYS: PhoneKeys = { anthropicApiKey: '', elevenLabsApiKey: '' };

type PhoneSettings = { pauseSeconds: number };
const DEFAULT_SETTINGS: PhoneSettings = { pauseSeconds: 3 };

function loadStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

function saveStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / storage blocked — settings just won't persist.
  }
}

async function fetchSentFlow(): Promise<SentPhoneFlow | null> {
  try {
    const res = await fetch('/api/phone-flow', { cache: 'no-store' });
    const data = (await res.json()) as SentPhoneFlow | { flow: null };
    return data.flow ? (data as SentPhoneFlow) : null;
  } catch {
    return null;
  }
}

export default function PhonePage() {
  // undefined = still loading; null = nothing to run yet.
  const [loaded, setLoaded] = useState<{ flow: PhonePayload; sentAt: number | null } | null | undefined>(undefined);
  const [fromLink, setFromLink] = useState(false);
  const [newerSentAt, setNewerSentAt] = useState<number | null>(null);
  const [keys, setKeys] = useState<PhoneKeys>(EMPTY_KEYS);
  const [settings, setSettings] = useState<PhoneSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isNative, setIsNative] = useState(false);
  const [startBoxId, setStartBoxId] = useState<string | null>(null);
  const [activeBoxId, setActiveBoxId] = useState<string | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [variables, setVariables] = useState<Record<string, string>>({});

  const startFlow = useCallback((flow: PhonePayload, sentAt: number | null) => {
    const first = getStartBox(flow.boxes)?.id ?? null;
    setLoaded({ flow, sentAt });
    setNewerSentAt(null);
    setStartBoxId(first);
    setActiveBoxId(first);
    setActiveStepIndex(0);
    setVariables({});
  }, []);

  useEffect(() => {
    const storedKeys = loadStored(PHONE_KEYS_STORAGE, EMPTY_KEYS);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only: this device's localStorage, the URL fragment and the native bridge don't exist during SSR
    setKeys(storedKeys);
    setSettings(loadStored(PHONE_SETTINGS_STORAGE, DEFAULT_SETTINGS));
    setIsNative(Capacitor.isNativePlatform());
    if (!storedKeys.anthropicApiKey) setSettingsOpen(true);

    const hash = window.location.hash.slice(1);
    const decoded = hash ? decodePhonePayload(hash) : null;
    if (decoded) {
      setFromLink(true);
      startFlow(decoded, null);
      return;
    }
    fetchSentFlow().then((sent) => (sent ? startFlow(sent.flow, sent.sentAt) : setLoaded(null)));
  }, [startFlow]);

  // Watch for the computer sending something newer. Never swaps the flow
  // out mid-conversation on its own — just offers it.
  useEffect(() => {
    if (fromLink || loaded === undefined) return;
    const check = async () => {
      const sent = await fetchSentFlow();
      if (!sent) return;
      if (loaded === null) startFlow(sent.flow, sent.sentAt);
      else if (sent.sentAt !== loaded.sentAt) setNewerSentAt(sent.sentAt);
    };
    const interval = setInterval(check, NEWER_FLOW_POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fromLink, loaded, startFlow]);

  const loadNewer = async () => {
    const sent = await fetchSentFlow();
    if (sent) startFlow(sent.flow, sent.sentAt);
  };

  const updateKeys = (patch: Partial<PhoneKeys>) => {
    setKeys((k) => {
      const next = { ...k, ...patch };
      saveStored(PHONE_KEYS_STORAGE, next);
      return next;
    });
  };

  const updateSettings = (patch: Partial<PhoneSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveStored(PHONE_SETTINGS_STORAGE, next);
      return next;
    });
  };

  const restartAt = (boxId: string | null) => {
    setStartBoxId(boxId);
    setActiveBoxId(boxId);
    setActiveStepIndex(0);
    setVariables({});
  };

  if (loaded === undefined) return null; // avoid flashing "nothing sent yet" before the first check finishes

  const settingsPanel = settingsOpen && (
    <div className="flex flex-col gap-3 border-2 border-ink p-3">
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
        ElevenLabs API key (for the bot&rsquo;s voice)
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
        Stored only on this phone, sent only to Anthropic/ElevenLabs.
      </p>

      <label className={`flex items-center gap-2 ${fieldLabel}`}>
        Pause before sending
        <input
          type="range"
          min={0}
          max={3}
          step={0.2}
          value={settings.pauseSeconds}
          onChange={(e) => updateSettings({ pauseSeconds: Number(e.target.value) })}
          className="flex-1 accent-ink"
        />
        <span className="tabular-nums normal-case text-muted-ink">{settings.pauseSeconds.toFixed(1)}s</span>
      </label>

      {loaded && (
        <label className={`flex items-center gap-2 ${fieldLabel}`}>
          Start at
          <select
            value={startBoxId ?? ''}
            onChange={(e) => restartAt(e.target.value || null)}
            className={`flex-1 ${fieldInput}`}
          >
            {sortByCode(loaded.flow.boxes).map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {!fromLink && (
        <button onClick={loadNewer} className={buttonOutline}>
          Reload conversation from computer
        </button>
      )}
      <button onClick={() => setSettingsOpen(false)} className={buttonPrimary}>
        Done
      </button>
    </div>
  );

  return (
    <main className="flex h-[100dvh] flex-col gap-3 bg-paper p-3">
      <div className="flex items-center justify-between border-b-2 border-ink pb-2">
        <h1 className="font-display text-lg text-ink">Gallery Guide</h1>
        <button
          onClick={() => setSettingsOpen((o) => !o)}
          className="font-label text-[11px] uppercase tracking-widest text-muted-ink"
        >
          {settingsOpen ? 'Close settings' : 'Settings'}
        </button>
      </div>

      {settingsPanel}

      {newerSentAt && (
        <button onClick={loadNewer} className={`w-full ${buttonPrimary}`}>
          Your computer sent an updated conversation — load it
        </button>
      )}

      {loaded ? (
        <div className="min-h-0 flex-1">
          <ChatPanel
            // Remount (fresh conversation) whenever the flow or start point changes.
            key={`${loaded.sentAt}-${startBoxId}`}
            variant="phone"
            boxes={loaded.flow.boxes}
            activeBoxId={activeBoxId}
            activeStepIndex={activeStepIndex}
            variables={variables}
            masterPlaybook={loaded.flow.masterPlaybook}
            voiceId={loaded.flow.voiceId}
            voiceSettings={loaded.flow.voiceSettings}
            voicePresets={loaded.flow.voicePresets}
            anthropicApiKey={keys.anthropicApiKey}
            elevenLabsApiKey={keys.elevenLabsApiKey}
            pauseSecondsOverride={settings.pauseSeconds}
            smartJumps={loaded.flow.smartJumps ?? true}
            onPositionChange={(boxId, stepIndex, variableUpdates) => {
              setActiveBoxId(boxId);
              setActiveStepIndex(stepIndex);
              setVariables((v) => ({ ...v, ...variableUpdates }));
            }}
            onReset={() => restartAt(startBoxId)}
            // Voice tuning happens on the computer; the phone just uses what was sent.
            onVoiceSettingsChange={() => {}}
            onSaveVoicePreset={() => {}}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-sm border-2 border-ink p-6 text-center">
            <p className="font-display text-lg text-ink">Nothing to talk through yet</p>
            <p className="mt-2 font-body text-sm text-muted-ink">
              On your computer, open &ldquo;📱 Phone testing&rdquo; and press &ldquo;Send to iPhone app&rdquo;. It
              will appear here automatically.
            </p>
          </div>
        </div>
      )}

      {/* Safari's own toolbar floats over the bottom of the page; the app
          has no browser chrome, so it doesn't need the extra room. */}
      {!isNative && <div className="h-[100px] shrink-0" aria-hidden="true" />}
    </main>
  );
}
