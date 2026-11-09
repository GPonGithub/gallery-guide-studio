'use client';

import { useSyncExternalStore } from 'react';
import {
  areaOfTrack,
  barsOf,
  fadeInSeconds,
  fadeOutSeconds,
  isMarker,
  loadLibrary,
  loadMediaLinks,
  loopOf,
  timingOf,
  mediaSceneKey,
  subscribeMediaLinks,
  type MediaLink,
  type TimelineBar,
} from './mediaFolder';
import { clampSoundVolume, isSoundPlaying, playSound, startLoop, stopSounds, type SceneRef } from './mediaPlayback';
import { hideVisualExcept, placeOf, showVisual, shownIn } from './mediaShow';
import { onTDConnected } from './touchDesigner';
// Videos with a sound track play their sound with the picture (wherever they go up).
import './videoSound';

/**
 * "Play on marker arrival" (see MARKER_ACTION): each time the timeline's marker lands on a stage,
 * every marker connection in the scene is put right for it — shown in the areas whose bars cover that
 * stage (or taken down if none do); a sound started if one of its bars covers it (once, or looping
 * if set to), or stopped if none does. Called when a call starts (stage 1), when the conversation
 * moves to another stage, when the marker is moved by hand on the timeline, and (pictures, video and
 * colours only) each time TouchDesigner connects.
 */

let last: { scene: string; stage: string } | null = null;

/** Forget where the marker was (a restart, or a new call): its next arrival plays again even at the same stage. */
export function forgetMarker() {
  last = null;
}

let here: { scene: SceneRef | null; stages: { code: string }[]; code: string | null | undefined } | null = null;

const hereListeners = new Set<() => void>();
/** Where the timeline's marker is now (MediaTimeline keeps this up to date), for replayMarker. */
export function markerIsAt(scene: SceneRef | null, stages: { code: string }[], code: string | null | undefined) {
  here = { scene, stages, code };
  hereListeners.forEach((l) => l());
}
/** The stage the timeline's marker is on (a picture dropped on the room drawing is placed there). */
export const useMarkerStage = () =>
  useSyncExternalStore(
    (l) => {
      hereListeners.add(l);
      return () => {
        hereListeners.delete(l);
      };
    },
    () => here?.code ?? null,
    () => null,
  );

/** Puts up again the pictures, video and colours with a bar on the marker's stage (no sounds). */
export async function replayMarker() {
  if (!here) return;
  // Pictures only: where the marker last arrived is kept, so its sounds aren't started over.
  await markerArrived(here.scene, here.stages, here.code, { visualsOnly: true });
}

// Connecting to TouchDesigner clears its room: put the marker's stage back up there.
onTDConnected(() => void replayMarker());

// A bar dropped, connected, moved, stretched or removed on the timeline: the room shows the marker's stage
// as it is now, straight away (pictures, video and colours; sounds wait for the marker to arrive).
if (typeof window !== 'undefined') {
  let soon: ReturnType<typeof setTimeout> | null = null;
  subscribeMediaLinks(() => {
    if (soon) clearTimeout(soon);
    soon = setTimeout(() => void replayMarker(), 60);
  });
}

// Why a marker sound couldn't play, wherever the marker arrived from (a call starting, the conversation
// moving on, or a click): the timeline shows it, so a sound never fails silently.
let problem: string | null = null;
const problemListeners = new Set<() => void>();
export function setMarkerProblem(text: string | null) {
  problem = text;
  problemListeners.forEach((l) => l());
}
export const useMarkerProblem = () =>
  useSyncExternalStore(
    (l) => {
      problemListeners.add(l);
      return () => {
        problemListeners.delete(l);
      };
    },
    () => problem,
    () => null,
  );

