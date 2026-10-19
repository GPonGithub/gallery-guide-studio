'use client';

import type { MediaAsset } from './media';
import { barsOf, type MediaLink, type TimelineBar } from './mediaFolder';

/**
 * The show file: everything the room needs, in one readable JSON file
 * (show.json in the media folder) — shared with Greg's Show Control and read
 * by TouchDesigner on its own. Its format is a superset of Show Control's
 * show.json: `cast`, `score.regions[].spans` and `playhead` mean what they mean
 * there, so its tools and TouchDesigner reader keep working; everything else
 * is added alongside. See SHOW_FORMAT.md for the full description.
 *
 * `connections` is the complete record (what Open Show reads back);
 * `scenes` and the top-level `score` are views of it for other readers.
 */

export const SHOW_FORMAT = 'immersive-lab-show';
export const SHOW_VERSION = 1;
export const SHOW_FILE_NAME = 'show.json';
export const REGION_COUNT = 11;

export type ShowMemberKind = 'video' | 'sound' | 'image' | 'text' | 'color';

/** A cast member: a media file (by its path in the media folder), or a text or colour (by value). */
export type ShowMember = {
  id: string;
  number: number;
  name: string;
  kind: ShowMemberKind;
  path?: string;
  value?: string;
  /** 'missing': listed, but not in the media folder at the last refresh. */
  status?: 'present' | 'missing';
};

/** Show Control's span: a member on a region from frame `start` for `length` frames. */
export type ShowSpan = {
  id: string;
  memberId: string;
  start: number;
  length: number;
  /** Added: the action it belongs to, and which of the area's tracks it's on (1–5). */
  action?: string;
  lane?: number;
};

export type ShowRegion = { region: number; spans: ShowSpan[] };

/** A stage of a scene's conversation. Frame n of the scene is stages[n - 1]. */
export type ShowStage = { code: string; name: string; goal?: string };

export type ShowScene = {
  sheetId: string;
  number: string;
  name: string;
  stages: ShowStage[];
  score: { regions: ShowRegion[]; sound: { track: number; spans: ShowSpan[] }[] };
};

/** One file connected to one of a scene's actions, with everything about it — what Open Show restores. */
export type ShowConnection = {
  memberId: string;
  sheetId: string;
  sceneNumber: string;
  sceneName: string;
  action: string;
  timing?: MediaLink['timing'];
  loop?: boolean;
  bars: TimelineBar[];
  barsKind?: MediaLink['barsKind'];
};

export type Show = {
  format: typeof SHOW_FORMAT;
  version: number;
  savedAt: string;
  mediaFolder: string;
  cast: ShowMember[];
  /** Show Control's fields, for the first scene (its tools show one score at a time). */
  score: { regions: ShowRegion[] };
  playhead: number;
  scenes: ShowScene[];
  connections: ShowConnection[];
};

/** A scene the show covers: where it came from, and its stages in order. */
export type SceneInfo = { sheetId: string; number: string; name: string; stages: ShowStage[] };

const sceneKey = (sheetId: string, number: string) => `${sheetId}#${number}`;
const emptyRegions = (): ShowRegion[] => Array.from({ length: REGION_COUNT }, (_, i) => ({ region: i + 1, spans: [] }));

/** Which area and which of its five tracks a bar is on (null for sound). */
function areaAndLane(track: TimelineBar['track']): { area: number; lane: number } | null {
  if (typeof track === 'number') return { area: track, lane: 1 };
  const m = /^(\d+)-(\d+)$/.exec(track);
  return m ? { area: Number(m[1]), lane: Number(m[2]) } : null;
}
const soundTrack = (track: TimelineBar['track']) =>
  track === 'sound' ? 1 : typeof track === 'string' && /^sound-(\d+)$/.test(track) ? Number(track.slice(6)) : null;

