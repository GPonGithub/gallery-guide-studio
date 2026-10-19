'use client';

import { useEffect, useRef, useState } from 'react';
import { buttonOutlineCompact, fieldLabel, toolbarButtonWidth } from '@/lib/styles';
import { dipToShare } from './backgroundMusic';
import { DropdownArrow } from './DropdownArrow';

// The music and sound controls, in a panel that pops open from the chat
// toolbar like the Voice panel: drop in an MP3 for the scene's background
// music, and set the volume and how far it dips while the agent is talking —
// for that music and for every sound the timeline plays (media actions). The
// music starts when the agent is asked to open the call ("Agent speaks first"
// or the expressive version).

export const MAX_MUSIC_MB = 50;

const smallButton =
  'border-2 border-ink bg-paper px-2 py-1 font-label text-[10px] uppercase tracking-wide text-ink transition-colors duration-100 ' +
  'hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:border-hair disabled:text-muted-ink disabled:hover:bg-paper';

export function MusicPanel({
  trackName,
  playing,
  soundsPlaying = false,
  volume,
  dip,
  onFile,
  onRemove,
  onPreview,
  onTryDip,
  onVolumeChange,
  onDipChange,
}: {
  /** The music file's name, or null if there isn't one. */
  trackName: string | null;
  playing: boolean;
  /** A timeline sound is playing (so the dip can be tried on it). */
  soundsPlaying?: boolean;
  /** 0–10. */
  volume: number;
  /** 0–10: how far the music dips while the agent talks (10 = silent). */
  dip: number;
  /** A file was dropped or chosen; resolves with an error message, or null if it was kept. */
  onFile: (file: File) => Promise<string | null>;
  onRemove: () => void;
  /** Plays (or stops) the music on its own, to try the levels. */
  onPreview: () => void;
  /** Dips the playing music for a few seconds, as if the agent were talking. */
  onTryDip: () => void;
  onVolumeChange: (volume: number) => void;
  onDipChange: (dip: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const pickerRef = useRef<HTMLInputElement | null>(null);

  // Close on a click outside the panel, or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      // Clicks in the onboarding tour's card don't count as outside (it may be explaining this panel).
      if ((e.target as Element).closest?.('[data-tour-ui]')) return;
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

  const take = async (file: File | undefined) => {
    if (!file) return;
    const isAudio = file.type.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|aac)$/i.test(file.name);
    if (!isAudio) return setProblem(`“${file.name}” isn’t an audio file — drop an MP3.`);
    if (file.size > MAX_MUSIC_MB * 1024 * 1024) return setProblem(`That file is over ${MAX_MUSIC_MB} MB — use a shorter or smaller MP3.`);
    setProblem(await onFile(file));
  };

  return (
    <div ref={wrapperRef} className="relative flex">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-10 items-center gap-1.5 ${toolbarButtonWidth} ${buttonOutlineCompact}`}
        aria-expanded={open}
        data-tour="music-button"
        title="Background music, and the volume of every sound the scene plays"
      >
        ♫ Music / Sounds{playing || soundsPlaying ? ' ▶' : ''}
        <DropdownArrow open={open} />
      </button>
      {open && (
        <div className="fixed inset-x-4 top-24 z-40 flex max-h-[78vh] flex-col gap-4 overflow-y-auto border-2 border-ink bg-paper p-4 shadow-[6px_6px_0_0_rgba(0,0,0,0.15)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[340px]">
          <section className="flex flex-col gap-2">
            <p className={fieldLabel}>Background music</p>
            <button
              data-tour="music-drop"
              onClick={() => pickerRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void take(e.dataTransfer.files[0]);
              }}
              className={`flex flex-col items-center gap-1 border-2 border-dashed px-3 py-5 text-center font-body text-sm transition-colors ${
                dragging ? 'border-ink bg-[#fff6cc] text-ink' : 'border-hair text-muted-ink hover:border-ink hover:text-ink'
              }`}
            >
              <span className="text-xl leading-none">♫</span>
              {trackName ? 'Drop another MP3 here to replace it' : 'Drop an MP3 here'}
              <span className="text-[11px]">or click to choose one</span>
            </button>
            <input
              ref={pickerRef}
              type="file"
              accept="audio/mpeg,.mp3,audio/*"
              className="hidden"
              onChange={(e) => {
                void take(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {problem && <p className="font-body text-xs text-[#b91c1c]">{problem}</p>}
            {trackName && (
              <div className="flex items-center gap-2 border-2 border-ink p-2">
                <span className="min-w-0 flex-1 truncate font-body text-sm text-ink" title={trackName}>
                  {trackName}
                </span>
                <button onClick={onPreview} className={smallButton}>
                  {playing ? '■ Stop' : '▶ Play'}
                </button>
                <button
                  onClick={onRemove}
                  className="px-1 text-base leading-none text-muted-ink hover:text-[#b91c1c]"
                  aria-label="Remove the music"
                  title="Remove the music"
                >
                  ×
                </button>
              </div>
            )}
            <p className="font-body text-[11px] leading-snug text-muted-ink">
              Starts when you click “Agent speaks first” (or the expressive one), loops, and fades out when the call ends or
              you press Restart. Kept in this browser only.
            </p>
          </section>

          <section className="flex flex-col gap-3 border-t-2 border-ink pt-3">
            <p className="font-body text-[11px] leading-snug text-muted-ink">
              These set the music above and every sound the timeline plays (the scene’s media actions).
            </p>
            <Slider
              label="Volume"
              value={volume}
              readout={volume.toFixed(1)}
              onChange={onVolumeChange}
              hint="0 is silent, 10 is the file at full volume."
            />
            <Slider
              label="Dip while the agent talks"
              value={dip}
              readout={`${dip.toFixed(1)} · at ${Math.round(dipToShare(dip) * 100)}%`}
              onChange={onDipChange}
              hint="How far the music and sounds drop under the agent’s voice. 0 = no dip, 5 = half volume, 10 = silent. It eases down as the agent starts and back up after. Around 3–5 keeps it audible under the voice."
            />
            <button
              onClick={onTryDip}
              disabled={!playing && !soundsPlaying}
              className={`self-start ${smallButton}`}
              title={
                playing || soundsPlaying
                  ? 'Dips the music and sounds for 3 seconds, as if the agent were talking'
                  : 'Play the music (or a sound) first'
              }
            >
              Try the dip
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

function Slider({
  label,
  value,
  readout,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  readout: string;
  onChange: (value: number) => void;
  hint: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between font-label text-[11px] uppercase tracking-widest text-ink">
        {label}
        <span className="tabular-nums normal-case tracking-normal">{readout}</span>
      </span>
      <input
        type="range"
        min={0}
        max={10}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer accent-ink"
      />
      <span className="font-body text-xs leading-snug text-muted-ink">{hint}</span>
    </label>
  );
}
