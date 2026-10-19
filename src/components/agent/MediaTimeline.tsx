'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { buttonIcon } from '@/lib/styles';
import { DropdownArrow } from './DropdownArrow';
import { markerArrived } from '@/lib/agent/markerPlay';
import {
  ACTION_KINDS,
  isStill,
  kindOf,
  KIND_BADGE,
  KIND_HELP,
  LOOP_WHEN_BADGE,
  VOICE_LABEL,
  WHEN_LABEL,
  type ActionKind,
  type EveryWhen,
  type VoiceWait,
} from '@/lib/agent/media';
import { stopSounds } from '@/lib/agent/mediaPlayback';
import { hideVisualExcept } from '@/lib/agent/mediaShow';
import {
  areaOfTrack,
  barsOf,
  loopOf,
  timingOf,
  useActionReadings,
  updateMediaLinks,
  useHistoryNote,
  useMediaLinks,
  useSceneActions,
  isConnected,
  isMarker,
  MARKER_ACTION,
  MARKER_LABEL,
  DRAG_SOUND,
  DRAG_VISUAL,
  type DraggedAsset,
  type MediaLink,
  type TimelineBar,
} from '@/lib/agent/mediaFolder';

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
 * (images and video) to another projection track. Hold Option (Alt) while
 * dragging to duplicate it instead — the same action on another screen too.
 * Its × deletes it (the last bar of a connection disconnects the file).
 */

export const TRACKS = 11;
/**
 * Sound tracks: the ♪ row opens (its arrow) into up to this many, so sounds
 * that overlap in time each get a row. (Chrome could play far more at once —
 * about 75 media players a page — but five keeps the mix clear.)
 */
export const MAX_SOUND_TRACKS = 5;
/** Each projection area's number opens (its arrow) into this many tracks — several media for one screen. */
export const MAX_AREA_TRACKS = 5;
/** The tracks, top to bottom: the 11 projection areas (each perhaps opened into more), then the sound tracks. */
type Track = TimelineBar['track'];
const PROJECTION_ROWS: Track[] = Array.from({ length: TRACKS }, (_, i) => i + 1);
const areaTrack = (area: number, k: number): Track => (k <= 1 ? area : `${area}-${k}`);
/** An area's extra tracks (5-2 … 5-5). */
const extraTracks = (area: number): Track[] =>
  Array.from({ length: MAX_AREA_TRACKS - 1 }, (_, i) => areaTrack(area, i + 2));
const soundTrack = (n: number): Track => (n <= 1 ? 'sound' : `sound-${n}`);
const isSoundTrack = (t: Track) => typeof t === 'string' && t.startsWith('sound');
/** A track's number within its group: an area's 1–5, or a sound track's 1–5. */
const laneOf = (t: Track) => (typeof t === 'number' || t === 'sound' ? 1 : Number(/(\d+)$/.exec(t)?.[1] ?? 1) || 1);
const SOUND_TRACKS: Track[] = Array.from({ length: MAX_SOUND_TRACKS }, (_, i) => soundTrack(i + 1));
/** Where new pictures and video go: the 11 areas' own tracks first, then their extra ones. */
const PLACE_TRACKS: Track[] = [...PROJECTION_ROWS, ...PROJECTION_ROWS.flatMap((a) => extraTracks(a as number))];
const SOUNDS_OPEN_KEY = 'timeline-sounds-open';
const AREAS_OPEN_KEY = 'timeline-areas-open';
type Bar = TimelineBar;

const linkKey = (l: MediaLink) => `${l.assetId}|${l.action}`;
/** One bar: its connection, and which of the connection's bars (0 = the first, then its duplicates). */
const barKey = (l: MediaLink, i: number) => `${linkKey(l)}#${i}`;
/** The same connection (by file, action and scene — the stored copy may be a newer object). */
const sameLink = (a: MediaLink, b: MediaLink) =>
  a === b || (linkKey(a) === linkKey(b) && a.sheetId === b.sheetId && a.sceneNumber === b.sceneNumber);

/** A connection with its bar number `i` changed (`to`), or removed (`to` null). */
function withBar(l: MediaLink, i: number, to: Bar | null): MediaLink {
  const bars = barsOf(l);
  if (to) bars[i] = to;
  else bars.splice(i, 1);
  const [bar, ...copies] = bars;
  return { ...l, bar, copies };
}
const isSound = (l: MediaLink) => (l.assetKind ?? kindOf(l.assetName ?? '')) === 'sound';

/** A stage of the scene's conversation: its code (1, 2A…), its name, and (for the tooltip) its goal. */
export type TimelineStage = { code: string; name: string; goal?: string };

type Placed = { track: Track; from: number; to: number };

/**
 * Where a new bar goes: the first empty space for it, never on top of another
 * bar if there's room anywhere. It tries, in order: its own stages on each
 * track (top first); the same length at the nearest other stages; then
 * (`canShrink`) shorter and shorter, down to a single stage. Only a timeline
 * with no room at all puts it over another bar, where it wanted to be.
 */
