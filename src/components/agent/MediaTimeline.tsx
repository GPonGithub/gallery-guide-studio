'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { buttonIcon } from '@/lib/styles';
import { kindOf } from '@/lib/agent/media';
import { timingOf, updateMediaLinks, useMediaLinks, type MediaLink } from '@/lib/agent/mediaFolder';

/**
 * The media timeline: one column per conversation stage of the open scene
 * (1, 2A, 2B, 3…, in that order — the conversation's own steps, since what it
 * says sets the timing, not a clock), 11 tracks down (one per projection
 * area), and a playhead on the current stage. Each scene has its own
 * timeline (`sceneKey`), and keeps its playhead. Drag the playhead (or click
 * a stage on the ruler); ◀ and ▶ step a stage; with the ruler focused, ← →
 * step and Home / End jump to the ends. During a conversation the playhead
 * follows it (`liveStage`). It fills the space it's given.
 *
 * Each media file connected to one of the scene's actions (Media Library) is
 * a bar, named with the action's words: images and video on a projection
 * track, sounds on the sound track at the bottom. Drag a bar's ends to
 * stretch it across stages; drag its middle to move it to other stages, or
 * (images and video) to another projection track.
 */

export const TRACKS = 11;
/** The tracks, top to bottom: the 11 projection areas, then sound. */
type Track = number | 'sound';
const ROWS: Track[] = [...Array.from({ length: TRACKS }, (_, i) => i + 1), 'sound'];
type Bar = NonNullable<MediaLink['bar']>;

const linkKey = (l: MediaLink) => `${l.assetId}|${l.action}`;
const isSound = (l: MediaLink) => (l.assetKind ?? kindOf(l.assetName ?? '')) === 'sound';

export type TimelineStage = { code: string; name: string };

const branchNumber = (code: string) => /^(\d+)[A-Za-z]+$/.exec(code.trim())?.[1] ?? null;

/** Runs of alternative branches (2A, 2B…: the conversation takes one of them), by column. */
function branchRuns(stages: TimelineStage[]): { from: number; to: number; number: string }[] {
  const runs: { from: number; to: number; number: string }[] = [];
  stages.forEach((s, i) => {
    const n = branchNumber(s.code);
    const last = runs.at(-1);
    if (n && last && last.number === n && last.to === i - 1) last.to = i;
    else if (n) runs.push({ from: i, to: i, number: n });
  });
  return runs.filter((r) => r.to > r.from);
}

