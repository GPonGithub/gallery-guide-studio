'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { buttonIcon } from '@/lib/styles';
import { DropdownArrow } from './DropdownArrow';
import { markerArrived, markerIsAt, setMarkerProblem, useMarkerProblem } from '@/lib/agent/markerPlay';
import { samePlace, setPlacing, usePlacing } from '@/lib/agent/roomPlacement';
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
  type MediaAsset,
  type VoiceWait,
} from '@/lib/agent/media';
import { useMediaFolderRevision } from '@/lib/agent/mediaDemo';
import { clampSoundVolume, MAX_SOUND_VOLUME, setSoundLoop, setSoundVolume, stopSounds } from '@/lib/agent/mediaPlayback';
import { hideVisualExcept } from '@/lib/agent/mediaShow';
import { ALL_AREAS, areaName, areaNumber, ZONES, zoneById, zoneOfArea, type ZoneId } from '@/lib/agent/projectionLayout';
import { toggleZoneOpen, useZonesOpen } from '@/lib/agent/zones';
import { pickSpatialSound } from '@/lib/agent/spatialAudio';
import { audible, checkVideoSound, useVideoSoundResults } from '@/lib/agent/videoSound';
import {
  areaOfTrack,
  barsOf,
  FADE_SECONDS,
  MAX_FADE_SECONDS,
  fadeInSeconds,
  fadeOutSeconds,
  fadeValue,
  fadesIn,
  fadesOut,
  loadLibrary,
  loadThumbnail,
  mediaSceneKey,
  loopOf,
  openMediaFile,
  savedMediaFolder,
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
  type MediaFolder,
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

export const TRACKS = ALL_AREAS.length;
/**
 * Sound tracks: the ♪ row opens (its arrow) into up to this many, so sounds
 * that overlap in time each get a row. (Chrome could play far more at once —
 * about 75 media players a page — but five keeps the mix clear.)
 */
export const MAX_SOUND_TRACKS = 5;
/** Each projection area's number opens (its arrow) into this many tracks — several media for one screen. */
export const MAX_AREA_TRACKS = 5;
/**
 * The tracks, top to bottom: each zone's heading (Z1, Z2, Z3 — its arrow folds the zone's areas open and
 * closed), under it that zone's projection areas (each perhaps opened into more), then that zone's sound
 * tracks (one ♪ row, which opens into MAX_SOUND_TRACKS).
 */
type Track = TimelineBar['track'];
/** A row of the timeline: a track, or a zone's heading. */
type Row = Track | `zone-${ZoneId}`;
const zoneRow = (zone: ZoneId): Row => `zone-${zone}`;
const zoneOfRow = (r: Row): ZoneId | null => (typeof r === 'string' && r.startsWith('zone-') ? (Number(r.slice(5)) as ZoneId) : null);
const isTrack = (r: Row): r is Track => zoneOfRow(r) === null;
const areaTrack = (area: number, k: number): Track => (k <= 1 ? area : `${area}-${k}`);
/** An area's extra tracks (5-2 … 5-5). */
const extraTracks = (area: number): Track[] =>
  Array.from({ length: MAX_AREA_TRACKS - 1 }, (_, i) => areaTrack(area, i + 2));
/**
 * A zone's nth sound track. Zone 2's are 'sound', 'sound-2' … 'sound-5', as they were before zones;
 * zone 1's are 'sound-11' … 'sound-15' and zone 3's 'sound-31' … 'sound-35' (the zone, then the track).
 * Every sound plays on the same room speakers whichever zone's track it's on.
 */
const soundTrack = (n: number, zone: ZoneId = 2): Track =>
  zone === 2 ? (n <= 1 ? 'sound' : `sound-${n}`) : `sound-${zone * 10 + n}`;
const isSoundTrack = (t: Row) => typeof t === 'string' && t.startsWith('sound');
const soundNumber = (t: Row) => (t === 'sound' ? 1 : Number(/(\d+)$/.exec(String(t))?.[1] ?? 1) || 1);
/** The zone a sound track belongs to. */
const zoneOfSound = (t: Row): ZoneId => {
  const zone = Math.floor(soundNumber(t) / 10);
  return zone === 1 || zone === 3 ? zone : 2;
};
const zoneSounds = (zone: ZoneId): Track[] => Array.from({ length: MAX_SOUND_TRACKS }, (_, i) => soundTrack(i + 1, zone));
/** A track's number within its group: an area's 1–5, or a sound track's 1–5. */
const laneOf = (t: Track) =>
  typeof t === 'number' || t === 'sound'
    ? 1
    : isSoundTrack(t)
      ? soundNumber(t) % 10 || 1
      : Number(/(\d+)$/.exec(t)?.[1] ?? 1) || 1;
/** Where new sounds go: zone 2's sound tracks (drag one to another zone's to keep it with that zone). */
const SOUND_TRACKS: Track[] = zoneSounds(2);
/** Where new pictures and video go: the areas' own tracks first (zone 2's, then zones 1 and 3), then their extra ones. */
const PLACE_AREAS = [...zoneById(2).areas, ...ALL_AREAS.filter((a) => zoneOfArea(a).id !== 2)];
const PLACE_TRACKS: Track[] = [...PLACE_AREAS, ...PLACE_AREAS.flatMap((a) => extraTracks(a))];
/** A timeline row's height (px): fixed, so folding zones open and closed never fattens or thins the bars. */
const ROW_HEIGHT = 52;
const SOUNDS_OPEN_KEY = 'timeline-sounds-open';
const ZONE_SOUNDS_OPEN_KEY = 'timeline-zone-sounds-open';
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
  const [localProblem, setSoundProblem] = useState<string | null>(null);
  // A marker sound that couldn't play — from a click here, or from a call starting / moving on.
  const sharedProblem = useMarkerProblem();
  const soundProblem = localProblem ?? sharedProblem;
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
  useEffect(() => markerIsAt(scene, stages, headCode), [scene, stages, headCode]);
  // A scene opening (or its stages arriving): its pictures, video and colours on the marker's stage go up
  // in the room straight away, not only once the marker is moved (no sounds — they wait for the call).
  const stagesKey = stages.map((s) => s.code).join(' ');
  useEffect(() => {
    if (headCode) void markerArrived(scene, stages, headCode, { visualsOnly: true });
    // Only when another scene (or a different set of stages) is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey, stagesKey]);
  useEffect(() => {
    if (!movedByHand.current) return;
    movedByHand.current = false;
    setSoundProblem(null);
    setMarkerProblem(null);
    // A click moved it: the browser may ask to read the media folder (it forgets after a reload), and a
    // sound that can't play says why.
    void markerArrived(scene, stages, headCode, { ask: true, onProblem: setSoundProblem });
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

  // The library's items and the media folder, for each bar's thumbnail — read again when the bars'
  // items change, or the tour swaps the folder (see mediaDemo.ts).
  const folderRevision = useMediaFolderRevision();
  const barItems = mine.map((l) => l.assetId).join('|');
  const [folder, setFolder] = useState<MediaFolder | null>(null);
  const [assets, setAssets] = useState<Map<string, MediaAsset>>(() => new Map());
  // This scene's own folder and library (every scene has its own — see mediaFolder.ts).
  const mediaKey = scene ? mediaSceneKey(scene) : null;
  useEffect(() => {
    let gone = false;
    void savedMediaFolder(mediaKey).then((f) => !gone && setFolder(f));
    void loadLibrary(mediaKey).then((lib) => !gone && setAssets(new Map((lib?.assets ?? []).map((a) => [a.id, a]))));
    return () => {
      gone = true;
    };
  }, [folderRevision, barItems, mediaKey]);
  // Videos with a sound track get a volume slider and open Spatialized Audio, as sounds do: find out which.
  useVideoSoundResults();
  useEffect(() => {
    for (const a of assets.values()) if (a.kind === 'video' && a.status === 'present') checkVideoSound(a, folder);
  }, [assets, folder]);

  // The sound tracks: each zone has one ♪ row, which its arrow opens into all MAX_SOUND_TRACKS
  // (remembered, zone by zone). Closed, the zone's sounds all show on the one row. They're tinted light
  // blue, for audio.
  const [soundsOpen, setSoundsOpen] = useState<ZoneId[]>([]);
  useEffect(() => {
    try {
      const kept = JSON.parse(window.localStorage.getItem(ZONE_SOUNDS_OPEN_KEY) ?? 'null') as unknown;
      // Before zones there was one ♪ row (now zone 2's): open if it was left open.
      const open = Array.isArray(kept)
        ? kept.filter((z): z is ZoneId => ZONES.some((zone) => zone.id === z))
        : window.localStorage.getItem(SOUNDS_OPEN_KEY) === 'true'
          ? [2 as ZoneId]
          : [];
      // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only: localStorage doesn't exist during SSR
      setSoundsOpen(open);
    } catch {
      // Storage blocked: closed.
    }
  }, []);
  const toggleSounds = (zone: ZoneId) => {
    setSoundsOpen((open) => {
      const next = open.includes(zone) ? open.filter((z) => z !== zone) : [...open, zone];
      try {
        window.localStorage.setItem(ZONE_SOUNDS_OPEN_KEY, JSON.stringify(next));
      } catch {
        // Not remembered.
      }
      return next;
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
  /** A zone's sound rows showing: its ♪ row, or all its sound tracks. */
  const zoneSoundRows = (zone: ZoneId): Track[] => zoneSounds(zone).slice(0, soundsOpen.includes(zone) ? MAX_SOUND_TRACKS : 1);
  // Each zone's heading folds its areas open and closed, on its own (remembered; see zones.ts).
  const zonesOpen = useZonesOpen();
  const areaRows = (a: number): Track[] => (areasOpen.includes(a) ? [a, ...extraTracks(a)] : [a]);
  /** The projection tracks showing: the open zones' areas (a bar is dragged among these). */
  const projectionRows: Track[] = ZONES.flatMap((z) => (zonesOpen.includes(z.id) ? z.areas.flatMap(areaRows) : []));
  /** The sound tracks showing: the open zones' (a sound's bar is dragged among these). */
  const soundRows: Track[] = ZONES.flatMap((z) => (zonesOpen.includes(z.id) ? zoneSoundRows(z.id) : []));
  // Each zone: its heading, then (folded open) its areas and its own sound tracks.
  const trackRows: Row[] = ZONES.flatMap((z): Row[] => [
    zoneRow(z.id),
    ...(zonesOpen.includes(z.id) ? [...z.areas.flatMap(areaRows), ...zoneSoundRows(z.id)] : []),
  ]);
  /**
   * The row a track shows on: its own, or — its group closed — its area's (or its zone's ♪) row; its
   * zone folded shut: the zone's heading.
   */
  const visibleTrack = (t: Track): Row => {
    if (trackRows.includes(t)) return t;
    if (isSoundTrack(t)) {
      const zone = zoneOfSound(t);
      return zonesOpen.includes(zone) ? soundTrack(1, zone) : zoneRow(zone);
    }
    const area = areaOfTrack(t) ?? 1;
    return trackRows.includes(area) ? area : zoneRow(zoneOfArea(area).id);
  };
  const rowOf = (t: Track) => trackRows.indexOf(visibleTrack(t));
  /** A sound in a zone folded shut: not drawn (the zone's heading shows only its pictures and video). */
  const foldedAway = (t: Track) => isSoundTrack(t) && !isTrack(visibleTrack(t));
  // Every row the same height however many are folded open: more than fit, and the tracks scroll
  // (wheel or the bar at the side) under the ruler, which stays put.
  const rows: CSSProperties = { gridTemplateRows: `repeat(${trackRows.length}, ${ROW_HEIGHT}px)` };
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
  // A fade grip being dragged (a bar's end slid in by notches: one second each).
  const [fadeDrag, setFadeDrag] = useState<{ key: string; end: 'from' | 'to'; x: number; start: number; now: number } | null>(
    null,
  );
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
      const shown = visibleTrack(track);
      const pos = isTrack(shown) ? group.indexOf(shown) : -1;
      // Its zone folded shut: it keeps its track (it only moves along the stages).
      if (pos >= 0) track = group[Math.min(group.length - 1, Math.max(0, pos + rowsMoved))];
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
    const original = barsOf(l)[i];
    // A bar keeps everything it carries (a picture's placement on the room drawing above all) — only
    // its track and stages change.
    const placed: Bar = { ...original, track: now.track, from: stages[now.from].code, to: stages[now.to].code };
    // Let go where it started: nothing changed (and a duplicate dropped there isn't one).
    const moved = now.track !== start.track || now.from !== start.from || now.to !== start.to;
    // A sound's bar clicked (not moved): Spatialized Audio opens on it.
    // (A video with a sound track too: its sound is placed in the room the same way.)
    if (!moved && drag.mode === 'move' && !copy && audible(l)) pickSpatialSound(l);
    // An end clicked (not dragged): its fade in (left) or fade out (right) turns on or off.
    if (!moved && drag.mode !== 'move' && original) {
      const which = drag.mode === 'from' ? 'fadeIn' : 'fadeOut';
      const on = !(which === 'fadeIn' ? fadesIn(original) : fadesOut(original));
      updateMediaLinks(
        (all) => all.map((x) => (sameLink(x, l) ? withBar(x, i, { ...original, [which]: on }) : x)),
        `${on ? 'Add' : 'Remove'} fade ${drag.mode === 'from' ? 'in' : 'out'}`,
      );
      return;
    }
    if (!moved) return;
    // A picture placed on the room drawing is one picture on several areas: moving it to other stages
    // (or stretching it) takes all its bars along, so it stays one picture. Moved to another track, just
    // that bar goes (still placed: that area shows its own slice).
    const group =
      !copy && original?.place && now.track === start.track
        ? barsOf(l).filter(
            (b) => b.place && b.from === original.from && b.to === original.to && JSON.stringify(b.place) === JSON.stringify(original.place),
          )
        : [];
    updateMediaLinks(
      (all) =>
        all.map((x) => {
          if (!sameLink(x, l)) return x;
          if (copy) return { ...x, copies: [...(x.copies ?? []), placed] };
          if (group.length > 1) {
            const [bar, ...copies] = barsOf(x).map((b) =>
              group.includes(b) ? { ...b, from: placed.from, to: placed.to } : b,
            );
            return { ...x, bar, copies };
          }
          return withBar(x, i, placed);
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
    const track = trackRows[row];
    // A zone's heading takes nothing: open the zone and drop on one of its areas.
    return isTrack(track) ? { stage, track } : null;
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
  /** A dropped item: a bar at that stage and row (a picture, video, colour or character plays on marker arrival; a sound waits for its ▼). */
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
    // A picture, video, colour or character dropped on an area's row plays on marker arrival straight away
    // (as when it's dropped on the room drawing), so it shows in the room the moment it lands on the
    // marker's stage; its ▼ can still connect it to one of the scene's actions instead. A sound waits
    // to be connected, as before.
    const action = item.kind === 'sound' ? '' : MARKER_ACTION;
    updateMediaLinks((all) => {
      const unplaced = all.find((l) => ours(l) && l.assetId === item.id && l.action === action);
      if (unplaced)
        return all.map((l) =>
          l === unplaced ? (l.bar ? { ...l, copies: [...(l.copies ?? []), bar] } : { ...l, bar }) : l,
        );
      const link: MediaLink = {
        assetId: item.id,
        sheetId: scene.sheetId,
        sceneNumber: scene.number,
        sceneName: sceneTitle.replace(/^Scene\s+\S+\s+·\s+/, ''),
        action,
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
  const placing = usePlacing();
  const connectBar = (l: MediaLink, i: number, action: string) => {
    setPicking(null);
    if (action === l.action) return;
    const bar = barsOf(l)[i];
    if (!bar) return;
    // A picture placed on the room drawing is one picture on several areas: all its bars (those
    // stages, the same placement) connect together, so it stays one picture. Other copies stay.
    const moving = barsOf(l).filter((b) =>
      bar.place ? b.place && b.from === bar.from && b.to === bar.to && samePlace(b.place, bar.place) : b === bar,
    );
    updateMediaLinks((all) => {
      const next = all.flatMap((x) => {
        if (!sameLink(x, l)) return [x];
        const left = barsOf(x).filter((b) => !moving.includes(b));
        if (!left.length) return [];
        const [first, ...copies] = left;
        return [{ ...x, bar: first, copies }];
      });
      const target = next.find(
        (x) => x.assetId === l.assetId && x.action === action && x.sheetId === l.sheetId && x.sceneNumber === l.sceneNumber,
      );
      if (target)
        return next.map((x) => {
          if (x !== target) return x;
          const [first, ...copies] = [...barsOf(x), ...moving];
          return { ...x, bar: first, copies };
        });
      const [first, ...copies] = moving;
      const made: MediaLink = {
        assetId: l.assetId,
        sheetId: l.sheetId,
        sceneNumber: l.sceneNumber,
        sceneName: l.sceneName,
        action,
        assetName: l.assetName,
        assetKind: l.assetKind,
        bar: first,
        ...(copies.length && { copies }),
      };
      return [...next, { ...made, barsKind: timingOf(made).kind }];
    }, 'Connect bar');
    // Still placing that picture on the room drawing: it's the same picture, now with its action.
    if (
      placing &&
      bar.place &&
      placing.assetId === l.assetId &&
      placing.action === l.action &&
      placing.from === bar.from &&
      placing.to === bar.to &&
      (placing.area === undefined || moving.some((b) => areaOfTrack(b.track) === placing.area))
    )
      setPlacing({ ...placing, action });
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
            {soundProblem && (
              <button
                role="alert"
                onClick={() => {
                  setSoundProblem(null);
                  setMarkerProblem(null);
                }}
                title={`${soundProblem} (click to hide)`}
                className="mr-2 max-w-[320px] truncate border-l-4 border-[#b91c1c] bg-paper px-2 py-1 text-left font-body text-xs text-ink"
              >
                {soundProblem}
              </button>
            )}
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
        <div className="grid min-h-0 flex-1 grid-cols-[34px_minmax(0,1fr)] grid-rows-[auto_auto] content-start overflow-y-auto overflow-x-hidden">
          <div aria-hidden="true" className="sticky top-0 z-50 bg-paper" />

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
            className="sticky top-0 z-50 h-14 cursor-ew-resize touch-none select-none bg-paper outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
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
              !isTrack(t) ? (
                // A zone's heading: its arrow folds the zone's areas open and closed.
                <button
                  key={t}
                  data-tour={`timeline-${t}`}
                  onClick={() => toggleZoneOpen(zoneOfRow(t)!)}
                  aria-expanded={zonesOpen.includes(zoneOfRow(t)!)}
                  title={
                    zonesOpen.includes(zoneOfRow(t)!)
                      ? `Fold zone ${zoneOfRow(t)}'s ${zoneById(zoneOfRow(t)!).areas.length} areas away`
                      : `Zone ${zoneOfRow(t)} — open its ${zoneById(zoneOfRow(t)!).areas.length} projection areas`
                  }
                  className="flex items-center justify-between bg-ink px-0.5 font-label text-[10px] text-paper hover:bg-[#3c5eac]"
                >
                  Z{zoneOfRow(t)}
                  <OpenArrow open={zonesOpen.includes(zoneOfRow(t)!)} />
                </button>
              ) : isSoundTrack(t) && laneOf(t) === 1 ? (
                <button
                  key={t}
                  data-tour={t === 'sound' ? 'timeline-sound' : undefined}
                  onClick={() => toggleSounds(zoneOfSound(t))}
                  aria-expanded={soundsOpen.includes(zoneOfSound(t))}
                  title={
                    soundsOpen.includes(zoneOfSound(t))
                      ? `Close zone ${zoneOfSound(t)}'s sound tracks into one`
                      : `Zone ${zoneOfSound(t)}'s sound track — open more, for sounds that overlap`
                  }
                  className="flex items-center justify-between font-body text-[11px] text-[#15803d] hover:text-ink"
                >
                  ♪<OpenArrow open={soundsOpen.includes(zoneOfSound(t))} />
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
                      ? `Close ${areaName(t)}'s tracks into one`
                      : `${areaName(t)} — open ${MAX_AREA_TRACKS} tracks for it`
                  }
                  className="flex items-center justify-between font-body text-[11px] text-ink hover:text-[#3c5eac]"
                >
                  {areaNumber(t)}
                  <OpenArrow open={areasOpen.includes(t)} />
                </button>
              ) : (
                <span
                  key={t}
                  className={`flex items-center font-body text-[11px] ${isSoundTrack(t) ? 'text-[#15803d]' : 'pl-1 text-[9px] text-muted-ink'}`}
                  title={
                    isSoundTrack(t)
                      ? `Zone ${zoneOfSound(t)} sound track ${laneOf(t)}`
                      : `${areaName(areaOfTrack(t) ?? 1)}, track ${laneOf(t)}`
                  }
                >
                  {isSoundTrack(t) ? `♪${laneOf(t)}` : `${areaNumber(areaOfTrack(t) ?? 1)}.${laneOf(t)}`}
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
            {trackRows.map((t) =>
              !isTrack(t) ? (
                // A zone's heading: a band across the tracks (its bars show here while it's folded shut).
                <div key={t} className="relative bg-ink/10" aria-label={`Zone ${zoneOfRow(t)}`}>
                  <div className="absolute inset-x-0 top-0 h-px bg-ink/60" />
                </div>
              ) : (
              <div
                key={t}
                className="relative"
                aria-label={
                  isSoundTrack(t)
                    ? `Zone ${zoneOfSound(t)} sound track ${laneOf(t)}`
                    : typeof t === 'number'
                      ? `Track ${areaName(t)}`
                      : `Track ${areaName(areaOfTrack(t) ?? 1)}.${laneOf(t)}`
                }
              >
                {Array.from({ length: count + 1 }, (_, i) => (
                  <div key={i} className="absolute inset-y-0 w-px bg-ink/15" style={{ left: at(i) }} />
                ))}
                <div
                  className={`absolute inset-x-0 bottom-[2.5px] top-[2.5px] border border-dashed ${isSoundTrack(t) ? 'border-[#15803d]/60 bg-[#15803d]/15' : 'border-ink/50'}`}
                />
              </div>
              ),
            )}
            {/* The bars, on one layer over the tracks — so a bar dragged to another track stays the same element. */}
            {mine.flatMap((l) =>
              barsOf(l).map((bar, i) => {
                if (foldedAway(bar.track)) return null;
                // Where another bar shares this one's row (a closed area's five tracks, or the closed ♪ row),
                // the shared stages are striped — so the bars underneath aren't missed.
                const mineSpan = span(bar);
                const shared = mine
                  .flatMap((o) =>
                    barsOf(o)
                      .filter((b) => !foldedAway(b.track))
                      .map((b) => ({ key: barKey(o, barsOf(o).indexOf(b)), row: rowOf(b.track), ...span(b) })),
                  )
                  .filter((o) => o.key !== barKey(l, i) && o.row === rowOf(bar.track))
                  .map((o) => ({ from: Math.max(o.from, mineSpan.from), to: Math.min(o.to, mineSpan.to) }))
                  .filter((o) => o.from <= o.to);
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
                const asset = assets.get(l.assetId);
                // What it is, under when it plays: a colour by its code, anything else by its name.
                const what = asset?.kind === 'color' && asset.value ? asset.value : (l.assetName ?? l.assetId);
                const label = (
                  <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-1">
                    <span className="truncate font-body text-[13px] leading-none">
                      {isMarker(l) ? (
                        // Plays whenever the marker is on this bar's stages.
                        <>{MARKER_LABEL}</>
                      ) : isConnected(l) ? (
                        <>
                          {every ? '↻ ' : loops ? '∞ ' : ''}
                          {l.action}
                        </>
                      ) : (
                        // Dropped from the Media Library, no action yet: it doesn't play until its ▼ picks one.
                        <span className="italic">Pick an action ▼</span>
                      )}
                    </span>
                    <span className="truncate font-body text-[11px] leading-none opacity-80">{what}</span>
                  </span>
                );
                // Its ends: drag to stretch it; click to turn its fade in (left) or fade out (right) on or off.
                // Just inside each end, a grip slides in by notches (a second each, up to MAX_FADE_SECONDS):
                // how long that fade lasts. The ramp shows it.
                const NOTCH = 12;                                     // px per second
                const END = 16;                                       // the end handle's width
                const handle = (end: 'from' | 'to') => {
                  const saved = end === 'from' ? fadeInSeconds(bar) : fadeOutSeconds(bar);
                  const sliding = fadeDrag && fadeDrag.key === key && fadeDrag.end === end ? fadeDrag : null;
                  const secs = sliding ? sliding.now : saved;
                  const what = end === 'from' ? 'fade in' : 'fade out';
                  const side = end === 'from' ? 'left' : 'right';
                  const rampW = secs > 0 ? END + secs * NOTCH : 0;
                  const commit = (to: number) => {
                    if (to === saved) return;
                    const which = end === 'from' ? 'fadeIn' : 'fadeOut';
                    updateMediaLinks(
                      (all) => all.map((x) => (sameLink(x, l) ? withBar(x, i, { ...bar, [which]: fadeValue(to) }) : x)),
                      to === 0 ? `Remove ${what}` : `${what[0].toUpperCase()}${what.slice(1)} ${to} s`,
                    );
                  };
                  return (
                    <>
                      <span
                        data-bar-end={end}
                        data-fade={saved > 0 ? saved : undefined}
                        title={`Click: ${saved > 0 ? `no ${what}` : `${what} over ${FADE_SECONDS} s`} · drag: stretch · drag the grip inside it: ${what} up to ${MAX_FADE_SECONDS} s`}
                        onPointerDown={(e) => grab(e, l, i, end)}
                        onPointerMove={(e) => {
                          e.stopPropagation();
                          follow(e, l, i);
                        }}
                        onPointerUp={(e) => {
                          e.stopPropagation();
                          letGo(l, i);
                        }}
                        // Pinned to the bar's edges, so they're there to grab however short the bar is.
                        className={`absolute inset-y-0 z-20 w-4 cursor-ew-resize bg-ink/20 ${end === 'from' ? 'left-0 border-r' : 'right-0 border-l'} border-paper/50`}
                        aria-hidden="true"
                      />
                      {rampW > 0 && (
                        // The ramp: rising from the bottom over the fade in, falling to it over the fade out.
                        <svg
                          className="pointer-events-none absolute inset-y-0 z-10 h-full"
                          style={{ [side]: 0, width: rampW }}
                          viewBox={`0 0 ${rampW} 32`}
                          preserveAspectRatio="none"
                          aria-hidden="true"
                        >
                          <polygon
                            points={end === 'from' ? `0,32 ${rampW},0 ${rampW},32` : `0,0 ${rampW},32 0,32`}
                            fill="rgba(255,255,255,0.3)"
                          />
                          <line
                            x1="0"
                            y1={end === 'from' ? 32 : 0}
                            x2={rampW}
                            y2={end === 'from' ? 0 : 32}
                            stroke="#fff"
                            strokeWidth="2"
                            vectorEffect="non-scaling-stroke"
                          />
                        </svg>
                      )}
                      {sliding &&
                        // While sliding: a tick at each notch, and how long it is now.
                        Array.from({ length: MAX_FADE_SECONDS }, (_, n) => (
                          <span
                            key={n}
                            className="pointer-events-none absolute bottom-0 z-30 h-1.5 w-px bg-paper"
                            style={{ [side]: END + (n + 1) * NOTCH }}
                            aria-hidden="true"
                          />
                        ))}
                      {sliding && (
                        <span
                          className="pointer-events-none absolute top-0 z-30 bg-ink px-0.5 font-label text-[9px] leading-tight text-paper"
                          style={{ [side]: END + secs * NOTCH + 4 }}
                        >
                          {secs} s
                        </span>
                      )}
                      <span
                        data-fade-grip={end}
                        role="slider"
                        aria-label={`${what[0].toUpperCase()}${what.slice(1)} length`}
                        aria-valuemin={0}
                        aria-valuemax={MAX_FADE_SECONDS}
                        aria-valuenow={secs}
                        aria-valuetext={`${secs} seconds`}
                        tabIndex={-1}
                        title={`${what[0].toUpperCase()}${what.slice(1)}: ${secs} s — slide in up to ${MAX_FADE_SECONDS} notches (a second each)`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          if (e.button !== 0) return;
                          try {
                            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                          } catch {
                            // not a real pointer
                          }
                          setFadeDrag({ key, end, x: e.clientX, start: saved, now: saved });
                        }}
                        onPointerMove={(e) => {
                          e.stopPropagation();
                          if (!sliding) return;
                          const inward = (e.clientX - sliding.x) * (end === 'from' ? 1 : -1);
                          const now = Math.max(0, Math.min(MAX_FADE_SECONDS, Math.round(sliding.start + inward / NOTCH)));
                          if (now !== sliding.now) setFadeDrag({ ...sliding, now });
                        }}
                        onPointerUp={(e) => {
                          e.stopPropagation();
                          if (!sliding) return;
                          setFadeDrag(null);
                          commit(sliding.now);
                        }}
                        onPointerCancel={() => setFadeDrag(null)}
                        className="absolute inset-y-0 z-30 w-2 cursor-col-resize"
                        style={{ [side]: END + secs * NOTCH - 3 }}
                      >
                        <span className="absolute inset-y-1 left-1/2 w-0.5 -translate-x-1/2 rounded bg-paper/80" />
                      </span>
                    </>
                  );
                };
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
                    // Sounds are green; pictures, video, text, colour and characters blue.
                    className={`absolute z-10 flex touch-none select-none items-center overflow-hidden border px-5 text-paper shadow-sm ${
                      isSoundTrack(bar.track) ? 'border-[#15803d]' : 'border-[#3c5eac]'
                    } ${
                      isConnected(l)
                        ? isSoundTrack(bar.track)
                          ? 'bg-[#15803d]'
                          : 'bg-[#3c5eac]'
                        : isSoundTrack(bar.track)
                          ? 'border-dashed border-paper/80 bg-[#15803d]/60'
                          : 'border-dashed border-paper/80 bg-[#3c5eac]/60'
                    } ${
                      optionHeld ? 'cursor-copy' : 'cursor-grab active:cursor-grabbing'
                    } ${dragging && !dragging.copy ? 'opacity-80 ring-2 ring-ink' : ''}`}
                    style={box(place)}
                  >
                    {shared.map((o, n) => (
                      <span
                        key={n}
                        className="pointer-events-none absolute inset-y-0 -z-10"
                        style={{
                          left: `${((o.from - mineSpan.from) / (mineSpan.to - mineSpan.from + 1)) * 100}%`,
                          width: `${((o.to - o.from + 1) / (mineSpan.to - mineSpan.from + 1)) * 100}%`,
                          background: `repeating-linear-gradient(135deg, ${isSoundTrack(bar.track) ? '#3fa564' : '#5d7cc4'} 0 10px, transparent 10px 20px)`,
                        }}
                        aria-hidden="true"
                      />
                    ))}
                    {handle('from')}
                    <BarThumb link={l} asset={asset} folder={folder} />
                    {label}
                    {audible(l) && <BarVolume link={l} />}
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
                      // Twice the ▼'s size, and held clear of the fade out: its ramp and grip reach
                      // END + MAX_FADE_SECONDS × NOTCH (52px) in from the bar's right edge.
                      className="relative z-40 mr-10 flex h-full w-12 shrink-0 cursor-pointer items-center justify-center font-body text-4xl leading-none text-paper/80 hover:bg-ink/30 hover:text-paper"
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
                      className={`pointer-events-none absolute z-20 flex items-center overflow-hidden border-2 border-dashed border-ink text-paper ${isSoundTrack(dragging.now.track) ? 'bg-[#15803d]/70' : 'bg-[#3c5eac]/70'}`}
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
/**
 * A sound bar's volume: a slider from silent to MAX_SOUND_VOLUME (×4, 400%). The sound follows it as it
 * moves (here and in TouchDesigner); letting go saves it on the bar's connection, as one Undo step.
 */
function BarVolume({ link }: { link: MediaLink }) {
  const saved = clampSoundVolume(link.volume);
  const [moving, setMoving] = useState<number | null>(null);
  const value = moving ?? saved;
  const save = () => {
    if (moving === null) return;
    const v = moving;
    setMoving(null);
    if (v === saved) return;
    updateMediaLinks(
      (all) => all.map((x) => (sameLink(x, link) ? { ...x, volume: v === 1 ? undefined : v } : x)),
      `Change the volume of ${link.assetId}`,
    );
  };
  const percent = Math.round(value * 100);
  return (
    <span
      // Not a drag: moving the slider mustn't pick the bar up.
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      data-bar-volume
      // Gives way first on a short bar, so its ▼ and × stay in reach.
      className="flex h-full min-w-0 shrink items-center gap-1 overflow-hidden px-1"
      title={`Volume ${percent}% — from silent to 400% (100% is the file as it is; above that a limiter keeps it from distorting)`}
    >
      <span className="font-body text-[11px] leading-none" aria-hidden="true">
        {value === 0 ? '🔇' : '🔊'}
      </span>
      <input
        type="range"
        min={0}
        max={MAX_SOUND_VOLUME}
        step={0.05}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          setMoving(v);
          setSoundVolume(link.assetId, v);
        }}
        onPointerUp={save}
        onKeyUp={save}
        onBlur={save}
        aria-label={`Volume of ${link.assetName ?? link.assetId}`}
        aria-valuetext={`${percent}%`}
        className="h-1 w-20 min-w-[28px] shrink cursor-pointer accent-paper"
      />
      <span className="w-8 text-right font-body text-[11px] tabular-nums leading-none">{percent}%</span>
      <BarLoop link={link} />
    </span>
  );
}

/**
 * A sound bar's loop button: on, the sound plays over and over (until its bar ends, the marker leaves,
 * or the call ends); off, it plays once. "Every time" sounds play once at each of their events.
 */
function BarLoop({ link }: { link: MediaLink }) {
  const every = timingOf(link).kind === 'every';
  const on = !every && loopOf(link);
  return (
    <button
      type="button"
      data-bar-loop
      onClick={(e) => {
        e.stopPropagation();
        if (every) return;
        const loop = !on;
        updateMediaLinks(
          (all) => all.map((x) => (sameLink(x, link) ? { ...x, loop } : x)),
          `${loop ? 'Loop' : "Don't loop"} ${link.assetId}`,
        );
        setSoundLoop(link.assetId, loop);
      }}
      disabled={every}
      aria-pressed={on}
      aria-label={`Loop ${link.assetName ?? link.assetId}`}
      title={
        every
          ? 'Plays once each time its moment comes round (“every time”) — change “When it plays” to loop it'
          : on
            ? 'Looping — click to play it once'
            : 'Plays once — click to loop it'
      }
      className={`ml-0.5 flex h-5 w-6 shrink-0 cursor-pointer items-center justify-center border font-body text-[13px] leading-none disabled:cursor-not-allowed disabled:opacity-40 ${
        on ? 'border-paper bg-paper text-[#3c5eac]' : 'border-paper/60 text-paper hover:bg-ink/30'
      }`}
    >
      ∞
    </button>
  );
}

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

/**
 * A bar's thumbnail, at its left: the picture, the video's first frame, the colour, or the words —
 * and for a sound, ♪ Sound. A small square of its kind's badge if the file can't be opened.
 */
function BarThumb({ link, asset, folder }: { link: MediaLink; asset?: MediaAsset; folder: MediaFolder | null }) {
  const kind = asset?.kind ?? link.assetKind ?? kindOf(link.assetName ?? '');
  const path = asset?.status === 'missing' ? undefined : asset?.path;
  const [url, setUrl] = useState<string | null>(null);
  const [still, setStill] = useState<string | null>(null);
  useEffect(() => {
    if (!folder || !path || (kind !== 'image' && kind !== 'video')) return;
    let gone = false;
    const made: string[] = [];
    const keep = (blob: Blob, set: (u: string) => void) => {
      if (gone) return;
      const u = URL.createObjectURL(blob);
      made.push(u);
      set(u);
    };
    openMediaFile(folder, path)
      .then(async (file) => {
        // A video's stored thumbnail if it has one (made for files the browser can't play), else the file.
        const thumb = kind === 'video' ? await loadThumbnail(link.assetId, file, path).catch(() => null) : null;
        if (thumb) keep(thumb, setStill);
        else keep(file, setUrl);
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      made.forEach((u) => URL.revokeObjectURL(u));
      setUrl(null);
      setStill(null);
    };
  }, [folder, path, kind, link.assetId]);

  const frame = 'pointer-events-none h-full min-w-0 shrink overflow-hidden border-r border-paper/50';
  if (kind === 'sound') {
    return (
      <span className={`${frame} flex items-center whitespace-nowrap bg-paper px-1.5 font-label text-[10px] uppercase tracking-wide text-ink`}>
        ♪ Sound
      </span>
    );
  }
  if (kind === 'color') {
    return <span className={`${frame} aspect-video`} style={{ background: asset?.value || '#000' }} aria-hidden="true" />;
  }
  if (kind === 'character') {
    // A still glowing dot in its colour (the live character is in the library and the room).
    const c = asset?.value || '#36d6ff';
    const glow = asset?.value
      ? `radial-gradient(circle at 50% 50%, #fff 0 8%, ${c} 22%, transparent 42%)`
      : 'radial-gradient(circle at 45% 45%, #fff 0 8%, #36d6ff 20%, #b44dff 32%, #ff3fa4 38%, transparent 44%)';
    return <span className={`${frame} aspect-video bg-black`} style={{ backgroundImage: glow }} aria-hidden="true" />;
  }
  if (kind === 'text') {
    return (
      <span
        className={`${frame} flex aspect-video items-center justify-center bg-ink px-0.5 text-center font-body text-[7px] leading-tight text-paper`}
        aria-hidden="true"
      >
        <span className="line-clamp-2">{asset?.value || 'Aa'}</span>
      </span>
    );
  }
  return (
    <span className={`${frame} relative aspect-video bg-ink`} aria-hidden="true">
      {/* Local files (object URLs), so next/image's optimising doesn't apply. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {(still || (kind === 'image' && url)) && <img src={(still ?? url)!} alt="" draggable={false} className="h-full w-full object-cover" />}
      {kind === 'video' && url && !still && (
        <video
          src={url}
          muted
          preload="metadata"
          playsInline
          // Show the first frame (some browsers stay blank until asked for a moment of it).
          onLoadedMetadata={(e) => {
            if (e.currentTarget.currentTime === 0) e.currentTarget.currentTime = 0.001;
          }}
          className="h-full w-full object-cover"
        />
      )}
      {!url && !still && (
        <span className="absolute inset-0 flex items-center justify-center font-label text-[8px] uppercase text-paper/80">
          {kind}
        </span>
      )}
    </span>
  );
}