function findSpace(
  placed: Placed[],
  tracks: Track[],
  from: number,
  to: number,
  count: number,
  canShrink: boolean,
): Placed {
  const free = (track: Track, a: number, b: number) =>
    !placed.some((p) => p.track === track && p.from <= b && a <= p.to);
  const want = to - from + 1;
  for (let length = want; length >= (canShrink ? 1 : want); length--) {
    // Starting stages nearest the one it wanted first.
    const starts = Array.from({ length: count - length + 1 }, (_, i) => i).sort(
      (a, b) => Math.abs(a - from) - Math.abs(b - from) || a - b,
    );
    for (const start of starts)
      for (const track of tracks)
        if (free(track, start, start + length - 1)) return { track, from: start, to: start + length - 1 };
  }
  return { track: tracks[0], from, to };
}

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
  // Moved by hand (◀ ▶, the ruler, arrow keys): "on marker arrival" media plays for where it lands.
  const movedByHand = useRef(false);
  const moveTo = (to: number | ((i: number) => number)) => {
    if (count === 0) return;
    movedByHand.current = true;
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

  const headCode = stages[index]?.code;
  useEffect(() => {
    if (!movedByHand.current) return;
    movedByHand.current = false;
    void markerArrived(scene, stages, headCode);
    // Only the marker landing somewhere new matters (stages and scene go with headCode).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headCode]);

  const ruler = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const stageAt = (clientX: number) => {
    const r = ruler.current?.getBoundingClientRect();
    if (!r || r.width === 0 || count === 0) return index;
    return clamp(Math.floor(((clientX - r.left) / r.width) * count));
  };

  const at = (i: number) => `${(i / Math.max(count, 1)) * 100}%`;
  const width = `${100 / Math.max(count, 1)}%`;
  // This scene's connections — its bars.
  const allLinks = useMediaLinks();
  const mine = scene ? allLinks.filter((l) => l.sheetId === scene.sheetId && l.sceneNumber === scene.number) : [];

  // The sound tracks: one ♪ row, which its arrow opens into all MAX_SOUND_TRACKS (remembered). Closed,
  // every sound shows on the one row. They're tinted light blue, for audio.
  const [soundsOpen, setSoundsOpen] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only: localStorage doesn't exist during SSR
      setSoundsOpen(window.localStorage.getItem(SOUNDS_OPEN_KEY) === 'true');
    } catch {
      // Storage blocked: closed.
    }
  }, []);
  const toggleSounds = () => {
    setSoundsOpen((open) => {
      try {
        window.localStorage.setItem(SOUNDS_OPEN_KEY, String(!open));
      } catch {
        // Not remembered.
      }
      return !open;
    });
  };
  // Each projection area's number opens (its arrow) into MAX_AREA_TRACKS tracks — remembered.
  const [areasOpen, setAreasOpen] = useState<number[]>([]);
  useEffect(() => {
    try {
      const kept = JSON.parse(window.localStorage.getItem(AREAS_OPEN_KEY) ?? '[]') as number[];
      // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only: localStorage doesn't exist during SSR
      if (Array.isArray(kept)) setAreasOpen(kept.filter((a) => typeof a === 'number'));
    } catch {
      // Storage blocked: all closed.
    }
  }, []);
  const toggleArea = (area: number) =>
    setAreasOpen((open) => {
      const next = open.includes(area) ? open.filter((a) => a !== area) : [...open, area];
      try {
        window.localStorage.setItem(AREAS_OPEN_KEY, JSON.stringify(next));
      } catch {
        // Not remembered.
      }
      return next;
    });
  const lanes = soundsOpen ? MAX_SOUND_TRACKS : 1;
  const projectionRows: Track[] = PROJECTION_ROWS.flatMap((a) =>
    areasOpen.includes(a as number) ? [a, ...extraTracks(a as number)] : [a],
  );
  const soundRows = SOUND_TRACKS.slice(0, lanes);
  const trackRows: Track[] = [...projectionRows, ...soundRows];
  /** The row a track shows on: its own, or — its group closed — its area's (or the first ♪) row. */
  const visibleTrack = (t: Track): Track =>
    trackRows.includes(t) ? t : isSoundTrack(t) ? 'sound' : (areaOfTrack(t) ?? 1);
  const rowOf = (t: Track) => trackRows.indexOf(visibleTrack(t));
  const rows: CSSProperties = { gridTemplateRows: `repeat(${trackRows.length}, minmax(22px, 1fr))` };
  const indexOf = (code: string, fallback: number) => {
    const i = stages.findIndex((s) => s.code === code);
    return i >= 0 ? i : fallback;
  };
  const span = (bar: Bar) => {
    const from = indexOf(bar.from, 0);
    return { from, to: Math.max(from, indexOf(bar.to, count - 1)) };
  };

  // A new connection's bar: "every time" and "throughout" actions span the scene, "once" and "at
  // the start" ones the first stage, "at the end" ones the last; sounds on the sound track, images and
  // video on a projection track — in the first empty space for it (see findSpace).
  // And when a connection's "When it plays" changes (in the Media Library, or a new reading of its
  // words), its bars are laid out again for it — on the same tracks: across the scene, the last stage,
  // or (once, at the start) the one stage they start at.
  const readings = useActionReadings();
  const kindNow = (l: MediaLink) => timingOf(l).kind;
  useEffect(() => {
    if (!scene || count === 0) return;
    const ours = (l: MediaLink) => l.sheetId === scene.sheetId && l.sceneNumber === scene.number;
    if (!mine.some((l) => !l.bar || l.barsKind !== kindNow(l))) return;
    updateMediaLinks((all) => {
      const placed: { track: Track; from: number; to: number }[] = all
        .filter(ours)
        .flatMap((l) => barsOf(l).map((b) => ({ track: b.track, ...span(b) })));
      return all.map((l) => {
        if (!ours(l)) return l;
        const kind = kindNow(l);
        if (l.bar && l.barsKind === kind) return l;
        // Laid out before this was kept: take it as it is.
        if (l.bar && l.barsKind === undefined) return { ...l, barsKind: kind };
        if (l.bar) {
          const respan = (b: Bar): Bar => {
            const { from } = span(b);
            const [a, z] =
              kind === 'every' || kind === 'throughout'
                ? [0, count - 1]
                : kind === 'end'
                  ? [count - 1, count - 1]
                  : [from, from];
            return { ...b, from: stages[a].code, to: stages[z].code };
          };
          const [bar, ...copies] = barsOf(l).map(respan);
          return { ...l, bar, copies, barsKind: kind };
        }
        // Every time / throughout: the whole scene; at the end: the last stage; once / at the start: the first.
        const from = kind === 'end' ? count - 1 : 0;
        const to = kind === 'every' || kind === 'throughout' || kind === 'end' ? count - 1 : 0;
        // Sounds keep their length (the sound track is the only place for them); pictures and video
        // would rather be shorter than sit on another bar.
        const spot = isSound(l)
          ? findSpace(placed, SOUND_TRACKS, from, to, count, false)
          : findSpace(placed, PLACE_TRACKS, from, to, count, true);
        placed.push(spot);
        return {
          ...l,
          bar: { track: spot.track, from: stages[spot.from].code, to: stages[spot.to].code },
          barsKind: kind,
        };
      });
    });
    // span() reads `stages`, which is in the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.sheetId, scene?.number, count, stages, allLinks, readings]);

  // A bar being dragged: where it would land (shown as it moves, saved on letting go).
  const tracksBox = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{
    key: string;
    /** Which of its connection's bars. */
    index: number;
    mode: 'move' | 'from' | 'to';
    /** Option (Alt) held as the drag began: a duplicate is made where it's let go; the bar stays put. */
    copy: boolean;
    x: number;
    y: number;
    start: { track: Track; from: number; to: number };
    now: { track: Track; from: number; to: number };
  } | null>(null);
  const grab = (e: React.PointerEvent, l: MediaLink, i: number, mode: 'move' | 'from' | 'to') => {
    const bar = barsOf(l)[i];
    if (e.button !== 0 || !bar) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not a real pointer — following still works on the bar.
    }
    const start = { track: bar.track, ...span(bar) };
    const copy = mode === 'move' && e.altKey;
    setDrag({ key: barKey(l, i), index: i, mode, copy, x: e.clientX, y: e.clientY, start, now: start });
  };
  const follow = (e: React.PointerEvent, l: MediaLink, i: number) => {
    if (!drag || drag.key !== barKey(l, i)) return;
    const box = tracksBox.current?.getBoundingClientRect();
    if (!box) return;
    const columns = Math.round((e.clientX - drag.x) / (box.width / count));
    const rowsMoved = Math.round((e.clientY - drag.y) / (box.height / trackRows.length));
    const { start } = drag;
    let now = start;
    if (drag.mode === 'move') {
      const length = start.to - start.from;
      const from = Math.min(Math.max(0, start.from + columns), count - 1 - length);
      let track = start.track;
      // Pictures and video move among the projection tracks shown (an area's extra ones too, if open);
      // sounds among the open sound tracks.
      const group = isSoundTrack(track) ? soundRows : projectionRows;
      const pos = group.indexOf(visibleTrack(track));
      track = group[Math.min(group.length - 1, Math.max(0, pos + rowsMoved))];
      now = { track, from, to: from + length };
    } else if (drag.mode === 'from') {
      now = { ...start, from: Math.min(start.to, Math.max(0, start.from + columns)) };
    } else {
      now = { ...start, to: Math.max(start.from, Math.min(count - 1, start.to + columns)) };
    }
    if (now.track !== drag.now.track || now.from !== drag.now.from || now.to !== drag.now.to) setDrag({ ...drag, now });
  };
  const letGo = (l: MediaLink, i: number) => {
    if (!drag || drag.key !== barKey(l, i)) return;
    const { now, start, copy } = drag;
    setDrag(null);
    const placed: Bar = { track: now.track, from: stages[now.from].code, to: stages[now.to].code };
    // Let go where it started: nothing changed (and a duplicate dropped there isn't one).
    const moved = now.track !== start.track || now.from !== start.from || now.to !== start.to;
    if (!moved) return;
    updateMediaLinks(
      (all) =>
        all.map((x) => {
          if (!sameLink(x, l)) return x;
          return copy ? { ...x, copies: [...(x.copies ?? []), placed] } : withBar(x, i, placed);
        }),
      copy ? 'Duplicate bar' : drag.mode === 'move' ? 'Move bar' : 'Stretch bar',
    );
  };
  // Its × : the bar goes. A connection's last bar takes the connection with it (the file is disconnected
  // from the action — otherwise a new bar would simply take its place).
  // What it was showing (or playing) in the room comes down with it: from that bar's screen, or — its
  // connection's last bar — altogether (unless the same file has bars for another action there).
  const remove = (l: MediaLink, i: number) => {
    const last = barsOf(l).length <= 1;
    const others = mine.filter((x) => x.assetId === l.assetId && !sameLink(x, l));
    const keep = [...others, ...(last ? [] : [withBar(l, i, null)])].flatMap((x) =>
      barsOf(x).flatMap((b) => areaOfTrack(b.track) ?? []),
    );
    hideVisualExcept(l.assetId, keep);
    if (last && others.length === 0) stopSounds(l.assetId);
    updateMediaLinks(
      (all) =>
        barsOf(l).length <= 1
          ? all.filter((x) => !sameLink(x, l))
          : all.map((x) => (sameLink(x, l) ? withBar(x, i, null) : x)),
      'Delete bar',
    );
  };
  // A Media Library item dragged over the tracks: where it would land, and whether that row takes it
  // (sounds on the sound tracks; pictures, video, text and colour on the projection tracks).
  const [dropHere, setDropHere] = useState<{ stage: number; track: Track; ok: boolean } | null>(null);
  const dropAt = (e: React.DragEvent) => {
    const box = tracksBox.current?.getBoundingClientRect();
    if (!box || count === 0) return null;
    const stage = Math.floor((e.clientX - box.left) / (box.width / count));
    const row = Math.floor((e.clientY - box.top) / (box.height / trackRows.length));
    if (stage < 0 || stage >= count || row < 0 || row >= trackRows.length) return null;
    return { stage, track: trackRows[row] };
  };
  const dragOver = (e: React.DragEvent) => {
    const sound = e.dataTransfer.types.includes(DRAG_SOUND);
    if (!sound && !e.dataTransfer.types.includes(DRAG_VISUAL)) return;
    const here = dropAt(e);
    const ok = Boolean(here && scene && (sound ? isSoundTrack(here.track) : !isSoundTrack(here.track)));
    if (ok) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
    if (here?.stage !== dropHere?.stage || here?.track !== dropHere?.track || ok !== dropHere?.ok)
      setDropHere(here ? { ...here, ok } : null);
  };
  /** A dropped item: a bar at that stage and row, not yet connected to an action (its ▼ picks one). */
  const drop = (e: React.DragEvent) => {
    const here = dropAt(e);
    setDropHere(null);
    const raw = e.dataTransfer.getData(DRAG_SOUND) || e.dataTransfer.getData(DRAG_VISUAL);
    if (!raw || !here || !scene) return;
    e.preventDefault();
    let item: DraggedAsset;
    try {
      item = JSON.parse(raw) as DraggedAsset;
    } catch {
      return;
    }
    if ((item.kind === 'sound') !== isSoundTrack(here.track)) return;
    const bar: Bar = { track: here.track, from: stages[here.stage].code, to: stages[here.stage].code };
    const ours = (l: MediaLink) => l.sheetId === scene.sheetId && l.sceneNumber === scene.number;
    updateMediaLinks((all) => {
      const unplaced = all.find((l) => ours(l) && l.assetId === item.id && !isConnected(l));
      if (unplaced)
        return all.map((l) =>
          l === unplaced ? (l.bar ? { ...l, copies: [...(l.copies ?? []), bar] } : { ...l, bar }) : l,
        );
      const link: MediaLink = {
        assetId: item.id,
        sheetId: scene.sheetId,
        sceneNumber: scene.number,
        sceneName: sceneTitle.replace(/^Scene\s+\S+\s+·\s+/, ''),
        action: '',
        assetName: item.name,
        assetKind: item.kind,
        bar,
      };
      return [...all, { ...link, barsKind: timingOf(link).kind }];
    }, `Place ${item.id}`);
  };

  // A bar's ▼: the scene's actions (row 8, as the Media Library last read them) — picking one connects
  // this bar to it. The bar moves into that action's connection (joining its other bars, if it has
  // any); a connection left with no bars goes.
  const sceneActions = useSceneActions();
  const actionList =
    scene && sceneActions?.key === `${scene.sheetId}:${scene.number}` ? sceneActions.list : null;
  const [picking, setPicking] = useState<string | null>(null);
  useEffect(() => {
    if (!picking) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest('[data-bar-picker], [data-bar-pick]')) setPicking(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPicking(null);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [picking]);
  const connectBar = (l: MediaLink, i: number, action: string) => {
    setPicking(null);
    if (action === l.action) return;
    const bar = barsOf(l)[i];
    if (!bar) return;
    updateMediaLinks((all) => {
      const next = all.flatMap((x) => {
        if (!sameLink(x, l)) return [x];
        const left = withBar(x, i, null);
        return barsOf(left).length ? [left] : [];
      });
      const target = next.find(
        (x) => x.assetId === l.assetId && x.action === action && x.sheetId === l.sheetId && x.sceneNumber === l.sceneNumber,
      );
      if (target)
        return next.map((x) =>
          x === target ? (x.bar ? { ...x, copies: [...(x.copies ?? []), bar] } : { ...x, bar }) : x,
        );
      const made: MediaLink = {
        assetId: l.assetId,
        sheetId: l.sheetId,
        sceneNumber: l.sceneNumber,
        sceneName: l.sceneName,
        action,
        assetName: l.assetName,
        assetKind: l.assetKind,
        bar,
      };
      return [...next, { ...made, barsKind: timingOf(made).kind }];
    }, 'Connect bar');
  };

  // Option (Alt) held: the bars show they'll be duplicated when dragged.
  const [optionHeld, setOptionHeld] = useState(false);
  useEffect(() => {
    const watch = (e: KeyboardEvent) => setOptionHeld(e.altKey);
    const clear = () => setOptionHeld(false);
    window.addEventListener('keydown', watch);
    window.addEventListener('keyup', watch);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', watch);
      window.removeEventListener('keyup', watch);
      window.removeEventListener('blur', clear);
    };
  }, []);
  const current = stages[index];
  const runs = branchRuns(stages);

  // A moment's notice of an undo or redo (⌘Z, ⌘⇧Z / ⌘X): what it did.
  const historyNote = useHistoryNote();
  const [noteShown, setNoteShown] = useState<number | null>(null);
  useEffect(() => {
    if (!historyNote) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a timed notice for an outside change
    setNoteShown(historyNote.at);
    const timer = setTimeout(() => setNoteShown(null), 2500);
    return () => clearTimeout(timer);
  }, [historyNote]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-tour="timeline">
      {/* One line: the scene on the left; on the right the stage the playhead is on, then ◀ ▶ —
          kept low, so the tracks get the room. */}
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-display text-lg leading-tight text-ink" title={sceneTitle}>
          Timeline <span className="font-body text-sm text-muted-ink">· {sceneTitle}</span>
        </p>
        {current && (
          <div className="flex min-w-0 shrink items-center gap-1">
            {historyNote && noteShown === historyNote.at && (
              <span
                role="status"
                className="mr-2 bg-ink px-2 py-1 font-label text-[10px] uppercase tracking-widest text-paper"
              >
                {historyNote.did} · {historyNote.label}
              </span>
            )}
            <p
              className="mr-1 min-w-0 truncate font-body text-sm text-ink"
              aria-live="polite"
              title={`Stage ${current.code} · ${current.name}`}
            >
              Stage {current.code}
              <span className="text-muted-ink"> · {current.name}</span>
            </p>
            <button
              data-tour="timeline-prev"
              onClick={() => moveTo((i) => i - 1)}
              disabled={index === 0}
              aria-label="Previous stage"
              className={`h-4 w-8 shrink-0 text-[9px] leading-none ${buttonIcon}`}
            >
              ◀
            </button>
            <button
              data-tour="timeline-next"
              onClick={() => moveTo((i) => i + 1)}
              disabled={index === count - 1}
              aria-label="Next stage"
              className={`h-4 w-8 shrink-0 text-[9px] leading-none ${buttonIcon}`}
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
        <div className="grid min-h-0 flex-1 grid-cols-[34px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-y-auto overflow-x-hidden">
          <div aria-hidden="true" />

          {/* The ruler: each stage's code, with alternative branches bracketed, and the playhead's handle. */}
          <div
            ref={ruler}
            data-tour="timeline-ruler"
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
            className="relative h-14 cursor-ew-resize touch-none select-none outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
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
            <div className="absolute bottom-0 h-[36px] bg-ink" style={{ left: at(index), width }} />
            {/* Each stage: its code, and its name beneath (cut short with … when narrow; the tooltip has it all). */}
            {stages.map((s, i) => (
              <span
                key={s.code}
                className={`absolute bottom-[5px] flex flex-col items-center gap-[3px] px-1 text-center leading-none ${
                  i === index ? 'text-paper' : 'text-ink'
                }`}
                style={{ left: at(i), width }}
                title={`Stage ${s.code} · ${s.name}${s.goal?.trim() ? `\n${s.goal.trim()}` : ''}`}
              >
                <span className="font-label text-[11px]">{s.code}</span>
                <span
                  className={`w-full truncate font-label text-[9px] uppercase tracking-wide ${
                    i === index ? 'text-paper/80' : 'text-muted-ink'
                  }`}
                >
                  {s.name}
                </span>
              </span>
            ))}
            <div className="absolute inset-x-0 bottom-0 h-px bg-ink" />
            {Array.from({ length: count + 1 }, (_, i) => (
              <div key={i} className="absolute bottom-0 h-[12px] w-px bg-ink" style={{ left: at(i) }} />
            ))}
          </div>

          {/* Track numbers, and the sound tracks (the first one's arrow opens and closes the rest). */}
          <div className="grid" style={rows}>
            {trackRows.map((t) =>
              t === 'sound' ? (
                <button
                  key={t}
                  data-tour="timeline-sound"
                  onClick={toggleSounds}
                  aria-expanded={soundsOpen}
                  title={
                    soundsOpen ? 'Close the sound tracks into one' : 'Open more sound tracks, for sounds that overlap'
                  }
                  className="flex items-center justify-between font-body text-[11px] text-[#3c5eac] hover:text-ink"
                >
                  ♪<OpenArrow open={soundsOpen} />
                </button>
              ) : typeof t === 'number' ? (
                // A projection area: its number, and an arrow that opens it into MAX_AREA_TRACKS tracks.
                <button
                  key={t}
                  data-tour={`timeline-area-${t}`}
                  onClick={() => toggleArea(t)}
                  aria-expanded={areasOpen.includes(t)}
                  title={
                    areasOpen.includes(t)
                      ? `Close projection area ${t}'s tracks into one`
                      : `Projection area ${t} — open ${MAX_AREA_TRACKS} tracks for it`
                  }
                  className="flex items-center justify-between font-body text-[11px] text-ink hover:text-[#3c5eac]"
                >
                  {t}
                  <OpenArrow open={areasOpen.includes(t)} />
                </button>
              ) : (
                <span
                  key={t}
                  className={`flex items-center font-body text-[11px] ${isSoundTrack(t) ? 'text-[#3c5eac]' : 'pl-1 text-[9px] text-muted-ink'}`}
                  title={
                    isSoundTrack(t)
                      ? `Sound track ${laneOf(t)}`
                      : `Projection area ${areaOfTrack(t)}, track ${laneOf(t)}`
                  }
                >
                  {isSoundTrack(t) ? `♪${laneOf(t)}` : `${areaOfTrack(t)}.${laneOf(t)}`}
                </span>
              ),
            )}
          </div>

          {/* The tracks, and the playhead through them. */}
          <div
            ref={tracksBox}
            className="relative grid"
            style={rows}
            data-tour="timeline-tracks"
            onDragOver={dragOver}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHere(null);
            }}
            onDrop={drop}
          >
            {/* Where a dragged Media Library item would land: green on a row that takes it, red if not. */}
            {dropHere && (
              <div
                className={`pointer-events-none absolute z-30 border-2 ${dropHere.ok ? 'border-[#15803d] bg-[#15803d]/20' : 'border-[#b91c1c] bg-[#b91c1c]/10'}`}
                style={{
                  left: at(dropHere.stage),
                  width,
                  top: `${(rowOf(dropHere.track) / trackRows.length) * 100}%`,
                  height: `${100 / trackRows.length}%`,
                }}
                aria-hidden="true"
              />
            )}
            <div
              className="pointer-events-none absolute inset-y-0 bg-ink/10"
              style={{ left: at(index), width }}
              aria-hidden="true"
            />
            {trackRows.map((t) => (
              <div
                key={t}
                className="relative"
                aria-label={
                  isSoundTrack(t)
                    ? `Sound track ${laneOf(t)}`
                    : typeof t === 'number'
                      ? `Track ${t}`
                      : `Track ${areaOfTrack(t)}.${laneOf(t)}`
                }
              >
                {Array.from({ length: count + 1 }, (_, i) => (
                  <div key={i} className="absolute inset-y-0 w-px bg-ink/15" style={{ left: at(i) }} />
                ))}
                <div
                  className={`absolute inset-x-0 bottom-[2.5px] top-[2.5px] border border-dashed ${isSoundTrack(t) ? 'border-[#3c5eac]/60 bg-[#3c5eac]/15' : 'border-ink/50'}`}
                />
              </div>
            ))}
            {/* The bars, on one layer over the tracks — so a bar dragged to another track stays the same element. */}
            {mine.flatMap((l) =>
              barsOf(l).map((bar, i) => {
                const key = barKey(l, i);
                const dragging = drag?.key === key ? drag : null;
                const here = { track: bar.track, ...span(bar) };
                // Duplicating: the bar stays where it is, and a copy follows the pointer.
                const place = dragging && !dragging.copy ? dragging.now : here;
                const every = timingOf(l).kind === 'every';
                // "Loop, when user instructs" (video, sound): ∞ on its bar, as ↻ marks "every time".
                const loops = timingOf(l).kind === 'once' && !isStill(l.assetKind) && loopOf(l);
                const stagesText = (p: { from: number; to: number }) =>
                  p.from === p.to
                    ? `stage ${stages[p.from].code}`
                    : `stages ${stages[p.from].code}–${stages[p.to].code}`;
                const box = (p: { track: Track; from: number; to: number }): CSSProperties => ({
                  left: `calc(${at(p.from)} + 2px)`,
                  width: `calc(${at(p.to + 1)} - ${at(p.from)} - 4px)`,
                  // Nearly the whole row: about 5px between one track's bars and the next.
                  top: `calc(${(rowOf(p.track) / trackRows.length) * 100}% + 2.5px)`,
                  height: `calc(${100 / trackRows.length}% - 5px)`,
                });
                const label = (
                  <span className="min-w-0 flex-1 truncate px-1 font-body text-[15px] leading-none">
                    {isMarker(l) ? (
                      <>
                        {/* Plays whenever the marker is on this bar's stages. */}▶ {MARKER_LABEL}
                        {l.assetName ? ` · ${l.assetName}` : ''}
                      </>
                    ) : isConnected(l) ? (
                      <>
                        {every ? '↻ ' : loops ? '∞ ' : ''}
                        {l.action}
                      </>
                    ) : (
                      // Dropped from the Media Library, no action yet: it doesn't play until its ▼ picks one.
                      <span className="italic">{l.assetName ?? l.assetId} · pick an action ▼</span>
                    )}
                  </span>
                );
                const handle = (end: 'from' | 'to') => (
                  <span
                    data-bar-end={end}
                    onPointerDown={(e) => grab(e, l, i, end)}
                    onPointerMove={(e) => {
                      e.stopPropagation();
                      follow(e, l, i);
                    }}
                    onPointerUp={(e) => {
                      e.stopPropagation();
                      letGo(l, i);
                    }}
                    className={`h-full w-2 shrink-0 cursor-ew-resize bg-ink/20 ${end === 'from' ? 'border-r' : 'border-l'} border-paper/50`}
                    aria-hidden="true"
                  />
                );
                return [
                  <div
                    key={key}
                    data-bar={l.action}
                    data-bar-index={i}
                    data-bar-track={bar.track}
                    onPointerDown={(e) => grab(e, l, i, 'move')}
                    onPointerMove={(e) => follow(e, l, i)}
                    onPointerUp={() => letGo(l, i)}
                    onPointerCancel={() => setDrag(null)}
                    title={`${l.action || 'Not connected to an action yet'}\n${l.assetId}${l.assetName ? ` ${l.assetName}` : ''} · ${stagesText(place)} — drag to move, drag an end to stretch, Option-drag to duplicate, ▼ to connect it to an action`}
                    className={`absolute z-10 flex touch-none select-none items-center overflow-hidden border border-[#3c5eac] text-paper shadow-sm ${
                      isConnected(l) ? 'bg-[#3c5eac]' : 'border-dashed border-paper/80 bg-[#3c5eac]/60'
                    } ${
                      optionHeld ? 'cursor-copy' : 'cursor-grab active:cursor-grabbing'
                    } ${dragging && !dragging.copy ? 'opacity-80 ring-2 ring-ink' : ''}`}
                    style={box(place)}
                  >
                    {handle('from')}
                    {label}
                    <button
                      // Not a drag: pressing it mustn't pick the bar up.
                      onPointerDown={(e) => e.stopPropagation()}
                      data-bar-pick
                      onClick={(e) => {
                        e.stopPropagation();
                        setPicking(picking === key ? null : key);
                      }}
                      aria-expanded={picking === key}
                      aria-label={`Connect this bar to an action (${l.action || 'not connected'})`}
                      title="Connect this bar to one of the scene's actions"
                      className={`flex h-full w-6 shrink-0 cursor-pointer items-center justify-center hover:bg-ink/30 ${picking === key ? 'bg-ink/40' : ''}`}
                    >
                      <DropdownArrow open={picking === key} className="text-paper" />
                    </button>
                    <button
                      // Not a drag: pressing it mustn't pick the bar up.
                      onPointerDown={(e) => e.stopPropagation()}
                      data-bar-delete
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(l, i);
                      }}
                      aria-label={`Delete this bar (${l.action})`}
                      title={
                        barsOf(l).length > 1
                          ? 'Delete this bar'
                          : 'Delete this bar — its file is disconnected from the action (connect it again in the Media Library)'
                      }
                      className="flex h-full w-6 shrink-0 cursor-pointer items-center justify-center font-body text-base leading-none text-paper/80 hover:bg-ink/30 hover:text-paper"
                    >
                      ×
                    </button>
                    {handle('to')}
                  </div>,
                  picking === key && (
                    // The scene's actions, under the bar (above it, for a bar low on the timeline).
                    <div
                      key={`${key}-pick`}
                      data-bar-picker
                      role="listbox"
                      aria-label="Connect this bar to an action"
                      className="absolute z-40 max-h-96 w-[min(340px,100%)] overflow-y-auto border-2 border-ink bg-paper font-body text-xs text-ink shadow-lg"
                      style={{
                        left: `calc(${at(place.from)} + 2px)`,
                        ...(rowOf(place.track) < trackRows.length / 2
                          ? { top: `${((rowOf(place.track) + 1) / trackRows.length) * 100}%` }
                          : { bottom: `${100 - (rowOf(place.track) / trackRows.length) * 100}%` }),
                      }}
                    >
                      <p className="border-b border-hair px-2 py-1 font-label text-[9px] uppercase tracking-wide text-muted-ink">
                        Connect {l.assetName ?? l.assetId} to
                      </p>
                      <button
                        role="option"
                        aria-selected={isMarker(l)}
                        onClick={() => connectBar(l, i, MARKER_ACTION)}
                        className="flex w-full items-start gap-1.5 border-b border-hair px-2 py-1.5 text-left hover:bg-ink/10"
                        title="Plays whenever the timeline's marker is on this bar's stages"
                      >
                        <span className="w-3 shrink-0 font-label">{isMarker(l) ? '✓' : ''}</span>
                        <span className="min-w-0 flex-1 font-medium">▶ Play on marker arrival</span>
                      </button>
                      {!actionList ? (
                        <p className="p-2 italic text-muted-ink">
                          Open the Media Library (Adding Immersive Media → 2) to read this scene&rsquo;s actions from the
                          sheet.
                        </p>
                      ) : actionList.length === 0 ? (
                        <p className="p-2 italic text-muted-ink">
                          This scene has no media actions yet — write them in row 8 of the sheet.
                        </p>
                      ) : (
                        actionList.map((a) => (
                          <button
                            key={a}
                            role="option"
                            aria-selected={a === l.action}
                            onClick={() => connectBar(l, i, a)}
                            className="flex w-full items-start gap-1.5 px-2 py-1.5 text-left hover:bg-ink/10"
                          >
                            <span className="w-3 shrink-0 font-label">{a === l.action ? '✓' : ''}</span>
                            <span className="min-w-0 flex-1">{a}</span>
                          </button>
                        ))
                      )}
                      {isConnected(l) && <BarPlays link={l} />}
                    </div>
                  ),
                  dragging?.copy && (
                    <div
                      key={`${key}-copy`}
                      className="pointer-events-none absolute z-20 flex items-center overflow-hidden border-2 border-dashed border-ink bg-[#3c5eac]/70 text-paper"
                      style={box(dragging.now)}
                      aria-hidden="true"
                    >
                      <span className="shrink-0 pl-1 font-body text-[15px] leading-none">+</span>
                      {label}
                    </div>
                  ),
                ];
              }),
            )}
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