export async function markerArrived(
  scene: SceneRef | null,
  stages: { code: string }[],
  code: string | null | undefined,
  {
    visualsOnly = false,
    ask = false,
    onProblem,
  }: {
    visualsOnly?: boolean;
    /**
     * From a click (moving the marker by hand, or the click that starts a call): the browser may ask for
     * permission to read the media folder (it forgets after a reload).
     */
    ask?: boolean;
    /** Hears why a sound couldn't play (no folder, no permission, a file that won't open). Default: the timeline shows it. */
    onProblem?: (text: string) => void;
  } = {},
) {
  onProblem = onProblem ?? setMarkerProblem;
  if (!scene || !code) return;
  const at = stages.findIndex((s) => s.code === code);
  if (at < 0) return;
  const key = `${scene.sheetId}#${scene.number}`;
  // A pictures-only refresh (a scene opening, TouchDesigner connecting, a picture dropped on the room)
  // doesn't count as the marker arriving: if it did, the real arrival at the same stage would be
  // skipped as "already here", and its sounds would never start.
  if (!visualsOnly && last?.scene === key && last.stage === code) return;
  // The stage the marker left (in this scene), for the fade out of the bars that ended there.
  const left = last?.scene === key ? stages.findIndex((s) => s.code === last!.stage) : -1;
  const before = left >= 0 ? left : null;
  if (!visualsOnly) last = { scene: key, stage: code };
  const index = (c: string, fallback: number) => {
    const i = stages.findIndex((s) => s.code === c);
    return i >= 0 ? i : fallback;
  };
  const covers = (b: { from: string; to: string }, stage: number) => {
    const from = index(b.from, 0);
    return from <= stage && stage <= Math.max(from, index(b.to, stages.length - 1));
  };
  const [links, library] = await Promise.all([loadMediaLinks(), loadLibrary(mediaSceneKey(scene))]);
  const assets = new Map((library?.assets ?? []).map((a) => [a.id, a]));
  // Pictures, video and colours, area by area: for each file, the areas a bar of it covers on this stage
  // (and which connection's bar). An area whose bar carries on from the last stage is left as it is — no
  // fade, no video starting over — even when the same file comes down on another area, or goes up on one.
  const wanted = new Map<string, Map<number, { link: MediaLink; bars: TimelineBar[] }>>();
  for (const link of links) {
    if (link.sheetId !== scene.sheetId || link.sceneNumber !== scene.number || !isMarker(link)) continue;
    const asset = assets.get(link.assetId);
    if (!asset || asset.status !== 'present') continue;
    const covering = barsOf(link).filter((b) => covers(b, at));
    if (asset.kind === 'sound') {
      if (visualsOnly) continue;
      if (covering.length > 0 && !isSoundPlaying(asset.id)) {
        const volume = clampSoundVolume(link.volume);
        // Its bar fades in: eased up from silence.
        const fade = Math.max(0, ...covering.map(fadeInSeconds));
        void (loopOf(link) ? startLoop(asset, volume, ask, fade) : playSound(asset, ask, volume, fade)).catch(
          (err: unknown) =>
            onProblem?.(
              `“${asset.name}” didn’t play: ${err instanceof Error ? err.message : 'it couldn’t be played.'}`,
            ),
        );
      } else if (covering.length === 0 && isSoundPlaying(asset.id)) {
        // The bar it played for (on the stage the marker left) fades out: eased down, then stopped.
        const ended = before === null ? [] : barsOf(link).filter((b) => covers(b, before));
        stopSounds(asset.id, Math.max(0, ...ended.map(fadeOutSeconds)));
      }
      continue;
    }
    const mine = wanted.get(asset.id) ?? new Map();
    wanted.set(asset.id, mine);
    for (const b of covering) {
      const area = areaOfTrack(b.track);
      if (area !== null && !mine.has(area)) mine.set(area, { link, bars: covering });
    }
  }
  for (const [assetId, areas] of wanted) {
    const asset = assets.get(assetId)!;
    // Taken down where no bar of it covers this stage any more (each area with its own bar's fade out).
    hideVisualExcept(assetId, [...areas.keys()]);
    // Put up where it isn't up yet, or is placed differently now — only those areas.
    const fresh = new Map<MediaLink, number[]>();
    for (const [area, { link }] of areas) {
      const now = shownIn(area);
      const place = JSON.stringify(placeOf(link, area) ?? null);
      if (now?.assetId === assetId && JSON.stringify(now.place ?? null) === place) continue;
      fresh.set(link, [...(fresh.get(link) ?? []), area]);
    }
    for (const [link, list] of fresh) {
      const bars = areas.get(list[0])!.bars;
      void showVisual({
        link,
        asset,
        timing: timingOf(link),
        areas: list.sort((a, b) => a - b),
        bars,
        only: true,
      }).catch(() => undefined);
    }
  }
}
