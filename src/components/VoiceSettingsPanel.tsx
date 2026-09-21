'use client';

import type { VoiceSettings } from '@/lib/types';

type SliderKey = 'stability' | 'similarityBoost' | 'style' | 'speed';

// Short labels — the mono uppercase type this panel uses to stay compact
// (see the design system's "Mono/Labels" role) leaves very little room per
// column, so full words like "Similarity" overrun and overlap the value.
const SLIDERS: Array<{ key: SliderKey; label: string; min: number; max: number; step: number }> = [
  { key: 'stability', label: 'Stab', min: 0, max: 1, step: 0.01 },
  { key: 'similarityBoost', label: 'Sim', min: 0, max: 1, step: 0.01 },
  { key: 'style', label: 'Style', min: 0, max: 1, step: 0.01 },
  // ElevenLabs' own Agents Platform restricts speed to this narrower band for
  // conversational voices — the REST API technically allows 0.25-4.0, but
  // that range is for one-off narration, not a talking agent.
  { key: 'speed', label: 'Speed', min: 0.7, max: 1.2, step: 0.01 },
];

type Props = {
  value: VoiceSettings;
  onChange: (value: VoiceSettings) => void;
};

export function VoiceSettingsPanel({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-2 border-ink bg-paper px-3 py-2">
      {SLIDERS.map(({ key, label, min, max, step }) => (
        <label key={key} className="flex flex-col gap-0.5 font-label text-[10px] uppercase tracking-normal text-muted-ink">
          <span className="flex items-center justify-between">
            <span>{label}</span>
            <span className="tabular-nums text-ink">{value[key].toFixed(2)}</span>
          </span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value[key]}
            onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })}
            className="h-1 w-full cursor-pointer accent-ink"
          />
        </label>
      ))}
      <label className="col-span-2 flex items-center gap-1.5 font-label text-[10px] uppercase tracking-widest text-muted-ink">
        <input
          type="checkbox"
          checked={value.useSpeakerBoost}
          onChange={(e) => onChange({ ...value, useSpeakerBoost: e.target.checked })}
          className="accent-ink"
        />
        Speaker boost
      </label>
    </div>
  );
}