/** Makes the show from the media library, the connections and the scenes' stages. */
export function buildShow(folderName: string, assets: MediaAsset[], links: MediaLink[], scenes: SceneInfo[]): Show {
  const cast: ShowMember[] = assets.map((a, i) => ({
    id: a.id,
    number: Number(/\d+/.exec(a.id)?.[0] ?? i + 1),
    name: a.name,
    kind: a.kind,
    // A file by its path; a text or colour by its value (Show Control's own convention).
    ...(a.kind === 'text' || a.kind === 'color' ? { value: a.value ?? '' } : { path: a.path }),
    status: a.status,
  }));
  const byScene = new Map(scenes.map((s) => [sceneKey(s.sheetId, s.number), s]));
  const showScenes: ShowScene[] = scenes.map((s) => ({
    sheetId: s.sheetId,
    number: s.number,
    name: s.name,
    stages: s.stages,
    score: { regions: emptyRegions(), sound: [] },
  }));
  const sceneOut = new Map(showScenes.map((s) => [sceneKey(s.sheetId, s.number), s]));

  for (const link of links) {
    const scene = byScene.get(sceneKey(link.sheetId, link.sceneNumber));
    const out = sceneOut.get(sceneKey(link.sheetId, link.sceneNumber));
    if (!scene || !out) continue;
    barsOf(link).forEach((bar, i) => {
      const from = scene.stages.findIndex((st) => st.code === bar.from);
      const to = scene.stages.findIndex((st) => st.code === bar.to);
      if (from < 0 || to < from) return;
      const span: ShowSpan = {
        id: `${link.assetId}:${link.action}:${i}`,
        memberId: link.assetId,
        start: from + 1,
        length: to - from + 1,
        action: link.action,
      };
      const area = areaAndLane(bar.track);
      if (area) {
        out.score.regions[area.area - 1]?.spans.push({ ...span, lane: area.lane });
      } else {
        const n = soundTrack(bar.track) ?? 1;
        let track = out.score.sound.find((t) => t.track === n);
        if (!track) out.score.sound.push((track = { track: n, spans: [] }));
        track.spans.push(span);
      }
    });
  }
  for (const s of showScenes) {
    for (const r of s.score.regions) r.spans.sort((a, b) => a.start - b.start);
    s.score.sound.sort((a, b) => a.track - b.track);
  }

  const connections: ShowConnection[] = links.map((l) => ({
    memberId: l.assetId,
    sheetId: l.sheetId,
    sceneNumber: l.sceneNumber,
    sceneName: l.sceneName,
    action: l.action,
    ...(l.timing && { timing: l.timing }),
    ...(l.loop !== undefined && { loop: l.loop }),
    bars: barsOf(l),
    ...(l.barsKind && { barsKind: l.barsKind }),
  }));

  return {
    format: SHOW_FORMAT,
    version: SHOW_VERSION,
    savedAt: new Date().toISOString(),
    mediaFolder: folderName,
    cast,
    score: { regions: showScenes[0]?.score.regions ?? emptyRegions() },
    playhead: 1,
    scenes: showScenes,
    connections,
  };
}

/** The show as it's written to disk (two-space indents, ending in a newline — easy to read and diff). */
export const showText = (show: Show) => `${JSON.stringify(show, null, 2)}\n`;

/** Reads a show file; throws a plain-English error if it isn't one. */
export function parseShow(text: string): Show {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file isn’t a show file (it isn’t valid JSON).');
  }
  const show = data as Partial<Show>;
  if (!show || typeof show !== 'object' || !Array.isArray(show.cast)) {
    throw new Error('That file isn’t a show file.');
  }
  if (show.format !== SHOW_FORMAT || !Array.isArray(show.connections)) {
    throw new Error(
      'That show file has no connections to open — it may come from Show Control on its own. Only show files saved by this app can be opened here.',
    );
  }
  return show as Show;
}

/**
 * The connections a show file holds, matched to this media library: a cast
 * member is the library's file with the same path (its ID may differ), or keeps
 * its own ID if the file isn't in the library.
 */
export function connectionsFrom(show: Show, assets: MediaAsset[]): { links: MediaLink[]; unmatched: string[] } {
  const byPath = new Map(assets.map((a) => [a.path, a]));
  const member = new Map(show.cast.map((m) => [m.id, m]));
  const unmatched: string[] = [];
  const links = show.connections.map((c): MediaLink => {
    const m = member.get(c.memberId);
    const asset = (m?.path && byPath.get(m.path)) || assets.find((a) => a.id === c.memberId);
    if (!asset) unmatched.push(m?.path ?? c.memberId);
    const [bar, ...copies] = c.bars;
    return {
      assetId: asset?.id ?? c.memberId,
      sheetId: c.sheetId,
      sceneNumber: c.sceneNumber,
      sceneName: c.sceneName,
      action: c.action,
      ...(c.timing && { timing: c.timing }),
      ...(c.loop !== undefined && { loop: c.loop }),
      assetName: asset?.name ?? m?.name,
      assetKind:
        asset?.kind ?? (m?.kind === 'video' || m?.kind === 'sound' || m?.kind === 'image' ? m.kind : undefined),
      ...(bar && { bar }),
      ...(copies.length > 0 && { copies }),
      ...(c.barsKind && { barsKind: c.barsKind }),
    };
  });
  return { links, unmatched };
}
