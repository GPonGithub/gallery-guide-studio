'use client';

import { useRef, useState } from 'react';
import type { VoiceSettings } from '@/lib/types';

type Props = {
  presets: (VoiceSettings | null)[];
  currentSettings: VoiceSettings;
  onApply: (settings: VoiceSettings) => void;
  onSave: (index: number, settings: VoiceSettings) => void;
};

const LONG_PRESS_MS = 550;
const SAVED_FLASH_MS = 900;

function settingsEqual(a: VoiceSettings, b: VoiceSettings): boolean {
  return (
    a.stability === b.stability &&
    a.similarityBoost === b.similarityBoost &&
    a.style === b.style &&
    a.speed === b.speed &&
    a.useSpeakerBoost === b.useSpeakerBoost
  );
}

/**
 * Four save slots. A slot's own state decides what a click does:
 * empty → save the current sliders into it; already holding a preset →
 * load it back onto the sliders. Holding a filled slot down for a beat
 * overwrites it with the current sliders instead, so re-saving doesn't
 * require clearing it first.
 */
export function VoicePresetButtons({ presets, currentSettings, onApply, onSave }: Props) {
  const timers = useRef<Record<number, ReturnType<typeof setTimeout> | undefined>>({});
  const longPressed = useRef<Record<number, boolean>>({});
  const [justSaved, setJustSaved] = useState<number | null>(null);

  const flashSaved = (index: number) => {
    setJustSaved(index);
    setTimeout(() => setJustSaved((current) => (current === index ? null : current)), SAVED_FLASH_MS);
  };

  const startPress = (index: number) => {
    longPressed.current[index] = false;
    timers.current[index] = setTimeout(() => {
      longPressed.current[index] = true;
      onSave(index, currentSettings);
      flashSaved(index);
    }, LONG_PRESS_MS);
  };

  const endPress = (index: number) => {
    clearTimeout(timers.current[index]);
    timers.current[index] = undefined;
  };

  const handleClick = (index: number) => {
    if (longPressed.current[index]) {
      // The hold already saved it — this trailing click is just the release.
      longPressed.current[index] = false;
      return;
    }
    const preset = presets[index];
    if (preset) {
      onApply(preset);
    } else {
      onSave(index, currentSettings);
      flashSaved(index);
    }
  };

  return (
    <div className="grid grid-cols-2 content-center gap-1 self-center">
      {presets.map((preset, i) => {
        const isActive = preset !== null && settingsEqual(preset, currentSettings);
        return (
          <button
            key={i}
            onPointerDown={() => startPress(i)}
            onPointerUp={() => endPress(i)}
            onPointerLeave={() => endPress(i)}
            onClick={() => handleClick(i)}
            title={preset ? 'Click to load this preset · hold to overwrite with the current settings' : 'Click to save the current settings here'}
            className={`flex h-[26px] w-[26px] items-center justify-center border-2 font-label text-[10px] font-medium transition-colors duration-100 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-ink focus-visible:outline-offset-2 ${
              justSaved === i
                ? 'border-ink bg-paper text-ink'
                : isActive
                  ? 'border-blue-600 bg-blue-600 text-paper hover:bg-blue-700'
                  : preset
                    ? 'border-ink bg-ink text-paper hover:bg-paper hover:text-ink'
                    : 'border-dashed border-hair text-muted-ink hover:border-ink hover:text-ink'
            }`}
          >
            {justSaved === i ? '✓' : i + 1}
          </button>
        );
      })}
    </div>
  );
}
