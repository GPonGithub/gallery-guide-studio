'use client';

import { formatId, isMade, type MediaAsset } from './media';
import {
  areaOfTrack,
  barsOf,
  currentMediaLinks,
  isVoice,
  nextVoiceId,
  loadLibrary,
  MARKER_ACTION,
  mediaSceneKey,
  savedMediaFolder,
  saveLibrary,
  setSceneMedia,
  timelineOf,
  updateMediaLinks,
  type MediaFolder,
  type MediaLink,
  type StoredLibrary,
  type TimelineBar,
} from './mediaFolder';
import { mediaFolderChanged } from './mediaDemo';
import { soundPan, soundPath } from './spatialAudio';

/**
 * Copy media from… (2026-11-18): another scene's pictures, film, sounds and chatbots, bars and all, brought
 * into the open scene — e.g. a room already dressed with its background imagery and sound, carried on into
 * the next scene. Always into the open scene, so it's an ordinary change: shown at once, saved with the
 * scene, and one undo step (⌘Z).
 *
 * - Each scene has its own Media Library (another scene's M-005 is another file), so every file used goes
 *   into this scene's library: the same file (same path, or the same text / colour / character) keeps the ID
 *   it has here; a new one gets the next ID.
 * - Bars span stages by code, and scenes have different stages: when the two scenes' stages differ, they're
 *   matched by position (the first to the first, the last to the last, the rest spread between).
 * - Media on marker arrival comes across; media connected to one of the other scene's actions (row 8) comes
 *   across only when this scene has the same action, word for word — the rest are listed, not copied.
 * - A sound's place in the room, its recorded movement, volume, fades and corner pins come with it.
 * - Replace: this scene's own media goes first. Add: it stays, and where a copied bar would land on an area
 *   (or sound track) already in use at those stages, it goes on that area's next free track — or, with none
 *   free, is left out (and listed).
 */

export type CopyScene = { sheetId: string; number: string; name: string; stages: string[] };
export type CopyMode = 'replace' | 'add';

export type CopyPlan = {
  /** The connections as they'll be once copied (every scene's). */
  links: MediaLink[];
  /** This scene's library with the copied files added. */
  library: StoredLibrary;
  /** The other scene's folder, given to this scene (it had none). */
  folder: MediaFolder | null;
  /** How many things come across, and how many of this scene's own go (Replace). */
  copied: number;
  replaced: number;
  /** Files new to this scene's library. */
  newFiles: number;
  /** What doesn't come across, in words. */
  left: string[];
  /** This scene reads a different folder: the copied files may not be found there. */
  folderWarning: string | null;
  /** The two scenes' stages differ, so bars were matched by position. */
  stagesMatched: boolean;
};

const MAX_TRACKS = 5;
const areaTrack = (area: number, k: number): TimelineBar['track'] => (k <= 1 ? area : `${area}-${k}`);
const soundNumber = (t: TimelineBar['track']) => (t === 'sound' ? 1 : Number(/(\d+)$/.exec(String(t))?.[1] ?? 1) || 1);
const soundTrack = (n: number, zone: number): TimelineBar['track'] =>
  zone === 2 ? (n <= 1 ? 'sound' : `sound-${n}`) : `sound-${zone * 10 + n}`;
const isSound = (t: TimelineBar['track']) => typeof t === 'string' && t.startsWith('sound');
/** The tracks a bar may go on, its own first: its area's (or its zone's sound) tracks 1–5. */
function tracksFor(t: TimelineBar['track']): TimelineBar['track'][] {
  if (isSound(t)) {
    const zone = Math.floor(soundNumber(t) / 10) === 1 ? 1 : Math.floor(soundNumber(t) / 10) === 3 ? 3 : 2;
    return [t, ...Array.from({ length: MAX_TRACKS }, (_, i) => soundTrack(i + 1, zone)).filter((x) => x !== t)];
  }
  const area = areaOfTrack(t);
  if (area === null) return [t];
  return [t, ...Array.from({ length: MAX_TRACKS }, (_, i) => areaTrack(area, i + 1)).filter((x) => x !== t)];
}

