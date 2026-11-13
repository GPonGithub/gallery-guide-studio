'use client';

import { setMasterVolume, setSoundOff, useMasterVolume, useSoundOff } from '@/lib/agent/masterVolume';
import { fieldLabel } from '@/lib/styles';

/**
 * Beside the zone buttons in the top bar: the master volume (everything the app plays — voice, music,
 * timeline sounds; see masterVolume.ts) and Sound: On / Off. Turning it off stops every sound (the page
 * does that, `onStopAll`) and keeps the app silent; turning it on lets sound play again.
 */
export function SoundControls({ onStopAll }: { onStopAll: () => void }) {
  const volume = useMasterVolume();
  const off = useSoundOff();
  const percent = Math.round(volume * 100);
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Sound">
      <span className={fieldLabel}>Volume</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        onChange={(e) => setMasterVolume(Number(e.target.value) / 100)}
        aria-label="Master volume"
        aria-valuetext={`${percent}%`}
        title={`Master volume ${percent}% — the voice, the music and the timeline's sounds`}
        className="h-1 w-24 cursor-pointer accent-ink"
      />
      <span className="w-8 font-label text-[11px] tabular-nums text-ink">{percent}%</span>
      <button
        onClick={() => {
          if (!off) onStopAll();
          setSoundOff(!off);
        }}
        aria-pressed={!off}
        title={
          off
            ? 'Sound is off: everything is stopped and silent. Click to turn sound back on (what plays next is heard).'
            : 'Sound is on. Click to stop every sound now (the voice, the music and the timeline’s sounds) and keep the app silent.'
        }
        className={`h-9 min-w-[7.5rem] border-2 px-2 font-label text-[11px] uppercase tracking-wider transition-colors ${
          off
            ? 'border-[#b91c1c] bg-[#b91c1c] text-paper hover:bg-[#b91c1c]/85'
            : 'border-[#15803d] bg-paper text-[#15803d] hover:bg-[#15803d] hover:text-paper'
        }`}
      >
        {off ? '■ Sound: Off' : '▶ Sound: On'}
      </button>
    </div>
  );
}