export function MediaTimeline({
  sceneKey,
  sceneTitle,
  stages,
  liveStage,
  scene,
}: {
  sceneKey: string;
  sceneTitle: string;
  /** The open scene in the sheet (its media actions' connections are its bars); null if it isn't from one. */
  scene: { sheetId: string; number: string } | null;
  /** The open scene's stages, in order (see sortStages). */
  stages: TimelineStage[];
  /** The stage the conversation is in now: the playhead follows it. */
  liveStage?: string;
}) {
  const count = stages.length;
  const clamp = (i: number) => Math.min(Math.max(count - 1, 0), Math.max(0, i));
  /** Each scene's playhead, kept as its stage's code (so it stays put if stages are added). */
  const [heads, setHeads] = useState<Record<string, string>>({});
  const found = stages.findIndex((s) => s.code === heads[sceneKey]);
  const index = found >= 0 ? found : 0;
  const moveTo = (to: number | ((i: number) => number)) => {
    if (count === 0) return;
    setHeads((all) => {
      const nowAt = Math.max(
        0,
        stages.findIndex((s) => s.code === all[sceneKey]),
      );
      const next = clamp(typeof to === 'function' ? to(nowAt) : to);
      return { ...all, [sceneKey]: stages[next].code };
    });
  };
  // The conversation moved to another stage: the playhead goes with it.
  const [followed, setFollowed] = useState(liveStage);
  if (liveStage !== followed) {
    setFollowed(liveStage);
    if (liveStage && stages.some((s) => s.code === liveStage)) setHeads((all) => ({ ...all, [sceneKey]: liveStage }));
  }

  const ruler = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const stageAt = (clientX: number) => {
    const r = ruler.current?.getBoundingClientRect();
    if (!r || r.width === 0 || count === 0) return index;
    return clamp(Math.floor(((clientX - r.left) / r.width) * count));
  };

  const at = (i: number) => `${(i / Math.max(count, 1)) * 100}%`;
  const width = `${100 / Math.max(count, 1)}%`;
  const rows: CSSProperties = { gridTemplateRows: `repeat(${ROWS.length}, minmax(22px, 1fr))` };

  // This scene's connections — its bars.
  const allLinks = useMediaLinks();
  const mine = scene ? allLinks.filter((l) => l.sheetId === scene.sheetId && l.sceneNumber === scene.number) : [];
  const indexOf = (code: string, fallback: number) => {
    const i = stages.findIndex((s) => s.code === code);
    return i >= 0 ? i : fallback;
  };
  const span = (bar: Bar) => {
    const from = indexOf(bar.from, 0);
    return { from, to: Math.max(from, indexOf(bar.to, count - 1)) };
  };

  // A new connection's bar: "every time" and "throughout" actions span the scene, "once" ones a
  // stage; sounds on the sound track, images and video on the first projection track free there.
  useEffect(() => {
    if (!scene || count === 0 || !mine.some((l) => !l.bar)) return;
    updateMediaLinks((all) => {
      const placed: { track: Track; from: number; to: number }[] = all
        .filter((l) => l.bar && l.sheetId === scene.sheetId && l.sceneNumber === scene.number)
        .map((l) => ({ track: l.bar!.track, ...span(l.bar!) }));
      return all.map((l) => {
        if (l.bar || l.sheetId !== scene.sheetId || l.sceneNumber !== scene.number) return l;
        const whole = timingOf(l).kind !== 'once';
        const from = 0;
        const to = whole ? count - 1 : 0;
        let track: Track = 'sound';
        if (!isSound(l)) {
          track =
            ROWS.find((t) => t !== 'sound' && !placed.some((p) => p.track === t && p.from <= to && from <= p.to)) ?? 1;
        }
        placed.push({ track, from, to });
        return { ...l, bar: { track, from: stages[from].code, to: stages[to].code } };
      });
    });
    // span() reads `stages`, which is in the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.sheetId, scene?.number, count, stages, allLinks]);

  // A bar being dragged: where it would land (shown as it moves, saved on letting go).
  const tracksBox = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{
    key: string;
    mode: 'move' | 'from' | 'to';
    x: number;
    y: number;
    start: { track: Track; from: number; to: number };
    now: { track: Track; from: number; to: number };
  } | null>(null);
  const grab = (e: React.PointerEvent, l: MediaLink, mode: 'move' | 'from' | 'to') => {
    if (e.button !== 0 || !l.bar) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not a real pointer — following still works on the bar.
    }
    const start = { track: l.bar.track, ...span(l.bar) };
    setDrag({ key: linkKey(l), mode, x: e.clientX, y: e.clientY, start, now: start });
  };
  const follow = (e: React.PointerEvent, l: MediaLink) => {
    if (!drag || drag.key !== linkKey(l)) return;
    const box = tracksBox.current?.getBoundingClientRect();
    if (!box) return;
    const columns = Math.round((e.clientX - drag.x) / (box.width / count));
    const rowsMoved = Math.round((e.clientY - drag.y) / (box.height / ROWS.length));
    const { start } = drag;
    let now = start;
    if (drag.mode === 'move') {
      const length = start.to - start.from;
      const from = Math.min(Math.max(0, start.from + columns), count - 1 - length);
      let track = start.track;
      if (track !== 'sound') track = Math.min(TRACKS, Math.max(1, track + rowsMoved));
      now = { track, from, to: from + length };
    } else if (drag.mode === 'from') {
      now = { ...start, from: Math.min(start.to, Math.max(0, start.from + columns)) };
    } else {
      now = { ...start, to: Math.max(start.from, Math.min(count - 1, start.to + columns)) };
    }
    if (now.track !== drag.now.track || now.from !== drag.now.from || now.to !== drag.now.to) setDrag({ ...drag, now });
  };
  const letGo = (l: MediaLink) => {
    if (!drag || drag.key !== linkKey(l)) return;
    const { now } = drag;
    setDrag(null);
    updateMediaLinks((all) =>
      all.map((x) =>
        x === l || (linkKey(x) === drag.key && x.sheetId === l.sheetId && x.sceneNumber === l.sceneNumber)
          ? { ...x, bar: { track: now.track, from: stages[now.from].code, to: stages[now.to].code } }
          : x,
      ),
    );
  };
  const current = stages[index];
  const runs = branchRuns(stages);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-display text-lg text-ink" title={sceneTitle}>
          Timeline <span className="font-body text-sm text-muted-ink">· {sceneTitle}</span>
        </p>
        {current && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => moveTo((i) => i - 1)}
              disabled={index === 0}
              aria-label="Previous stage"
              className={`h-8 w-8 text-xs ${buttonIcon}`}
            >
              ◀
            </button>
            <span
              className="w-[150px] truncate text-center font-body text-sm text-ink"
              aria-live="polite"
              title={`Stage ${current.code} · ${current.name}`}
            >
              Stage {current.code}
              <span className="text-muted-ink"> · {current.name}</span>
            </span>
            <button
              onClick={() => moveTo((i) => i + 1)}
              disabled={index === count - 1}
              aria-label="Next stage"
              className={`h-8 w-8 text-xs ${buttonIcon}`}
            >
              ▶
            </button>
          </div>
        )}
      </div>

      {!current ? (
        <p className="font-body text-xs italic text-muted-ink">
          This scene has no conversation stages yet. Generate its conversation (Design Process, step 3) — its stages
          become the timeline&rsquo;s columns.
        </p>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[28px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-y-auto overflow-x-hidden">
          <div aria-hidden="true" />

          {/* The ruler: each stage's code, with alternative branches bracketed, and the playhead's handle. */}
          <div
            ref={ruler}
            role="slider"
            aria-label="Playhead"
            aria-valuemin={1}
            aria-valuemax={count}
            aria-valuenow={index + 1}
            aria-valuetext={`Stage ${current.code}: ${current.name}`}
            tabIndex={0}
            title="Drag the playhead, or click a stage"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // Not a real pointer — following still works on the ruler.
              }
              dragging.current = true;
              moveTo(stageAt(e.clientX));
            }}
            onPointerMove={(e) => {
              if (dragging.current) moveTo(stageAt(e.clientX));
            }}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
            onLostPointerCapture={() => (dragging.current = false)}
            onKeyDown={(e) => {
              const step: Record<string, (i: number) => number> = {
                ArrowLeft: (i) => i - 1,
                ArrowRight: (i) => i + 1,
                Home: () => 0,
                End: () => count - 1,
              };
              const move = step[e.key];
              if (!move) return;
              e.preventDefault();
              moveTo(move);
            }}
            className="relative h-11 cursor-ew-resize touch-none select-none outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {/* Alternative branches: a bracket over 2A, 2B… — the conversation takes one of them. */}
            {runs.map((r) => (
              <div
                key={r.from}
                className="absolute top-[6px] flex h-[8px] justify-center border-x border-t border-ink/50"
                style={{ left: `calc(${at(r.from)} + 3px)`, width: `calc(${at(r.to + 1)} - ${at(r.from)} - 6px)` }}
                title={`Stages ${stages
                  .slice(r.from, r.to + 1)
                  .map((s) => s.code)
                  .join(', ')}: alternatives — the conversation takes one of them`}
              >
                <span className="-mt-[6px] h-fit bg-paper px-1 font-label text-[8px] uppercase leading-none tracking-wide text-muted-ink">
                  or
                </span>
              </div>
            ))}
            {/* The playhead's handle: a black block over the current stage. */}
            <div className="absolute bottom-0 h-[24px] bg-ink" style={{ left: at(index), width }} />
            {stages.map((s, i) => (
              <span
                key={s.code}
                className={`absolute bottom-[7px] truncate px-0.5 text-center font-label text-[11px] leading-none ${
                  i === index ? 'text-paper' : 'text-ink'
                }`}
                style={{ left: at(i), width }}
                title={`Stage ${s.code} · ${s.name}`}
              >
                {s.code}
              </span>
            ))}
            <div className="absolute inset-x-0 bottom-0 h-px bg-ink" />
            {Array.from({ length: count + 1 }, (_, i) => (
              <div key={i} className="absolute bottom-0 h-[12px] w-px bg-ink" style={{ left: at(i) }} />
            ))}
          </div>

          {/* Track numbers, and the sound track. */}
          <div className="grid" style={rows}>
            {ROWS.map((t) => (
              <span
                key={t}
                className="flex items-center font-body text-[11px] text-ink"
                title={t === 'sound' ? 'Sound' : `Projection area ${t}`}
              >
                {t === 'sound' ? '♪' : t}
              </span>
            ))}
          </div>

          {/* The tracks, and the playhead through them. */}
          <div ref={tracksBox} className="relative grid" style={rows}>
            <div
              className="pointer-events-none absolute inset-y-0 bg-ink/10"
              style={{ left: at(index), width }}
              aria-hidden="true"
            />
            {ROWS.map((t) => (
              <div key={t} className="relative" aria-label={t === 'sound' ? 'Sound track' : `Track ${t}`}>
                {Array.from({ length: count + 1 }, (_, i) => (
                  <div key={i} className="absolute inset-y-0 w-px bg-ink/15" style={{ left: at(i) }} />
                ))}
                <div
                  className={`absolute inset-x-0 bottom-[2.5px] top-[2.5px] border border-dashed ${t === 'sound' ? 'border-[#3c5eac]/60' : 'border-ink/50'}`}
                />
              </div>
            ))}
            {/* The bars, on one layer over the tracks — so a bar dragged to another track stays the same element. */}
            {mine.map((l) => {
              if (!l.bar) return null;
              const dragging = drag?.key === linkKey(l) ? drag.now : null;
              const place = dragging ?? { track: l.bar.track, ...span(l.bar) };
              const row = ROWS.indexOf(place.track);
              const every = timingOf(l).kind === 'every';
              const stagesText =
                place.from === place.to
                  ? `stage ${stages[place.from].code}`
                  : `stages ${stages[place.from].code}–${stages[place.to].code}`;
              return (
                <div
                  key={linkKey(l)}
                  onPointerDown={(e) => grab(e, l, 'move')}
                  onPointerMove={(e) => follow(e, l)}
                  onPointerUp={() => letGo(l)}
                  onPointerCancel={() => setDrag(null)}
                  title={`${l.action}\n${l.assetId}${l.assetName ? ` ${l.assetName}` : ''} · ${stagesText} — drag to move, drag an end to stretch`}
                  className={`absolute z-10 flex cursor-grab touch-none select-none items-center overflow-hidden border border-[#3c5eac] bg-[#3c5eac] text-paper shadow-sm active:cursor-grabbing ${
                    dragging ? 'opacity-80 ring-2 ring-ink' : ''
                  }`}
                  style={{
                    left: `calc(${at(place.from)} + 2px)`,
                    width: `calc(${at(place.to + 1)} - ${at(place.from)} - 4px)`,
                    // Nearly the whole row: about 5px between one track's bars and the next.
                    top: `calc(${(row / ROWS.length) * 100}% + 2.5px)`,
                    height: `calc(${100 / ROWS.length}% - 5px)`,
                  }}
                >
                  <span
                    onPointerDown={(e) => grab(e, l, 'from')}
                    onPointerMove={(e) => {
                      e.stopPropagation();
                      follow(e, l);
                    }}
                    onPointerUp={(e) => {
                      e.stopPropagation();
                      letGo(l);
                    }}
                    className="h-full w-2 shrink-0 cursor-ew-resize border-r border-paper/50 bg-ink/20"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate px-1 font-body text-[15px] leading-none">
                    {every ? '↻ ' : ''}
                    {l.action}
                  </span>
                  <span
                    onPointerDown={(e) => grab(e, l, 'to')}
                    onPointerMove={(e) => {
                      e.stopPropagation();
                      follow(e, l);
                    }}
                    onPointerUp={(e) => {
                      e.stopPropagation();
                      letGo(l);
                    }}
                    className="h-full w-2 shrink-0 cursor-ew-resize border-l border-paper/50 bg-ink/20"
                    aria-hidden="true"
                  />
                </div>
              );
            })}
            <div
              className="pointer-events-none absolute inset-y-0 z-20 w-[2px] -translate-x-px bg-ink"
              style={{ left: at(index) }}
              aria-hidden="true"
            />
          </div>
        </div>
      )}
    </div>
  );
}
