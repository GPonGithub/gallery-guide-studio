'use client';

import { useEffect, useRef, useState } from 'react';
import { DEFAULT_VOICE_SETTINGS } from '@/lib/storage';
import type { VoiceSettings } from '@/lib/types';
import { buttonOutline, fieldInput, fieldLabel } from '@/lib/styles';

// The ElevenLabs voice controls, in a panel that pops open from the chat
// toolbar: up to ten saved voices (each testable with the normal and the
// expressive model), which one the agent uses, and the settings sliders.
// Each voice can keep its own settings ("Save settings"); choosing a voice
// moves the sliders to what was saved for it. Changes apply to the very
// next thing the agent says.

export const MAX_VOICES = 10;
/** ElevenLabs' public "Rachel" voice — what an empty voice ID falls back to. */
const DEFAULT_VOICE_NAME = 'Rachel (ElevenLabs default)';

/**
 * `settings`: the slider positions saved for this voice, if any.
 * `expressive`: saved with them — the voice speaks with ElevenLabs'
 * expressive model, performing [laughs], [whispers]… (missing = regular).
 */
export type SavedVoice = { name: string; voiceId: string; settings?: VoiceSettings; expressive?: boolean };

/** A voice in the user's ElevenLabs account (see /api/tts/voices). */
export type AccountVoice = { voiceId: string; name: string; description: string };
export type AccountVoices = { voices: AccountVoice[] } | { error: string };

type SliderKey = 'stability' | 'similarityBoost' | 'style' | 'speed';

const SLIDERS: { key: SliderKey; label: string; hint: string; min: number; max: number; step: number }[] = [
  { key: 'stability', label: 'Stability', hint: 'Low = more expressive and varied; high = steadier, more even.', min: 0, max: 1, step: 0.01 },
  { key: 'similarityBoost', label: 'Similarity', hint: 'How closely it sticks to the original voice.', min: 0, max: 1, step: 0.01 },
  { key: 'style', label: 'Style', hint: 'Exaggerates the voice’s style (normal voice only).', min: 0, max: 1, step: 0.01 },
  // ElevenLabs restricts speed to this band for conversational voices.
  { key: 'speed', label: 'Speed', hint: 'How fast it talks. 1.00 is normal.', min: 0.7, max: 1.2, step: 0.01 },
];

export type VoiceCheck =
  | {
      repeatable: boolean;
      controlSeconds: number;
      results: { setting: string; from: number; to: number; changedAudio: boolean; seconds: number }[];
    }
  | { error: string };

const smallButton =
  'border-2 border-ink bg-paper px-2 py-1 font-label text-[10px] uppercase tracking-wide text-ink transition-colors duration-100 ' +
  'hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:border-hair disabled:text-muted-ink disabled:hover:bg-paper';
// The Test button for the way a voice is set to speak (regular or expressive).
const smallButtonChosen =
  'border-2 border-ink bg-ink px-2 py-1 font-label text-[10px] uppercase tracking-wide text-paper transition-colors duration-100 ' +
  'hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-60';