const idNumber = (id: string) => Number(/^M-(\d+)$/i.exec(id.trim())?.[1] ?? NaN);
const pathKey = (p: string) => p.trim().toLowerCase();
const today = () => new Date().toISOString().slice(0, 10);

/** Each of the other scene's stage codes → this scene's, by position when the two differ. */
function stageMap(from: string[], to: string[]): { map: (code: string) => string; matched: boolean } {
  const same = from.length === to.length && from.every((c, i) => c === to[i]);
  if (same || to.length === 0) return { map: (c) => c, matched: false };
  const map = (code: string) => {
    const i = from.indexOf(code);
    if (i < 0) return to.includes(code) ? code : to[0];
    const j = from.length <= 1 ? 0 : Math.round((i * (to.length - 1)) / (from.length - 1));
    return to[Math.min(to.length - 1, Math.max(0, j))];
  };
  return { map, matched: true };
}

/** Works out the copy (nothing changes until applySceneCopy). `actions`: this scene's row 8, if read. */
export async function planSceneCopy(
  from: CopyScene,
  to: CopyScene,
  mode: CopyMode,
  actions: string[] | null,
): Promise<CopyPlan> {
  const all = currentMediaLinks();
  const source = timelineOf(all, from);
  const own = timelineOf(all, to);
  const [fromLibrary, toLibrary, fromFolder, toFolder] = await Promise.all([
    loadLibrary(mediaSceneKey(from)),
    loadLibrary(mediaSceneKey(to)),
    savedMediaFolder(mediaSceneKey(from)),
    savedMediaFolder(mediaSceneKey(to)),
  ]);

  // The folder: given over when this scene has none; a warning when it reads another one.
  let folder: MediaFolder | null = null;
  let folderWarning: string | null = null;
  if (!toFolder && fromFolder) folder = fromFolder;
  else if (toFolder && fromFolder && !(await toFolder.isSameEntry(fromFolder).catch(() => false))) {
    folderWarning = `This scene reads the folder “${toFolder.name}”, scene ${from.number} reads “${fromFolder.name}”. Files that aren’t in “${toFolder.name}” too won’t be found — choose “${fromFolder.name}” as this scene’s folder (Media Library) to use them.`;
  }
  const library: StoredLibrary = {
    // The name of the folder this scene will read (TouchDesigner finds the files by it): its own, or the one given.
    folderName: (toFolder ?? folder)?.name || toLibrary?.folderName || fromLibrary?.folderName || '',
    assets: [...(toLibrary?.assets ?? [])],
    refreshedAt: toLibrary?.refreshedAt ?? Date.now(),
  };

  const left: string[] = [];
  const name = (l: MediaLink) => l.assetName ?? l.assetId;
  // What comes across: marker media, the Voice row's bars, and media whose action this scene has too.
  const carried = source.filter((l) => {
    if (l.action === MARKER_ACTION || isVoice(l) || actions?.includes(l.action)) return true;
    left.push(
      actions
        ? `${name(l)} — connected to “${l.action}”, which this scene doesn’t have`
        : `${name(l)} — connected to “${l.action}” (open the Media Library first, so this scene’s actions are read)`,
    );
    return false;
  });

  // The files, into this scene's library.
  let next = Math.max(0, ...library.assets.map((a) => idNumber(a.id)).filter(Number.isFinite)) + 1;
  let newFiles = 0;
  const ids = new Map<string, string>();
  const assetFor = (id: string): string | null => {
    if (ids.has(id)) return ids.get(id)!;
    const a = fromLibrary?.assets.find((x) => x.id === id);
    if (!a) return null;
    const same = library.assets.find((b) =>
      isMade(a.kind) ? b.kind === a.kind && b.value === a.value && b.name === a.name : !isMade(b.kind) && pathKey(b.path) === pathKey(a.path),
    );
    if (same) {
      ids.set(id, same.id);
      return same.id;
    }
    const added: MediaAsset = { ...a, id: formatId(next++), added: today() };
    library.assets.push(added);
    newFiles++;
    ids.set(id, added.id);
    return added.id;
  };

  const { map, matched } = stageMap(from.stages, to.stages);
  const order = to.stages;
  const at = (c: string, fallback: number) => {
    const i = order.indexOf(c);
    return i >= 0 ? i : fallback;
  };
  const overlaps = (a: TimelineBar, b: TimelineBar) =>
    at(a.from, 0) <= at(b.to, order.length - 1) && at(b.from, 0) <= at(a.to, order.length - 1);
  // The bars already on each track (Add: this scene's own, then each copied one as it lands).
  const busy: TimelineBar[] = mode === 'add' ? own.flatMap(barsOf) : [];
  const land = (bar: TimelineBar): TimelineBar | null => {
    let f = map(bar.from);
    let t = map(bar.to);
    if (at(f, 0) > at(t, 0)) [f, t] = [t, f];
    for (const track of tracksFor(bar.track)) {
      const moved: TimelineBar = { ...bar, track, from: f, to: t };
      if (!busy.some((b) => b.track === track && overlaps(b, moved))) {
        busy.push(moved);
        return moved;
      }
    }
    return null;
  };

  const copies: MediaLink[] = [];
  for (const l of carried) {
    // A voice bar has no file: it takes the next free voice ID here.
    const id = isVoice(l) ? nextVoiceId([...(mode === 'add' ? own : []), ...copies]) : assetFor(l.assetId);
    if (!id) {
      left.push(`${name(l)} — no longer in scene ${from.number}’s Media Library`);
      continue;
    }
    const bars = barsOf(l);
    const landed = bars.map(land).filter((b): b is TimelineBar => b !== null);
    if (bars.length && !landed.length) {
      left.push(`${name(l)} — every track of its area is in use at those stages`);
      continue;
    }
    if (landed.length < bars.length) left.push(`${name(l)} — ${bars.length - landed.length} of its copies (no free track)`);
    // Its place in the room and recorded movement, as heard in the other scene.
    const pan = l.pan ?? soundPan(from.sheetId, from.number, l.assetId, all);
    const panPath = l.panPath ?? soundPath(from.sheetId, from.number, l.assetId, all) ?? undefined;
    const { bar: _bar, copies: _copies, ...rest } = l;
    void _bar;
    void _copies;
    copies.push({
      ...rest,
      assetId: id,
      sheetId: to.sheetId,
      sceneNumber: to.number,
      sceneName: to.name,
      ...(pan.x !== 0 || pan.y !== 0 ? { pan } : {}),
      ...(panPath?.length ? { panPath } : {}),
      ...(landed.length ? { bar: landed[0], ...(landed.length > 1 ? { copies: landed.slice(1) } : {}) } : {}),
    });
  }

  const mine = (l: MediaLink) => l.sheetId === to.sheetId && l.sceneNumber === to.number;
  const links = mode === 'replace' ? [...all.filter((l) => !mine(l)), ...copies] : [...all, ...copies];
  return {
    links,
    library,
    folder,
    copied: copies.length,
    replaced: mode === 'replace' ? own.length : 0,
    newFiles,
    left,
    folderWarning,
    stagesMatched: matched,
  };
}

/** Makes the copy: the library (and folder) first, then the connections as one undo step. */
export async function applySceneCopy(plan: CopyPlan, from: CopyScene, to: CopyScene, mode: CopyMode) {
  const key = mediaSceneKey(to);
  if (plan.folder) await setSceneMedia(key, plan.folder, plan.library);
  else await saveLibrary(plan.library, key);
  mediaFolderChanged();
  updateMediaLinks(
    () => plan.links,
    `${mode === 'replace' ? 'Replace with' : 'Add'} scene ${from.number}’s media`,
  );
}
