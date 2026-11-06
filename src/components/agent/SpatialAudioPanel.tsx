'use client';

import { useEffect, useRef, useState } from 'react';
import type { MediaAsset } from '@/lib/agent/media';
import { kindOf } from '@/lib/agent/media';
import { barsOf, updateMediaLinks, useMediaLinks, type MediaLink } from '@/lib/agent/mediaFolder';
import {
  clampSoundVolume,
  playSound,
  setSoundPan,
  stopSounds,
  useRoomOutput,
  chooseRoomSpeakers,
  useSoundPlaying,
} from '@/lib/agent/mediaPlayback';
import {
  CENTRE,
  clampPan,
  isCentre,
  pickSpatialSound,
  sameSpatialPick,
  SPEAKERS,
  speakerGains,
  useSpatialPick,
  type Pan,
} from '@/lib/agent/spatialAudio';
import { buttonOutlineCompact } from '@/lib/styles';

const isSound = (l: MediaLink) => (l.assetKind ?? kindOf(l.assetName ?? '')) === 'sound';
const nameOf = (l: MediaLink) => l.assetName ?? l.assetId;

/**
 * 6 · Spatialized audio: the room seen from above, a speaker in each corner, and a dot for where the
 * chosen sound is heard. Drag the dot: at a speaker only that speaker plays it; in the middle all four
 * play it evenly. Clicking a sound's bar on the timeline chooses it here (and opens this step).
 */
export function SpatialAudioPanel({
  scene,
  assets,
}: {
  scene: { sheetId: string; number: string } | null;
  assets: MediaAsset[];
}) {
  const links = useMediaLinks();
  const { pick } = useSpatialPick();
  const sounds = scene
    ? links.filter(
        (l) => l.sheetId === scene.sheetId && l.sceneNumber === scene.number && isSound(l) && barsOf(l).length,
      )
    : [];
  const chosen = (pick && sounds.find((l) => sameSpatialPick(pick, l))) ?? null;

  if (!scene)
    return <p className="font-body text-xs italic text-muted-ink">Open a scene to place its sounds in the room.</p>;
  if (!sounds.length)
    return (
      <p className="font-body text-xs italic text-muted-ink">
        No sounds on this scene&rsquo;s timeline yet. Drag a sound from the Media Library onto a ♪ sound track.
      </p>
    );

  return (
    <>
      <p className="font-body text-xs italic text-muted-ink">
        Where in the room each sound is heard. Drag the dot towards a speaker to hear it only there; in the middle, all
        four speakers play it evenly. Click a sound&rsquo;s bar on the timeline to choose it here.
      </p>
      <label className="flex items-center gap-2 font-body text-xs text-ink">
        Sound
        <select
          value={chosen ? sounds.indexOf(chosen) : ''}
          onChange={(e) => {
            const l = sounds[Number(e.target.value)];
            if (l) pickSpatialSound(l);
          }}
          className="min-w-0 flex-1 border border-ink bg-paper px-1 py-0.5 font-body text-xs"
        >
          {!chosen && <option value="">Choose a sound…</option>}
          {sounds.map((l, i) => (
            <option key={`${l.assetId}|${l.action}`} value={i}>
              {nameOf(l)}
              {l.action ? ` — ${l.action}` : ''}
            </option>
          ))}
        </select>
      </label>
      {chosen && <RoomSquare key={`${chosen.assetId}|${chosen.action}`} link={chosen} assets={assets} />}
    </>
  );
}

