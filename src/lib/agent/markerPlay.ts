'use client';

import { areaOfTrack, barsOf, isMarker, loadLibrary, loadMediaLinks, loopOf, timingOf } from './mediaFolder';
import { isSoundPlaying, playSound, startLoop, stopSounds, type SceneRef } from './mediaPlayback';
import { areasShowing, hideVisual, showVisual } from './mediaShow';
import { onTDConnected } from './touchDesigner';

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

/** Where the timeline's marker is now (MediaTimeline keeps this up to date), for replayMarker. */
export function markerIsAt(scene: SceneRef | null, stages: { code: string }[], code: string | null | undefined) {
  here = { scene, stages, code };
}

/** Puts up again the pictures, video and colours with a bar on the marker's stage (no sounds). */
export async function replayMarker() {
  if (!here) return;
  forgetMarker();
  await markerArrived(here.scene, here.stages, here.code, { visualsOnly: true });
}

// Connecting to TouchDesigner clears its room: put the marker's stage back up there.
onTDConnected(() => void replayMarker());

export async function markerArrived(
  scene: SceneRef | null,
  stages: { code: string }[],
  code: string | null | undefined,
  { visualsOnly = false } = {},
) {
  if (!scene || !code) return;
  const at = stages.findIndex((s) => s.code === code);
  if (at < 0) return;
  const key = `${scene.sheetId}#${scene.number}`;
  if (last?.scene === key && last.stage === code) return;
  last = { scene: key, stage: code };
  const index = (c: string, fallback: number) => {
    const i = stages.findIndex((s) => s.code === c);
    return i >= 0 ? i : fallback;
  };
  const [links, library] = await Promise.all([loadMediaLinks(), loadLibrary()]);
  const assets = new Map((library?.assets ?? []).map((a) => [a.id, a]));
  for (const link of links) {
    if (link.sheetId !== scene.sheetId || link.sceneNumber !== scene.number || !isMarker(link)) continue;
    const asset = assets.get(link.assetId);
    if (!asset || asset.status !== 'present') continue;
    const covering = barsOf(link).filter((b) => {
      const from = index(b.from, 0);
      return from <= at && at <= Math.max(from, index(b.to, stages.length - 1));
    });
    if (asset.kind === 'sound') {
      if (visualsOnly) continue;
      if (covering.length > 0 && !isSoundPlaying(asset.id)) {
        void (loopOf(link) ? startLoop(asset) : playSound(asset)).catch(() => undefined);
      } else if (covering.length === 0 && isSoundPlaying(asset.id)) {
        stopSounds(asset.id);
      }
      continue;
    }
    const areas = [...new Set(covering.flatMap((b) => areaOfTrack(b.track) ?? []))].sort((a, b) => a - b);
    if (areas.length === 0) {
      if (areasShowing(asset.id)) hideVisual(asset.id);
    } else if (areasShowing(asset.id) !== areas.join(',')) {
      // Already up in exactly these areas: left alone, so a video doesn't start over.
      void showVisual({ link, asset, timing: timingOf(link), areas }).catch(() => undefined);
    }
  }
}