/**
 * A track header's open/close arrow: ▶ closed, ▼ open. Every arrow sits at the
 * right of the 34px number column, and both shapes put their tip at x = 8 of
 * the same 18px box, so the tips of the whole column line up on one pixel line
 * with 10px of white space after them.
 */
function OpenArrow({ open }: { open: boolean }) {
  return (
    <svg width="18" height="10" viewBox="0 0 18 10" aria-hidden className="shrink-0 fill-current">
      <polygon points={open ? '4,2 12,2 8,9' : '1,0 8,5 1,10'} />
    </svg>
  );
}

/**
 * A bar's "When it plays" (under its ▼ list): the same choices as its connection in the Media Library —
 * when it fires, and for "every time" which moment and what the voice does; for "on marker arrival",
 * whether a video or sound loops. Each change is one undo step, and the bars follow it.
 */
function BarPlays({ link }: { link: MediaLink }) {
  const timing = timingOf(link);
  const still = isStill(link.assetKind);
  const label = 'font-label text-[9px] uppercase tracking-wide text-muted-ink';
  const select = 'border border-ink bg-paper px-1.5 py-1 font-body text-xs text-ink';
  const change = (update: (l: MediaLink) => MediaLink) =>
    updateMediaLinks((all) => all.map((x) => (sameLink(x, link) ? update(x) : x)), `Change when ${link.assetId} plays`);
  if (isMarker(link)) {
    return still ? null : (
      <div className="flex flex-col gap-1 border-t border-hair px-2 py-1.5">
        <p className={label}>When it plays</p>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={loopOf(link)} onChange={(e) => change((l) => ({ ...l, loop: e.target.checked }))} />
          Loop while the marker is on its bar
        </label>
      </div>
    );
  }
  const loopsWhen = timing.kind === 'once' && !still && loopOf(link);
  return (
    <div className="flex flex-col gap-1.5 border-t border-hair px-2 py-1.5">
      <p className={label}>When it plays</p>
      <select
        value={loopsWhen ? 'once-loop' : timing.kind}
        onChange={(e) => {
          const v = e.target.value;
          const kind = (v === 'once-loop' ? 'once' : v) as ActionKind;
          const loop = v === 'once-loop' ? true : v === 'once' ? false : undefined;
          change((l) => ({ ...l, timing: { ...l.timing, kind }, loop }));
        }}
        aria-label="When it plays"
        title={`Plays ${KIND_HELP[timing.kind]}`}
        className={select}
      >
        {ACTION_KINDS.flatMap((k) => [
          <option key={k} value={k}>
            {KIND_BADGE[k]}
          </option>,
          // A picture, text or colour just stays up: only video and sound can loop.
          k === 'once' && !still && (
            <option key="once-loop" value="once-loop">
              {LOOP_WHEN_BADGE}
            </option>
          ),
        ])}
      </select>
      {timing.kind === 'every' && (
        <>
          <select
            value={timing.when}
            onChange={(e) => change((l) => ({ ...l, timing: { ...l.timing, when: e.target.value as EveryWhen } }))}
            aria-label="Each time what happens"
            className={select}
          >
            {(Object.keys(WHEN_LABEL) as EveryWhen[]).map((w) => (
              <option key={w} value={w}>
                {WHEN_LABEL[w]}
              </option>
            ))}
          </select>
          {timing.when === 'before-reply' && (
            <span className="flex flex-wrap items-center gap-1.5">
              <select
                value={timing.voice}
                onChange={(e) => change((l) => ({ ...l, timing: { ...l.timing, voice: e.target.value as VoiceWait } }))}
                aria-label="What the voice does"
                className={select}
              >
                {(Object.keys(VOICE_LABEL) as VoiceWait[]).map((v) => (
                  <option key={v} value={v}>
                    {VOICE_LABEL[v]}
                  </option>
                ))}
              </select>
              {timing.voice === 'delay' && (
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="number"
                    min={0}
                    max={30}
                    step={0.5}
                    value={timing.delay}
                    onChange={(e) =>
                      change((l) => ({ ...l, timing: { ...l.timing, delay: Math.max(0, Number(e.target.value) || 0) } }))
                    }
                    aria-label="Seconds the voice waits"
                    className="w-14 border border-ink bg-paper px-1 py-0.5"
                  />
                  s
                </label>
              )}
            </span>
          )}
        </>
      )}
    </div>
  );
}