/** The square: four speakers at its corners, the front of the room at the top, and the sound's dot. */
function RoomSquare({ link, assets }: { link: MediaLink; assets: MediaAsset[] }) {
  const saved = clampPan(link.pan);
  const [moving, setMoving] = useState<Pan | null>(null);
  const pan = moving ?? saved;
  const box = useRef<HTMLDivElement>(null);
  const gains = speakerGains(pan);
  const asset = assets.find((a) => a.id === link.assetId);
  const playing = useSoundPlaying(link.assetId);
  const output = useRoomOutput();
  const [problem, setProblem] = useState('');

  // Another bar's sound chosen while dragging: the drag ends.
  useEffect(() => () => setMoving(null), []);

  const save = (p: Pan) => {
    const same = Math.abs(p.x - saved.x) < 1e-3 && Math.abs(p.y - saved.y) < 1e-3;
    if (same) return;
    updateMediaLinks(
      (all) =>
        all.map((x) =>
          x.assetId === link.assetId &&
          x.action === link.action &&
          x.sheetId === link.sheetId &&
          x.sceneNumber === link.sceneNumber
            ? { ...x, pan: isCentre(p) ? undefined : p }
            : x,
        ),
      `Move ${link.assetId} in the room`,
    );
  };
  const move = (p: Pan) => {
    setMoving(p);
    setSoundPan(link.assetId, p);
  };
  const at = (e: React.PointerEvent): Pan => {
    const r = box.current!.getBoundingClientRect();
    return clampPan({
      x: ((e.clientX - r.left) / r.width) * 2 - 1,
      y: 1 - ((e.clientY - r.top) / r.height) * 2,
    });
  };
  // Arrow keys move the dot a tenth of the way; Home puts it back in the middle.
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.25 : 0.1;
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (e.key === 'Home') {
      e.preventDefault();
      move(CENTRE);
      save(CENTRE);
      setMoving(null);
      return;
    }
    const by = d[e.key];
    if (!by) return;
    e.preventDefault();
    const next = clampPan({ x: pan.x + by[0], y: pan.y + by[1] });
    move(next);
    save(next);
    setMoving(null);
  };

  const listen = async () => {
    setProblem('');
    if (playing) return stopSounds(link.assetId);
    if (!asset) return setProblem('This sound isn’t in the Media Library — refresh the media folder.');
    try {
      await playSound(asset, true, clampSoundVolume(link.volume));
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'It couldn’t be played.');
    }
  };

  const where = isCentre(pan)
    ? 'the middle of the room — all four speakers evenly'
    : (SPEAKERS.filter((_, i) => gains[i] > 0.995).map((s) => `only speaker ${s.label} (${s.name.toLowerCase()})`)[0] ??
      SPEAKERS.map((s, i) => ({ label: s.label, level: gains[i] }))
        .sort((a, b) => a.label - b.label)
        .map((s) => `${s.label}: ${Math.round(s.level * 100)}%`)
        .join(', '));

  return (
    <div className="flex flex-col gap-2" data-tour="spatial-square">
      <span className="text-center font-label text-[10px] uppercase tracking-wide text-muted-ink">Front</span>
      {/* Room round the square for the speakers, which sit on its corners. */}
      <div className="px-5 py-3">
        <div
          ref={box}
          role="slider"
          tabIndex={0}
          aria-label={`Where ${nameOf(link)} is heard in the room`}
          aria-valuetext={where}
          aria-valuenow={Math.round(pan.x * 100)}
          aria-valuemin={-100}
          aria-valuemax={100}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            move(at(e));
          }}
          onPointerMove={(e) => {
            if (moving) move(at(e));
          }}
          onPointerUp={(e) => {
            if (!moving) return;
            const p = at(e);
            setMoving(null);
            save(p);
          }}
          onPointerCancel={() => setMoving(null)}
          onDoubleClick={() => {
            move(CENTRE);
            save(CENTRE);
            setMoving(null);
          }}
          onKeyDown={key}
          className="relative mx-auto aspect-square w-full max-w-[260px] cursor-crosshair touch-none select-none border-2 border-ink bg-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3c5eac]"
          title="Drag the dot (or click anywhere) — double-click puts it back in the middle; arrow keys move it"
        >
          {/* Guides: the middle lines. */}
          <span className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-dashed border-hair" />
          <span className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-hair" />
          {SPEAKERS.map((s, i) => {
            const level = gains[i];
            return (
              <span
                key={s.n}
                className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                style={{
                  left: `${((s.x + 1) / 2) * 100}%`,
                  top: `${((1 - s.y) / 2) * 100}%`,
                }}
              >
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-ink font-label text-sm text-ink transition-colors"
                  style={{
                    background: `rgba(60, 94, 172, ${0.1 + 0.8 * level})`,
                    color: level > 0.55 ? '#fff' : undefined,
                  }}
                  title={`Speaker ${s.label} — ${s.name}`}
                >
                  {s.label}
                </span>
              </span>
            );
          })}
          {SPEAKERS.map((s, i) => (
            <span
              key={`pct${s.n}`}
              className="pointer-events-none absolute font-body text-[10px] tabular-nums text-muted-ink"
              style={{
                left: s.x < 0 ? '26px' : undefined,
                right: s.x > 0 ? '26px' : undefined,
                top: s.y > 0 ? '22px' : undefined,
                bottom: s.y < 0 ? '22px' : undefined,
              }}
            >
              {Math.round(gains[i] * 100)}%
            </span>
          ))}
          <span
            className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-paper bg-[#3c5eac] shadow-md ring-2 ring-[#3c5eac]"
            style={{
              left: `${((pan.x + 1) / 2) * 100}%`,
              top: `${((1 - pan.y) / 2) * 100}%`,
            }}
            aria-hidden="true"
          />
        </div>
      </div>
      <span className="text-center font-label text-[10px] uppercase tracking-wide text-muted-ink">Back</span>
      <p className="font-body text-xs text-ink">Heard: {where}.</p>
      {output && (
        // Where this browser plays the sounds: the room's four speakers, or only left and right.
        <p
          className={`font-body text-xs ${output.speakers === 4 ? 'text-muted-ink' : 'border-l-4 border-[#b91c1c] pl-2 text-ink'}`}
        >
          {output.speakers === 4
            ? `Playing on ${output.device}: each of the four speakers on its own output.`
            : `Playing on ${output.device}, which has only two channels, so the dot moves the sound only between left and right.`}
        </p>
      )}
      {output?.speakers !== 4 && (
        <button
          onClick={() =>
            void chooseRoomSpeakers().then((o) => {
              if (o?.speakers !== 4)
                setProblem(
                  'The GIGAPORT eX wasn’t found. Check that it’s plugged in, and that Chrome may use the microphone (it names sound devices only then).',
                );
              else setProblem('');
            })
          }
          className={buttonOutlineCompact}
          title="Plays the sounds straight to the GIGAPORT eX, one speaker per output. Chrome asks to use the microphone once — only so it will name the sound devices."
        >
          Use the room&rsquo;s speakers
        </button>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void listen()} className={buttonOutlineCompact}>
          {playing ? '■ Stop' : '▶ Play it to listen'}
        </button>
        <button
          onClick={() => {
            move(CENTRE);
            save(CENTRE);
            setMoving(null);
          }}
          disabled={isCentre(pan)}
          className={`${buttonOutlineCompact} disabled:opacity-40`}
        >
          Middle of the room
        </button>
      </div>
      {problem && <p className="border-l-4 border-[#b91c1c] pl-2 font-body text-xs text-ink">{problem}</p>}
    </div>
  );
}