export function VoicePanel({
  settings,
  voices,
  activeVoice,
  expressive,
  onExpressiveChange,
  onSettingsChange,
  onVoicesChange,
  onTest,
  onTestExpressive,
  onCheck,
  loadAccountVoices,
}: {
  settings: VoiceSettings;
  voices: SavedVoice[];
  /** Index into `voices` of the voice the agent speaks with. */
  activeVoice: number;
  /** Whether the voice in use speaks expressively right now (like `settings`, live until saved). */
  expressive: boolean;
  onExpressiveChange: (expressive: boolean) => void;
  onSettingsChange: (settings: VoiceSettings) => void;
  onVoicesChange: (voices: SavedVoice[], activeVoice: number) => void;
  /** Speaks a sample line in this voice with the normal model; resolves when it starts (or fails). */
  onTest: (voiceId: string, settings: VoiceSettings) => Promise<void>;
  /** Same, through the expressive model, with performance cues in the sample. */
  onTestExpressive: (voiceId: string, settings: VoiceSettings) => Promise<void>;
  /** Renders a sample once per setting (fixed seed) to see which ones change the audio. */
  onCheck: () => Promise<VoiceCheck>;
  /** The voices in the user's ElevenLabs account, to pick from by name. */
  loadAccountVoices: () => Promise<AccountVoices>;
}) {
  const [open, setOpen] = useState(false);
  // "<index>-normal" / "<index>-expressive" while that sample is loading.
  const [testing, setTesting] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<VoiceCheck | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [account, setAccount] = useState<AccountVoices | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);
  // Index of the voice whose settings were just saved (for a moment's "Saved ✓").
  const [justSaved, setJustSaved] = useState<number | null>(null);
  // Which voices are unfolded to show their details (all folded by default).
  const [unfolded, setUnfolded] = useState<Set<number>>(new Set());
  const toggleFold = (index: number) =>
    setUnfolded((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const refreshAccount = async () => {
    setLoadingAccount(true);
    setAccount(await loadAccountVoices());
    setLoadingAccount(false);
  };

  // Load the account's voices the first time the panel opens.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching the ElevenLabs voice list once, when the panel is first opened
    if (open && account === null && !loadingAccount) void refreshAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshAccount is recreated every render; only `open` should trigger this
  }, [open]);
  const accountVoices = account && 'voices' in account ? account.voices : [];
  const nameFor = (voiceId: string) => accountVoices.find((v) => v.voiceId === voiceId);

  // Close on a click outside the panel, or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const updateVoice = (index: number, patch: Partial<SavedVoice>) =>
    onVoicesChange(
      voices.map((v, i) => (i === index ? { ...v, ...patch } : v)),
      activeVoice,
    );

  const removeVoice = (index: number) => {
    const next = voices.filter((_, i) => i !== index);
    // Keep the same voice selected if it survives; otherwise fall back to the first.
    const nextActive = index === activeVoice ? 0 : index < activeVoice ? activeVoice - 1 : activeVoice;
    onVoicesChange(next, Math.min(nextActive, Math.max(0, next.length - 1)));
    setModeChoice({});
    // Voices after the removed one move up a place; keep them unfolded as they were.
    setUnfolded((current) => new Set([...current].filter((n) => n !== index).map((n) => (n > index ? n - 1 : n))));
  };

  // Regular or expressive, as last tested, for voices other than the one in
  // use (the one in use changes straight away, through onExpressiveChange).
  const [modeChoice, setModeChoice] = useState<Record<number, boolean>>({});
  const modeFor = (index: number) =>
    index === activeVoice ? expressive : (modeChoice[index] ?? Boolean(voices[index]?.expressive));
  const chooseMode = (index: number, mode: boolean) => {
    if (index === activeVoice) onExpressiveChange(mode);
    else setModeChoice((current) => ({ ...current, [index]: mode }));
  };

  // Keeps the sliders, and regular/expressive, as they are now for this voice.
  const saveSettings = (index: number) => {
    updateVoice(index, { settings: { ...settings }, expressive: modeFor(index) });
    setJustSaved(index);
    setTimeout(() => setJustSaved((current) => (current === index ? null : current)), 1500);
  };

  // A voice is tested with the sliders if it's the one in use (so you can
  // hear a change before saving it); otherwise with its own saved settings.
  const settingsFor = (index: number) => (index === activeVoice ? settings : (voices[index]?.settings ?? settings));

  const runTest = async (key: string, play: () => Promise<void>) => {
    setTesting(key);
    await play();
    setTesting(null);
  };

  const active = voices[activeVoice];

  return (
    <div ref={wrapperRef} className="relative">
      <button onClick={() => setOpen((o) => !o)} className={buttonOutline} aria-expanded={open} title="Voices and voice settings">
        Voice: {active?.name.trim() || `Voice ${activeVoice + 1}`}
        {expressive ? ' ✦' : ''} {open ? '▴' : '▾'}
      </button>
      {/* Narrow screens: a full-width panel pinned under the header, so it can't open
          off the edge. Wider screens: dropped down from the button. */}
      {open && (
        <div
          className="fixed inset-x-4 top-24 z-40 flex max-h-[78vh] flex-col gap-4 overflow-y-auto border-2 border-ink bg-paper p-4 shadow-[6px_6px_0_0_rgba(0,0,0,0.15)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[380px]">
          <section className="flex flex-col gap-2">
            <p className={fieldLabel}>
              Voices ({voices.length} of {MAX_VOICES}) · the agent uses the selected one
            </p>
            {voices.map((voice, i) => {
              const selected = i === activeVoice;
              const unsaved =
                selected &&
                voice.settings !== undefined &&
                (!sameSettings(voice.settings, settings) || Boolean(voice.expressive) !== expressive);
              const mode = modeFor(i);
              const open = unfolded.has(i);
              const label = voice.name.trim() || `Voice ${i + 1}`;
              return (
                <div key={i} className={`flex flex-col gap-1.5 border-2 p-2 ${selected ? 'border-ink' : 'border-hair'}`}>
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="active-voice"
                      checked={selected}
                      onChange={() => onVoicesChange(voices, i)}
                      className="accent-ink"
                      aria-label={`Use ${label}`}
                    />
                    {/* The voice's name line: click it to unfold the details. */}
                    <button
                      onClick={() => toggleFold(i)}
                      aria-expanded={open}
                      title={open ? 'Fold away this voice’s details' : 'Show this voice’s details'}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-body text-sm text-ink hover:underline"
                    >
                      <span className="w-3 shrink-0 text-[10px] text-muted-ink">{open ? '▾' : '▸'}</span>
                      <span className="truncate">{label}</span>
                      {mode && (
                        <span className="shrink-0 text-[11px] text-ink" title="Speaks expressively">
                          ✦
                        </span>
                      )}
                      {unsaved && (
                        <span
                          className="shrink-0 font-label text-[9px] uppercase tracking-widest text-[#b45309]"
                          title="Sliders changed since this voice's settings were saved"
                        >
                          • not saved
                        </span>
                      )}
                    </button>
                    {selected && <span className="font-label text-[10px] uppercase tracking-widest text-ink">In use</span>}
                    <button
                      onClick={() => removeVoice(i)}
                      disabled={voices.length === 1}
                      className="px-1 text-base leading-none text-muted-ink hover:text-[#b91c1c] disabled:opacity-30"
                      aria-label="Remove this voice"
                      title={voices.length === 1 ? 'Keep at least one voice' : 'Remove this voice'}
                    >
                      ×
                    </button>
                  </div>
                  {open && (
                    <div className="flex flex-col gap-1.5">
                      <input
                        value={voice.name}
                        onChange={(e) => updateVoice(i, { name: e.target.value })}
                        placeholder={`Voice ${i + 1} name`}
                        aria-label="Voice name"
                        className={`w-full text-[13px] ${fieldInput}`}
                      />
                      {accountVoices.length > 0 && (
                        <select
                          value={nameFor(voice.voiceId) ? voice.voiceId : ''}
                          onChange={(e) => {
                            const picked = accountVoices.find((v) => v.voiceId === e.target.value);
                            if (!picked) return;
                            // Name the slot after the voice unless it already has a name of your own.
                            const unnamed = !voice.name.trim() || /^Voice \d+$/.test(voice.name.trim());
                            updateVoice(i, { voiceId: picked.voiceId, ...(unnamed ? { name: picked.name } : {}) });
                          }}
                          className="w-full border-2 border-ink bg-paper px-2 py-1 font-body text-[13px] text-ink"
                        >
                          <option value="">Pick from my ElevenLabs voices…</option>
                          {accountVoices.map((v) => (
                            <option key={v.voiceId} value={v.voiceId}>
                              {v.name}
                              {v.description ? ` — ${v.description}` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                      <input
                        value={voice.voiceId}
                        onChange={(e) => updateVoice(i, { voiceId: e.target.value.trim() })}
                        placeholder={`Voice ID — empty = ${DEFAULT_VOICE_NAME}`}
                        className={`w-full font-label text-[11px] ${fieldInput}`}
                      />
                      {voice.voiceId && accountVoices.length > 0 && (
                        <span className="font-body text-[11px] text-muted-ink">
                          {nameFor(voice.voiceId)
                            ? `= ${nameFor(voice.voiceId)!.name} in your ElevenLabs account`
                            : 'Not one of your ElevenLabs voices (a Voice Library voice may need adding to My Voices)'}
                        </span>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => {
                            chooseMode(i, false);
                            void runTest(`${i}-normal`, () => onTest(voice.voiceId, settingsFor(i)));
                          }}
                          disabled={testing !== null}
                          className={mode ? smallButton : smallButtonChosen}
                          aria-pressed={!mode}
                          title="Hear the regular voice — and set this voice to speak that way"
                        >
                          {testing === `${i}-normal` ? 'Playing…' : '🔊 Test'}
                        </button>
                        <button
                          onClick={() => {
                            chooseMode(i, true);
                            void runTest(`${i}-expressive`, () => onTestExpressive(voice.voiceId, settingsFor(i)));
                          }}
                          disabled={testing !== null}
                          className={mode ? smallButtonChosen : smallButton}
                          aria-pressed={mode}
                          title="Hear the expressive voice — it performs [laughs], [whispers]… — and set this voice to speak that way"
                        >
                          {testing === `${i}-expressive` ? 'Playing…' : '✦ Test expressive'}
                        </button>
                        <button
                          onClick={() => saveSettings(i)}
                          className={smallButton}
                          title={
                            selected
                              ? 'Keep the sliders, and regular or expressive, as they are now for this voice'
                              : 'Save the sliders as they are now (they show the voice in use), and regular or expressive, to this voice'
                          }
                        >
                          {justSaved === i ? 'Saved ✓' : 'Save settings'}
                        </button>
                        {!selected && (
                          <button onClick={() => onVoicesChange(voices, i)} className={`ml-auto ${smallButton}`}>
                            Use this voice
                          </button>
                        )}
                      </div>
                      <span className="font-body text-[11px] text-muted-ink">
                        Speaks {mode ? 'expressively — performs [laughs], [whispers]…' : 'with the regular voice'}. Test either
                        one to choose.
                      </span>
                      <span className={`font-body text-[11px] ${unsaved ? 'text-[#b45309]' : 'text-muted-ink'}`}>
                        {voice.settings
                          ? `Saved: ${voice.expressive ? 'expressive' : 'regular'} · ${describeSettings(voice.settings)}${unsaved ? ' · changed since — not saved' : ''}`
                          : selected
                            ? 'No saved settings yet — uses the sliders below.'
                            : 'No saved settings yet — uses the sliders when chosen.'}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            <p className="font-body text-[11px] leading-snug text-muted-ink">
              {loadingAccount
                ? 'Loading your ElevenLabs voices…'
                : account && 'error' in account
                  ? account.error
                  : `${accountVoices.length} voices in your ElevenLabs account. `}
              {!loadingAccount && (
                <button onClick={refreshAccount} className="underline underline-offset-2 hover:text-ink">
                  Reload list
                </button>
              )}
            </p>
            <button
              onClick={() => {
                // A new voice opens unfolded, ready to fill in.
                setUnfolded((current) => new Set(current).add(voices.length));
                onVoicesChange([...voices, { name: '', voiceId: '' }], activeVoice);
              }}
              disabled={voices.length >= MAX_VOICES}
              className="self-start font-label text-[11px] uppercase tracking-widest text-ink hover:underline disabled:text-muted-ink disabled:no-underline"
            >
              {voices.length >= MAX_VOICES ? `Up to ${MAX_VOICES} voices` : '+ Add a voice'}
            </button>
          </section>

          <section className="flex flex-col gap-3 border-t-2 border-ink pt-3">
            <div className="flex items-center justify-between">
              <p className={fieldLabel}>Settings · {active?.name.trim() || `Voice ${activeVoice + 1}`}</p>
              <button
                onClick={() => onSettingsChange({ ...DEFAULT_VOICE_SETTINGS })}
                className="font-label text-[10px] uppercase tracking-widest text-muted-ink hover:text-ink hover:underline"
                title="Back to ElevenLabs' own defaults"
              >
                Reset
              </button>
            </div>
            {SLIDERS.map(({ key, label, hint, min, max, step }) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="flex items-baseline justify-between font-label text-[11px] uppercase tracking-widest text-ink">
                  {label}
                  <span className="tabular-nums">{settings[key].toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={settings[key]}
                  onChange={(e) => onSettingsChange({ ...settings, [key]: Number(e.target.value) })}
                  className="w-full cursor-pointer accent-ink"
                />
                <span className="font-body text-xs leading-snug text-muted-ink">{hint}</span>
              </label>
            ))}
            <label className="flex items-center gap-1.5 font-label text-[11px] uppercase tracking-widest text-ink">
              <input
                type="checkbox"
                checked={settings.useSpeakerBoost}
                onChange={(e) => onSettingsChange({ ...settings, useSpeakerBoost: e.target.checked })}
                className="accent-ink"
              />
              Speaker boost
              <span className="normal-case tracking-normal text-muted-ink"> — normal voice only</span>
            </label>
          </section>

          <section className="flex flex-col gap-1.5 border-t-2 border-hair pt-3">
            <button
              onClick={async () => {
                setChecking(true);
                setCheck(null);
                setCheck(await onCheck());
                setChecking(false);
              }}
              disabled={checking}
              className={`self-start ${buttonOutline}`}
              title="Makes the same sentence 6 times in the voice in use, with a fixed seed: your settings, an identical repeat, then each slider pushed to an extreme"
            >
              {checking ? 'Checking… (≈10s)' : 'Check the sliders work'}
            </button>
            {check && 'error' in check && <p className="font-body text-xs text-[#b91c1c]">{check.error}</p>}
            {check && !('error' in check) && (
              <div className="font-body text-xs leading-snug text-ink">
                {!check.repeatable && (
                  <p className="mb-1 text-muted-ink">
                    Note: two identical requests didn’t give identical audio, so “changed” below is less certain.
                  </p>
                )}
                <ul className="flex flex-col gap-0.5">
                  {check.results.map((r) => (
                    <li key={r.setting}>
                      <span className={r.changedAudio ? 'text-[#15803d]' : 'text-[#b91c1c]'}>{r.changedAudio ? '✓' : '✗'}</span>{' '}
                      <b>{r.setting}</b> {r.from.toFixed(2)} → {r.to.toFixed(2)}:{' '}
                      {r.changedAudio ? 'changes the audio' : 'no effect on the audio'}
                      {r.setting === 'Speed' && ` (${check.controlSeconds}s → ${r.seconds}s)`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function sameSettings(a: VoiceSettings, b: VoiceSettings): boolean {
  return (
    a.stability === b.stability &&
    a.similarityBoost === b.similarityBoost &&
    a.style === b.style &&
    a.speed === b.speed &&
    a.useSpeakerBoost === b.useSpeakerBoost
  );
}

function describeSettings(s: VoiceSettings): string {
  return `stability ${s.stability.toFixed(2)} · similarity ${s.similarityBoost.toFixed(2)} · style ${s.style.toFixed(2)} · speed ${s.speed.toFixed(2)}`;
}
