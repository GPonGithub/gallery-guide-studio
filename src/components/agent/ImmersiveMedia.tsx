'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CollapsiblePanel } from './CollapsiblePanel';
import { buttonGhost, buttonOutline } from '@/lib/styles';
import { parseSheetUrl } from '@/lib/agent/sheetScenes';
import { isScriptUrl } from '@/lib/agent/sheetScript';
import {
  ACTION_KINDS,
  KIND_BADGE,
  KIND_HELP,
  LOOP_WHEN_BADGE,
  LOOP_WHEN_HELP,
  wordsSayLoop,
  KIND_LABEL,
  VOICE_LABEL,
  WHEN_LABEL,
  fromRows,
  mergeMedia,
  readActionTiming,
  toRow,
  type ActionKind,
  type EveryWhen,
  type MediaAsset,
  type MediaKind,
  type MediaRow,
  type VoiceWait,
} from '@/lib/agent/media';
import { isSoundPlaying, onSoundsChange, playSound, stopSounds } from '@/lib/agent/mediaPlayback';
import { areasOf, areasText, hideVisual, showVisual, useShowing } from '@/lib/agent/mediaShow';
import {
  allowed,
  canPickFolder,
  loadLibrary,
  openMediaFile,
  pickMediaFolder,
  savedMediaFolder,
  saveLibrary,
  scanMediaFolder,
  updateMediaLinks,
  useMediaLinks,
  loadThumbnail,
  makeThumbnail,
  followRewording,
  readActions,
  loopOf,
  readingNow,
  timingOf,
  useActionReadings,
  type MediaFolder,
  type MediaLink,
  type StoredLibrary,
} from '@/lib/agent/mediaFolder';
import type { SheetScene } from '@/lib/agent/sheetScenes';
import type { SheetSource } from '@/lib/agent/projectStore';
import { DropdownArrow } from './DropdownArrow';

/**
 * Adding Immersive Media Process: the media folder (choose it, refresh the
 * list — each file with an ID, listed on the sheet's Media tab) and the
 * Media Library, every file with a thumbnail and its details.
 */

async function mediaRequest(body: Record<string, unknown>): Promise<{
  ok: boolean;
  error?: string;
  media?: MediaRow[];
  written?: number;
}> {
  try {
    const res = await fetch('/api/sheets/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'Couldn’t reach the app’s server.' };
  }
}

/** The open scene's media actions (row 8), as last read for `key` (its sheet and number). */
type SceneActions = { key: string; list: string[] } | { key: string; error: string };

/** An action reworded in the sheet: its connections follow it (see followRewording), and are saved. */
function followActions(scene: SheetSource, list: string[]) {
  updateMediaLinks(
    (current) => followRewording(current, { sheetId: scene.sheetId, number: scene.number }, list) ?? current,
  );
}

/** Reads a scene's media actions from row 8 of its sheet, as the sheet is now. */
async function readSceneActions(scene: SheetSource): Promise<{ list: string[] } | { error: string }> {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${scene.sheetId}/edit#gid=${scene.gid}`;
    const res = await fetch('/api/sheets/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json()) as { scenes?: SheetScene[]; error?: string };
    if (!data.scenes) return { error: data.error ?? 'The sheet couldn’t be read.' };
    const match =
      data.scenes.find((s) => s.number === scene.number) ?? data.scenes.find((s) => s.column === scene.column);
    return match ? { list: match.mediaActions } : { error: 'This scene is no longer in the sheet.' };
  } catch {
    return { error: 'Couldn’t reach the sheet.' };
  }
}

export function ImmersiveMedia({
  sheetUrl,
  sheetScriptUrl,
  sceneSheet,
  sceneName,
  onTryVoice,
  anthropicApiKey,
}: {
  sheetUrl: string;
  sheetScriptUrl: string;
  /** Where the open scene came from in the sheet (null: it isn't from one). */
  sceneSheet: SheetSource | null;
  sceneName: string;
  /** Says a line in the voice in use, resolving once it's finished (Try it). */
  onTryVoice?: (text: string, signal?: AbortSignal) => Promise<void>;
  /** For Claude to read what each action means (any wording or language). */
  anthropicApiKey: string;
}) {
  const [folder, setFolder] = useState<MediaFolder | null>(null);
  const [library, setLibrary] = useState<StoredLibrary | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; problem?: boolean } | null>(null);
  const [pickable, setPickable] = useState(true);
  /** The Media Library is open, and may read the folder. */
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [readable, setReadable] = useState<boolean | null>(null);

  const sheet = parseSheetUrl(sheetUrl);
  const scriptUrl = sheetScriptUrl.trim();
  const sheetConnected = Boolean(sheet) && isScriptUrl(scriptUrl);

  const links = useMediaLinks();
  // Claude's readings of the actions: re-renders as they arrive.
  useActionReadings();
  const keyRef = useRef(anthropicApiKey);
  useEffect(() => {
    keyRef.current = anthropicApiKey;
  });
  const [actions, setActions] = useState<SceneActions | null>(null);
  const sceneKey = sceneSheet ? `${sceneSheet.sheetId}:${sceneSheet.number}` : null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only: the browser's folder support isn't known during SSR
    setPickable(canPickFolder());
    void savedMediaFolder().then(setFolder);
    void loadLibrary().then(setLibrary);
  }, []);

  // The open scene's media actions, read from row 8 of the sheet each time the Media Library
  // opens, the scene changes, or Connect with Action is clicked — students change them often, so
  // the list is always the sheet's latest.
  useEffect(() => {
    if (!libraryOpen || !sceneSheet || !sceneKey) return;
    let gone = false;
    void readSceneActions(sceneSheet).then((read) => {
      if (gone) return;
      setActions({ key: sceneKey, ...read });
      if ('list' in read) {
        followActions(sceneSheet, read.list);
        void readActions(read.list, keyRef.current);
      }
    });
    return () => {
      gone = true;
    };
  }, [libraryOpen, sceneKey, sceneSheet]);

  // Coming back to the app (from editing the sheet, say): row 8 is read again, so a reworded action's
  // bars and connections follow it straight away (see followRewording).
  const lastFocusRead = useRef(0);
  useEffect(() => {
    if (!sceneSheet || !sceneKey) return;
    const back = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastFocusRead.current < 2000) return;
      lastFocusRead.current = Date.now();
      void readSceneActions(sceneSheet).then((read) => {
        if (!('list' in read)) return;
        setActions({ key: sceneKey, ...read });
        followActions(sceneSheet, read.list);
        void readActions(read.list, keyRef.current);
      });
    };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => {
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
    };
  }, [sceneKey, sceneSheet]);

  /** Reading row 8 again (Connect with Action was clicked) — the list shown meanwhile is the last one read. */
  const [rereading, setRereading] = useState(false);
  const rereadActions = async () => {
    if (!sceneSheet || !sceneKey) return;
    setRereading(true);
    const read = await readSceneActions(sceneSheet);
    setActions({ key: sceneKey, ...read });
    if ('list' in read) {
      followActions(sceneSheet, read.list);
      void readActions(read.list, anthropicApiKey);
    }
    setRereading(false);
  };

  /** Connects a file to one of the open scene's actions — or, if it's connected already, disconnects it. */
  const toggleLink = (assetId: string, action: string) => {
    if (!sceneSheet) return;
    const same = (l: MediaLink) =>
      l.assetId === assetId &&
      l.sheetId === sceneSheet.sheetId &&
      l.sceneNumber === sceneSheet.number &&
      l.action === action;
    const asset = library?.assets.find((a) => a.id === assetId);
    // A new connection also gets a bar on the scene's timeline (placed there when it first shows).
    const connected = (shared: MediaLink[]) => shared.some(same);
    updateMediaLinks((all) =>
      connected(all)
        ? all.filter((l) => !same(l))
        : [
            ...all,
            {
              assetId,
              sheetId: sceneSheet.sheetId,
              sceneNumber: sceneSheet.number,
              sceneName,
              action,
              assetName: asset?.name,
              assetKind: asset?.kind,
            },
          ],
      `${connected(links) ? 'Disconnect' : 'Connect'} ${assetId}`,
    );
  };
  const removeLink = (link: MediaLink) =>
    updateMediaLinks((all) => all.filter((l) => l !== link), `Disconnect ${link.assetId}`);
  /** "When it plays": its kind, and for "once, when user instructs" whether it loops — one change, one undo. */
  const setPlays = (link: MediaLink, kind: ActionKind, loop: boolean | undefined) =>
    updateMediaLinks(
      (all) => all.map((l) => (l === link ? { ...l, timing: { ...l.timing, kind }, loop } : l)),
      `Change when ${link.assetId} plays`,
    );
  /** The student's choice of when a connection fires, or what the voice does. */
  const setTiming = (link: MediaLink, change: NonNullable<MediaLink['timing']>) =>
    updateMediaLinks(
      (all) => all.map((l) => (l === link ? { ...l, timing: { ...l.timing, ...change } } : l)),
      `Change when ${link.assetId} plays`,
    );

  const refresh = async (chooseAgain: boolean) => {
    setNote(null);
    let f = chooseAgain ? null : folder;
    try {
      if (!f) {
        f = await pickMediaFolder();
        if (!f) return;
        setFolder(f);
      }
      if (!(await allowed(f, true))) {
        setReadable(false);
        setNote({
          text: `The browser wasn’t allowed to read “${f.name}”. Click Refresh Media and choose Allow.`,
          problem: true,
        });
        return;
      }
      setReadable(true);
      setBusy(true);
      const found = await scanMediaFolder(f);
      // The sheet's list is the one everyone shares, so its IDs come first.
      let existing = chooseAgain && library?.folderName !== f.name ? [] : (library?.assets ?? []);
      let sheetNote = '';
      if (sheetConnected) {
        const read = await mediaRequest({
          scriptUrl,
          spreadsheetId: sheet!.sheetId,
          action: 'read',
        });
        if (read.ok && read.media && read.media.length > 0) existing = fromRows(read.media);
        else if (!read.ok) sheetNote = read.error ?? 'The sheet couldn’t be read.';
      }
      const merged = mergeMedia(existing, found, new Date().toLocaleDateString('en-CA'));
      const next: StoredLibrary = {
        folderName: f.name,
        assets: merged.assets,
        refreshedAt: Date.now(),
      };
      await saveLibrary(next);
      setLibrary(next);
      if (sheetConnected && !sheetNote) {
        const write = await mediaRequest({
          scriptUrl,
          spreadsheetId: sheet!.sheetId,
          action: 'write',
          rows: merged.assets.map(toRow),
        });
        if (!write.ok) sheetNote = write.error ?? 'The sheet couldn’t be written.';
      }
      const present = merged.assets.filter((a) => a.status === 'present').length;
      const changes = [
        merged.added && `${merged.added} new`,
        merged.returned && `${merged.returned} back`,
        merged.missing && `${merged.missing} now missing`,
      ].filter(Boolean);
      const summary = `✓ ${present} file${present === 1 ? '' : 's'} in “${f.name}”${changes.length ? ` (${changes.join(', ')})` : ''}.`;
      if (sheetNote)
        setNote({
          text: `${summary} Not written to the sheet: ${sheetNote}`,
          problem: true,
        });
      else if (sheetConnected) setNote({ text: `${summary} Listed on the sheet’s Media tab.` });
      else
        setNote({
          text: `${summary} Kept in this browser — connect the sheet’s Apps Script (section 1) to list them on the sheet.`,
        });
    } catch (err) {
      setNote({
        text: err instanceof Error ? err.message : 'The folder couldn’t be read.',
        problem: true,
      });
    } finally {
      setBusy(false);
    }
  };

  // Opening the Media Library loads it: the list as last refreshed (or a first refresh if there's
  // none yet), and permission to read the folder for the thumbnails. The click that opened it lets
  // the browser ask, if it needs to.
  const openLibrary = async () => {
    if (!folder) return;
    const ok = await allowed(folder, true).catch(() => false);
    setReadable(ok);
    if (ok && !library?.assets.length) await refresh(false);
  };

  const assets = library?.assets ?? [];

  return (
    <>
      <CollapsiblePanel title="1 · Media folder" tourId="media-1">
        <p className="font-body text-xs italic text-muted-ink">
          Keep every image, video and sound file in one folder on this computer (subfolders are fine). The app lists
          them — each with an ID that stays the same — on the sheet&rsquo;s <b>Media</b> tab. The files stay in the
          folder.
        </p>
        {!pickable ? (
          <p className="border-l-4 border-[#b91c1c] pl-2 font-body text-xs text-ink">
            This browser can&rsquo;t open a folder. Use <b>Chrome</b> or <b>Edge</b> for the media library.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void refresh(false)} disabled={busy} className={stepButton(busy)}>
              {busy ? 'Reading the folder…' : folder ? 'Refresh Media' : 'Choose Media Folder'}
            </button>
            {folder && (
              <button onClick={() => void refresh(true)} disabled={busy} className={buttonGhost}>
                Choose a different folder
              </button>
            )}
          </div>
        )}
        {/* The app's packages on this computer (ffmpeg among them, for video thumbnails). */}
        <ThumbnailTools />
        {folder && (
          <p className="font-label text-[10px] uppercase tracking-wide text-muted-ink">
            Media folder: {folder.name}
            {library?.refreshedAt ? ` · refreshed ${new Date(library.refreshedAt).toLocaleString()}` : ''}
          </p>
        )}
        {note && (
          <p className={`font-body text-xs text-ink ${note.problem ? 'border-l-4 border-[#b91c1c] pl-2' : ''}`}>
            {note.text}
          </p>
        )}
      </CollapsiblePanel>

      <CollapsiblePanel
        title="2 · Media Library"
        tourId="media-2"
        onOpenChange={(open) => {
          setLibraryOpen(open);
          if (open) void openLibrary();
        }}
      >
        {!folder ? (
          <p className="font-body text-xs italic text-muted-ink">Choose the media folder first (1 · Media folder).</p>
        ) : assets.length === 0 ? (
          <p className="font-body text-xs italic text-muted-ink">
            {busy ? 'Loading the media…' : 'No media files in the folder yet.'}
          </p>
        ) : (
          <>
            {readable === false && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-body text-xs text-ink">The browser needs permission to show the files.</p>
                <button onClick={() => void openLibrary()} className={buttonOutline}>
                  Allow
                </button>
              </div>
            )}
            <MediaList
              folder={folder}
              assets={assets}
              show={libraryOpen && readable === true}
              connect={{
                scene: sceneSheet ? { sheetId: sceneSheet.sheetId, number: sceneSheet.number, name: sceneName } : null,
                actions: actions && actions.key === sceneKey ? actions : null,
                rereading,
                onReread: () => void rereadActions(),
                links,
                onToggle: toggleLink,
                onRemove: removeLink,
                onTiming: setTiming,
                onPlays: setPlays,
                onTryVoice,
              }}
            />
          </>
        )}
      </CollapsiblePanel>
    </>
  );
}

/** The Media folder's two buttons, Run npm install and Refresh Media: alike, and the same size. */
const stepButton = (busy: boolean) =>
  `h-9 w-[190px] border border-ink px-2 font-label text-[10px] uppercase leading-none tracking-wide transition-colors ${
    busy ? 'cursor-wait bg-paper text-muted-ink' : 'bg-paper text-ink hover:bg-ink hover:text-paper'
  }`;

/**
 * Whether video the browser can't show gets a thumbnail (ffmpeg, on this
 * computer), and Run npm install — fetches the app's packages, ffmpeg among
 * them, for a copy that was updated without it. Not shown on a hosted copy.
 */
function ThumbnailTools() {
  const [ffmpeg, setFfmpeg] = useState<'app' | 'computer' | null | 'unknown'>('unknown');
  const [hosted, setHosted] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; output: string } | null>(null);
  useEffect(() => {
    fetch('/api/media/ffmpeg')
      .then((res) => res.json() as Promise<{ hosted: boolean; ffmpeg: 'app' | 'computer' | null }>)
      .then((data) => {
        setHosted(data.hosted);
        setFfmpeg(data.ffmpeg);
      })
      .catch(() => {});
  }, []);
  if (hosted) return null;
  const install = async () => {
    setInstalling(true);
    setResult(null);
    try {
      const res = await fetch('/api/media/ffmpeg', { method: 'POST' });
      const data = (await res.json()) as {
        ok: boolean;
        output?: string;
        error?: string;
        ffmpeg?: 'app' | 'computer' | null;
      };
      setResult({
        ok: data.ok,
        output: data.ok ? (data.output ?? '') : (data.error ?? data.output ?? 'npm install failed.'),
      });
      if (data.ffmpeg !== undefined) setFfmpeg(data.ffmpeg);
    } catch {
      setResult({ ok: false, output: 'Couldn’t reach the app’s server.' });
    } finally {
      setInstalling(false);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void install()}
          disabled={installing}
          className={stepButton(installing)}
          title="Fetches the app's packages on this computer — ffmpeg among them, for video thumbnails"
        >
          {installing ? 'Running npm install…' : 'Run npm install'}
        </button>
        <span className="font-body text-xs text-ink">
          {ffmpeg === 'unknown'
            ? ''
            : ffmpeg
              ? '✓ Video thumbnails ready'
              : 'Video thumbnails need ffmpeg — run npm install'}
        </span>
      </div>
      {installing && (
        <p className="font-body text-[11px] italic text-muted-ink">This can take a minute or two. Keep the app open.</p>
      )}
      {result && (
        <div
          className={`relative pr-8 font-body text-[11px] text-ink ${result.ok ? '' : 'border-l-4 border-[#b91c1c] pl-2'}`}
        >
          <button
            onClick={() => setResult(null)}
            aria-label="Close this message"
            title="Close"
            className="absolute right-0 top-0 flex h-6 w-6 items-center justify-center text-xl leading-none text-ink hover:bg-ink/10"
          >
            ×
          </button>
          <p>{result.ok ? '✓ npm install finished.' : 'npm install didn’t finish:'}</p>
          {result.output && (
            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap bg-muted p-1 text-[10px] text-muted-ink">
              {result.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** How the Media Library is arranged: as first listed (by ID), newest first, by name, or one kind first. */
type ListOrder = 'listed' | 'recent' | 'actions' | 'name' | MediaKind;
const ORDERS: { value: ListOrder; label: string; hint: string }[] = [
  { value: 'listed', label: 'Listed', hint: 'In the order the files first appeared (by ID)' },
  { value: 'recent', label: 'Most recent', hint: 'The newest files first' },
  { value: 'actions', label: 'With actions', hint: 'Files connected to an action in this scene first' },
  { value: 'name', label: 'Name', hint: 'A–Z by file name' },
  { value: 'video', label: 'Video', hint: 'Videos first' },
  { value: 'sound', label: 'Sound', hint: 'Sounds first' },
  { value: 'image', label: 'Image', hint: 'Images first' },
];

/**
 * The list in `order` — a kind's files first, the rest after them as listed;
 * "With actions": the files connected to an action (`connected`) first.
 */
function arrange(assets: MediaAsset[], order: ListOrder, connected: Set<string>): MediaAsset[] {
  if (order === 'listed') return assets;
  if (order === 'actions') return [...assets.filter((a) => connected.has(a.id)), ...assets.filter((a) => !connected.has(a.id))];
  // Newest first: by the day it was added, then by ID (IDs are given out in order).
  if (order === 'recent') return [...assets].reverse().sort((a, b) => (b.added || '').localeCompare(a.added || ''));
  if (order === 'name')
    return [...assets].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return [...assets.filter((a) => a.kind === order), ...assets.filter((a) => a.kind !== order)];
}

/**
 * How closely a file matches what's typed in the search box (lower is closer;
 * null = not at all): the whole name, the start of the name, the start of a
 * word in it, anywhere in it (or its ID), then its letters in order.
 */
function closeness(asset: MediaAsset, typed: string): number | null {
  const q = typed.trim().toLowerCase();
  if (!q) return null;
  const name = asset.name.toLowerCase();
  const stem = name.replace(/\.[a-z0-9]+$/, '');
  if (stem === q || name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (stem.split(/[^a-z0-9]+/).some((word) => word.startsWith(q))) return 2;
  if (name.includes(q) || asset.id.toLowerCase().includes(q)) return 3;
  let at = 0;
  for (const ch of name) if (ch === q[at]) at++;
  return at === q.length ? 4 : null;
}

/** The closest matches first (keeping the list's order among equals), then everything else. */
function bySearch(assets: MediaAsset[], typed: string): MediaAsset[] {
  if (!typed.trim()) return assets;
  const scored = assets.map((asset, i) => ({ asset, i, score: closeness(asset, typed) }));
  return scored.sort((a, b) => (a.score ?? 99) - (b.score ?? 99) || a.i - b.i).map((s) => s.asset);
}

const LIST_HEIGHT_KEY = 'media-library-height';
const LIST_HEIGHT = { min: 160, standard: 420 } as const;
/** The tallest the list can be: down to the bottom of the window. */
const tallest = (list: HTMLElement | null) =>
  list ? Math.max(LIST_HEIGHT.min, window.innerHeight - list.getBoundingClientRect().top - 16) : 2000;

/**
 * Every file: a thumbnail, and its ID, name, type and date added beside it.
 * Only one plays at a time. The list's bottom edge drags down — as far as the
 * bottom of the window — to see more at once (double-click: all the way).
 */
type Connect = {
  /** The open scene, if it's from the sheet (only those have media actions). */
  scene: { sheetId: string; number: string; name: string } | null;
  /** Its actions from row 8 (null while they're being read). */
  actions: SceneActions | null;
  /** Row 8 is being read again (the list shown is the last one read). */
  rereading: boolean;
  /** Reads row 8 again — each time Connect with Action opens its list. */
  onReread: () => void;
  links: MediaLink[];
  onToggle: (assetId: string, action: string) => void;
  onRemove: (link: MediaLink) => void;
  onTiming: (link: MediaLink, change: NonNullable<MediaLink['timing']>) => void;
  /** "When it plays" picked: its kind, and (for "once") whether it loops until removed. */
  onPlays: (link: MediaLink, kind: ActionKind, loop: boolean | undefined) => void;
  onTryVoice?: (text: string, signal?: AbortSignal) => Promise<void>;
};

function MediaList({
  folder,
  assets,
  show,
  connect,
}: {
  folder: MediaFolder;
  assets: MediaAsset[];
  show: boolean;
  connect: Connect;
}) {
  /** The file whose Connect with Action list is open. */
  const [connecting, setConnecting] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const playing = useRef<HTMLMediaElement | null>(null);
  const onPlay = useCallback((el: HTMLMediaElement) => {
    if (playing.current && playing.current !== el) playing.current.pause();
    playing.current = el;
  }, []);
  const [height, setHeight] = useState<number>(LIST_HEIGHT.standard);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);
  const [grabbed, setGrabbed] = useState(false);
  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(LIST_HEIGHT_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only: localStorage doesn't exist during SSR
      if (stored) setHeight(stored);
    } catch {
      // Storage blocked: the standard height.
    }
  }, []);
  const resize = (h: number) => {
    const next = Math.round(Math.max(LIST_HEIGHT.min, Math.min(h, tallest(list.current))));
    setHeight(next);
    try {
      window.localStorage.setItem(LIST_HEIGHT_KEY, String(next));
    } catch {
      // As above.
    }
  };
  const stop = () => {
    drag.current = null;
    setGrabbed(false);
    document.body.style.removeProperty('user-select');
    document.body.style.removeProperty('cursor');
  };
  const [order, setOrder] = useState<ListOrder>('listed');
  const [search, setSearch] = useState('');
  // The files connected to an action in the open scene (any scene, if it isn't from the sheet).
  const connected = new Set(
    connect.links
      .filter((l) => !connect.scene || (l.sheetId === connect.scene.sheetId && l.sceneNumber === connect.scene.number))
      .map((l) => l.assetId),
  );
  const shown = bySearch(arrange(assets, order, connected), search);
  return (
    <div>
      <div className="mb-1 flex flex-wrap gap-0.5" role="group" aria-label="Arrange the Media Library">
        {ORDERS.map((o) => (
          <button
            key={o.value}
            onClick={() => setOrder(o.value)}
            aria-pressed={order === o.value}
            title={o.hint}
            className={`border border-ink px-1.5 py-0.5 font-label text-[10px] uppercase transition-colors ${
              order === o.value ? 'bg-ink text-paper' : 'bg-paper text-ink hover:bg-ink/10'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {/* The search box: its own line, under the arrange buttons. */}
      <div className="mb-1.5 flex">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            // The closest matches are at the top: show them.
            list.current?.scrollTo({ top: 0 });
          }}
          placeholder="Search…"
          aria-label="Search the Media Library"
          className="min-w-[60px] flex-1 border border-ink bg-paper px-2 py-0.5 font-body text-xs text-ink placeholder:text-muted-ink focus:outline focus:outline-2 focus:outline-ink"
        />
      </div>
      <ul ref={list} className="overflow-y-auto border border-hair" style={{ height }} aria-label="Media Library">
        {shown.map((a) => (
          <li
            key={a.id}
            className={`border-b border-hair p-1.5 last:border-b-0 ${a.status === 'missing' ? 'opacity-50' : ''}`}
          >
            {/* The details sit level with the thumbnail's top edge, Connect with Action with its bottom edge. */}
            <div className="flex items-stretch gap-3">
              <Thumbnail asset={a} folder={folder} show={show && a.status === 'present'} root={list} onPlay={onPlay} />
              <div className="flex min-w-0 flex-1 flex-col font-body text-xs leading-snug text-ink">
                <p className="font-label text-[10px] leading-none tracking-wide">
                  {a.id} · {KIND_LABEL[a.kind]}
                  {a.status === 'missing' && ' · missing from the folder'}
                </p>
                <p className="mt-1 truncate" title={a.path}>
                  {a.name}
                </p>
                <p className="text-[11px] text-muted-ink">Added {a.added || '—'}</p>
                <button
                  onClick={() => {
                    const opening = connecting !== a.id;
                    setConnecting(opening ? a.id : null);
                    // The actions change often: read row 8 afresh each time the list opens.
                    if (opening) connect.onReread();
                  }}
                  aria-expanded={connecting === a.id}
                  data-connect-toggle={a.id}
                  className={`mt-auto inline-flex h-10 items-center gap-1.5 self-start border border-ink px-3 font-label text-[10px] uppercase transition-colors ${
                    connecting === a.id ? 'bg-ink text-paper' : 'bg-paper text-ink hover:bg-ink/10'
                  }`}
                >
                  <span className="text-left leading-tight">Connect with Action</span>
                  <DropdownArrow open={connecting === a.id} />
                </button>
              </div>
            </div>
            <Connections asset={a} connect={connect} />
            {connecting === a.id && <ActionPicker asset={a} connect={connect} onDone={() => setConnecting(null)} />}
          </li>
        ))}
      </ul>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the Media Library list"
        aria-valuemin={LIST_HEIGHT.min}
        aria-valuenow={height}
        tabIndex={0}
        title="Drag to show more · double-click to reach the bottom of the window"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Not a real pointer — following still works on the handle.
          }
          drag.current = { startY: e.clientY, startHeight: height };
          setGrabbed(true);
          document.body.style.userSelect = 'none';
          document.body.style.cursor = 'row-resize';
        }}
        onPointerMove={(e) => {
          if (drag.current) resize(drag.current.startHeight + e.clientY - drag.current.startY);
        }}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
        onDoubleClick={() => resize(tallest(list.current))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            resize(height + (e.key === 'ArrowDown' ? 40 : -40));
          }
        }}
        className="flex h-[10px] cursor-row-resize items-center outline-none"
      >
        <span className={`h-[4px] w-full transition-colors ${grabbed ? 'bg-[#15803d]' : 'bg-ink'}`} />
      </div>
    </div>
  );
}

// Which connection boxes are open (folded to one line otherwise) — remembered in this browser.
const OPEN_KEY = 'media-open-connections';
const connectionKey = (l: MediaLink) => `${l.sheetId}|${l.sceneNumber}|${l.assetId}|${l.action}`;
function loadOpen(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(OPEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/** When a connection plays, in a few words (for its folded line). */
function playsText(l: MediaLink, asset: MediaAsset): string {
  const t = timingOf(l);
  if (t.kind === 'once' && asset.kind !== 'image' && loopOf(l)) return LOOP_WHEN_BADGE;
  return t.kind === 'every' ? `${KIND_BADGE.every} · ${WHEN_LABEL[t.when]}` : KIND_BADGE[t.kind];
}

/**
 * The actions a file is connected to, each with × to disconnect it. Each is
 * folded to one line (the action and when it plays) until clicked open — so a
 * long library stays compact but still shows what's connected.
 */
function Connections({ asset, connect }: { asset: MediaAsset; connect: Connect }) {
  const [open, setOpen] = useState<Set<string>>(() => (typeof window === 'undefined' ? new Set() : loadOpen()));
  const mine = connect.links.filter((l) => l.assetId === asset.id);
  if (mine.length === 0) return null;
  const current = connect.actions && 'list' in connect.actions ? connect.actions.list : null;
  const toggle = (l: MediaLink) => {
    const next = loadOpen();
    if (next.has(connectionKey(l))) next.delete(connectionKey(l));
    else next.add(connectionKey(l));
    try {
      window.localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
    } catch {
      // Not remembered.
    }
    setOpen(next);
  };
  return (
    <ul className="mt-1.5 flex flex-col gap-1" aria-label={`Actions ${asset.id} is connected to`}>
      {mine.map((l, i) => {
        const here = connect.scene && l.sheetId === connect.scene.sheetId && l.sceneNumber === connect.scene.number;
        const gone = here && current !== null && !current.includes(l.action);
        const isOpen = open.has(connectionKey(l));
        const reading = readingNow(l.action);
        const unsure = reading && !reading.clear && !l.timing?.kind;
        return (
          <li
            key={i}
            className="flex items-start gap-1.5 border-l-4 border-[#3c5eac] bg-[#3c5eac]/10 py-0.5 pl-1.5 font-body text-[11px] text-ink"
          >
            {isOpen ? (
              <span className="min-w-0 flex-1">
                <button
                  onClick={() => toggle(l)}
                  aria-expanded
                  title="Fold this away to one line"
                  className="flex w-full items-center gap-1 text-left font-label text-[9px] uppercase tracking-wide text-muted-ink hover:text-ink"
                >
                  <span className="text-[8px]">▼</span>
                  Scene {l.sceneNumber}
                  {l.sceneName ? ` · ${l.sceneName}` : ''}
                </button>
                {l.action}
                {gone && <span className="text-[#b91c1c]"> — no longer in row 8 of the sheet</span>}
                <ActionTimingControls link={l} asset={asset} connect={connect} />
              </span>
            ) : (
              // Folded: one line — the action, and when it plays.
              <button
                onClick={() => toggle(l)}
                aria-expanded={false}
                title={`${l.action}\nScene ${l.sceneNumber} · ${playsText(l, asset)} — click to open its settings`}
                className="flex min-w-0 flex-1 items-center gap-1 self-center py-1 text-left hover:text-[#3c5eac]"
              >
                <span className="shrink-0 text-[8px]">▶</span>
                <span className="min-w-0 flex-1 truncate">{l.action}</span>
                <span
                  className={`shrink-0 font-label text-[9px] uppercase tracking-wide ${
                    gone || unsure ? 'text-[#b91c1c]' : 'text-muted-ink'
                  }`}
                >
                  {gone ? 'Not in sheet' : unsure ? '? Pick when' : playsText(l, asset)}
                </span>
              </button>
            )}
            <button
              onClick={() => connect.onRemove(l)}
              aria-label={`Disconnect ${asset.id} from “${l.action}”`}
              title="Disconnect this file from this action"
              className={`flex shrink-0 items-center justify-center leading-none text-ink hover:bg-[#3c5eac]/20 hover:text-[#b91c1c] ${
                isOpen ? 'h-8 w-8 text-2xl' : 'h-6 w-6 self-center text-lg'
              }`}
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const SAMPLE_LINE = 'Hello — this is how my replies will sound.';
const selectClass = 'border border-ink bg-paper px-1 py-0.5 font-body text-[11px] text-ink';

/**
 * A connection's kind (read from its action's words), and for an "every time"
 * one: when it fires, what the voice does, and Try it — the sound and a
 * sample line in the scene's voice, with that timing.
 */
function ActionTimingControls({ link, asset, connect }: { link: MediaLink; asset: MediaAsset; connect: Connect }) {
  const timing = timingOf(link);
  const [trying, setTrying] = useState(false);
  const [problem, setProblem] = useState('');
  /** Stops a Try it under way (the button turns into Stop while it plays). */
  const stopper = useRef<AbortController | null>(null);
  // Claude's reading of the action; if it could mean more than one thing, the student picks.
  const reading = readingNow(link.action);
  const unsure = reading && !reading.clear && !link.timing?.kind;
  // "Loop, when user instructs" (video and sound).
  const loopsWhen = timing.kind === 'once' && asset.kind !== 'image' && loopOf(link);
  // An image or video showing in the room now (from Try it or the conversation).
  const shownNow = useShowing().some((m) => m.assetId === asset.id);

  const tryIt = async () => {
    const stop = new AbortController();
    stopper.current = stop;
    const stopped = () => stop.signal.aborted;
    // Stopped from anywhere (its thumbnail's ■ too): the rest of the test doesn't happen.
    const sound = () =>
      stopped()
        ? Promise.resolve()
        : playSound(asset, true).then((how) => {
            if (how === 'stopped') stop.abort();
          });
    const voice = () =>
      stopped() ? Promise.resolve() : (connect.onTryVoice?.(SAMPLE_LINE, stop.signal) ?? Promise.resolve());
    setTrying(true);
    setProblem('');
    try {
      if (timing.kind !== 'every') {
        await sound();
      } else if (timing.when === 'before-reply') {
        // The voice waits for the sound, waits a set time, or starts with it.
        const playing = sound();
        if (timing.voice === 'wait') await playing;
        else if (timing.voice === 'delay')
          await new Promise((r) => {
            const timer = setTimeout(r, Math.max(0, timing.delay) * 1000);
            stop.signal.addEventListener('abort', () => (clearTimeout(timer), r(undefined)), { once: true });
          });
        await Promise.all([voice(), playing]);
      } else if (timing.when === 'reply-start') {
        await Promise.all([sound(), voice()]);
      } else if (timing.when === 'after-reply') {
        await voice();
        await sound();
      } else {
        await sound();
      }
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'It couldn’t be played.');
    } finally {
      stopper.current = null;
      setTrying(false);
    }
  };
  // Stop: the sound (wherever it's playing) and the sample line, and nothing more of the test.
  const stopTry = () => {
    stopper.current?.abort();
    stopSounds(asset.id);
  };

  return (
    <span className="mt-1 flex flex-col gap-1">
      {unsure && (
        <span className="flex flex-col gap-1 border border-[#3c5eac] bg-paper p-1.5">
          <span>Not sure when this should play — pick one:</span>
          <span className="flex flex-wrap gap-1">
            {(reading.options?.length ? reading.options : ACTION_KINDS).map((k) => (
              <button
                key={k}
                onClick={() => connect.onTiming(link, { kind: k })}
                title={`Plays ${KIND_HELP[k]}`}
                className="border border-[#3c5eac] bg-[#3c5eac]/10 px-1.5 py-0.5 font-label text-[10px] uppercase text-ink hover:bg-[#3c5eac] hover:text-paper"
              >
                {KIND_BADGE[k]}
              </button>
            ))}
          </span>
        </span>
      )}
      <span className="flex flex-wrap items-center gap-1">
        <select
          value={loopsWhen ? 'once-loop' : timing.kind}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'once-loop') connect.onPlays(link, 'once', true);
            else connect.onPlays(link, v as ActionKind, v === 'once' ? false : undefined);
          }}
          className={`${selectClass} font-label uppercase`}
          title={`Plays ${loopsWhen ? LOOP_WHEN_HELP : KIND_HELP[timing.kind]}`}
          aria-label="When it plays"
        >
          {ACTION_KINDS.flatMap((k) => [
            <option key={k} value={k}>
              {KIND_BADGE[k]}
            </option>,
            // A picture just stays up: only video and sound can loop.
            k === 'once' && asset.kind !== 'image' && (
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
              onChange={(e) => connect.onTiming(link, { when: e.target.value as EveryWhen })}
              className={selectClass}
              title="Each time what happens"
              aria-label="Each time what happens"
            >
              {(Object.keys(WHEN_LABEL) as EveryWhen[]).map((w) => (
                <option key={w} value={w}>
                  {WHEN_LABEL[w]}
                </option>
              ))}
            </select>
            {timing.when === 'before-reply' && (
              <select
                value={timing.voice}
                onChange={(e) => connect.onTiming(link, { voice: e.target.value as VoiceWait })}
                className={selectClass}
                title="What the chatbot's voice does"
                aria-label="What the voice does"
              >
                {(Object.keys(VOICE_LABEL) as VoiceWait[]).map((v) => (
                  <option key={v} value={v}>
                    {VOICE_LABEL[v]}
                  </option>
                ))}
              </select>
            )}
            {timing.when === 'before-reply' && timing.voice === 'delay' && (
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  value={timing.delay}
                  onChange={(e) =>
                    connect.onTiming(link, { delay: Math.min(10, Math.max(0, Number(e.target.value) || 0)) })
                  }
                  aria-label="Seconds the voice waits"
                  className={`w-14 ${selectClass}`}
                />
                s
              </span>
            )}
          </>
        )}
        {asset.kind === 'sound' && (
          <button
            onClick={() => (trying ? stopTry() : void tryIt())}
            className={`border border-ink px-1.5 py-0.5 font-label text-[10px] uppercase ${
              trying ? 'bg-ink text-paper hover:bg-ink/80' : 'bg-paper text-ink hover:bg-ink/10'
            }`}
            title={
              trying
                ? 'Stop the sound and the sample line'
                : "Play the sound and a sample line in the scene's voice, with this timing"
            }
          >
            {trying ? '■ Stop' : '▶ Try it'}
          </button>
        )}
        {asset.kind !== 'sound' && (
          <button
            onClick={() => {
              setProblem('');
              if (shownNow) hideVisual(asset.id);
              else
                showVisual({ link, asset, timing, areas: areasOf(link) }, true).catch((err: unknown) =>
                  setProblem(err instanceof Error ? err.message : 'It couldn’t be shown.'),
                );
            }}
            className={`border border-ink px-1.5 py-0.5 font-label text-[10px] uppercase ${
              shownNow ? 'bg-ink text-paper hover:bg-ink/80' : 'bg-paper text-ink hover:bg-ink/10'
            }`}
            title={
              shownNow
                ? 'Hide it — take it out of the room'
                : `Show it in ${areasText(areasOf(link))} of the room (its bars' tracks on the timeline)`
            }
          >
            {/* Both labels share one cell, so the button keeps its "Try it" width while it says Hide. */}
            <span className="grid">
              <span className={`col-start-1 row-start-1 ${shownNow ? 'invisible' : ''}`}>
                ▶ Try it in {areasText(areasOf(link))}
              </span>
              <span className={`col-start-1 row-start-1 text-center ${shownNow ? '' : 'invisible'}`}>■ Hide</span>
            </span>
          </button>
        )}
      </span>
      {problem && <span className="text-[#b91c1c]">{problem}</span>}
    </span>
  );
}

/** The open scene's media actions (row 8): pick one to connect this file to it (or, if it's connected, to disconnect). */
function ActionPicker({ asset, connect, onDone }: { asset: MediaAsset; connect: Connect; onDone: () => void }) {
  const { scene, actions } = connect;
  // A click anywhere else (or Escape) closes it — except on its own Connect with Action button, which toggles it.
  const box = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target || box.current?.contains(target)) return;
      if (target.closest(`[data-connect-toggle="${CSS.escape(asset.id)}"]`)) return;
      done.current();
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && done.current();
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [asset.id]);
  const linked = (action: string) =>
    connect.links.some(
      (l) =>
        l.assetId === asset.id &&
        scene &&
        l.sheetId === scene.sheetId &&
        l.sceneNumber === scene.number &&
        l.action === action,
    );
  let body;
  if (!scene) {
    body = (
      <p className="p-1.5 italic text-muted-ink">
        This scene isn&rsquo;t from the Google Sheet, so it has no media actions.
      </p>
    );
  } else if (!actions) {
    body = <p className="p-1.5 italic text-muted-ink">Reading row 8 of the sheet…</p>;
  } else if ('error' in actions) {
    body = <p className="border-l-4 border-[#b91c1c] p-1.5">{actions.error}</p>;
  } else if (actions.list.length === 0) {
    body = (
      <p className="p-1.5 italic text-muted-ink">
        Row 8 (Media Actions in this Scene) is empty for this scene. Write one action per line there.
      </p>
    );
  } else {
    body = (
      <ul role="listbox" aria-label={`Media actions in Scene ${scene.number}`}>
        {actions.list.map((action) => (
          <li key={action}>
            <button
              role="option"
              aria-selected={linked(action)}
              onClick={() => {
                connect.onToggle(asset.id, action);
                onDone();
              }}
              className="flex w-full items-start gap-1.5 px-1.5 py-1 text-left hover:bg-ink/10"
            >
              <span className="w-3 shrink-0 font-label text-[11px]">{linked(action) ? '✓' : ''}</span>
              <span className="min-w-0 flex-1">{action}</span>
              <span className="shrink-0 font-label text-[9px] uppercase tracking-wide text-muted-ink">
                {readingNow(action)
                  ? readingNow(action)!.clear
                    ? readingNow(action)!.kind === 'once' && readingNow(action)!.loop
                      ? LOOP_WHEN_BADGE
                      : KIND_BADGE[readingNow(action)!.kind]
                    : '? Not sure'
                  : readActionTiming(action).kind === 'once' && wordsSayLoop(action)
                    ? LOOP_WHEN_BADGE
                    : KIND_BADGE[readActionTiming(action).kind]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div ref={box} className="mt-1.5 border-2 border-ink bg-paper font-body text-xs text-ink">
      {/* "Checking the sheet…" shares the title's line, so the list doesn't jump as it comes and goes. */}
      <div className="flex h-6 items-center gap-2 border-b border-hair px-1.5">
        <p className="min-w-0 flex-1 truncate font-label text-[10px] uppercase tracking-wide text-muted-ink">
          {scene ? `Media actions · Scene ${scene.number}${scene.name ? ` · ${scene.name}` : ''}` : 'Media actions'}
        </p>
        <span className="shrink-0 font-body text-[11px] italic leading-none text-muted-ink" aria-live="polite">
          {scene && connect.rereading && actions ? 'Checking the sheet…' : ''}
        </span>
      </div>
      <div className={scene && connect.rereading && actions ? 'opacity-50' : ''}>{body}</div>
    </div>
  );
}

/**
 * One file's thumbnail (176px wide). An image shows
 * itself; a video its first frame, and plays (or pauses) when clicked; a
 * sound shows the sound icon, and plays when clicked. The file is only
 * opened once the row scrolls near view.
 */
function Thumbnail({
  asset,
  folder,
  show,
  root,
  onPlay,
}: {
  asset: MediaAsset;
  folder: MediaFolder;
  show: boolean;
  root: React.RefObject<HTMLUListElement | null>;
  onPlay: (el: HTMLMediaElement) => void;
}) {
  const box = useRef<HTMLButtonElement>(null);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [near, setNear] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(true);

  useEffect(() => {
    if (!show || near || !box.current) return;
    const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), {
      root: root.current,
      rootMargin: '200px 0px',
    });
    seen.observe(box.current);
    return () => seen.disconnect();
  }, [show, near, root]);

  const fileRef = useRef<File | null>(null);
  // A video the browser can't play: a still of its first frame, made by ffmpeg on this computer.
  const [still, setStill] = useState<string | null>(null);
  const [stillProblem, setStillProblem] = useState('');
  const stillAsked = useRef(false);
  const makeStill = async () => {
    const file = fileRef.current;
    if (!file || stillAsked.current) return;
    stillAsked.current = true;
    try {
      const image =
        (await loadThumbnail(asset.id, file, asset.path)) ?? (await makeThumbnail(asset.id, file, asset.path));
      setStill(URL.createObjectURL(image));
    } catch (err) {
      setStillProblem(err instanceof Error ? err.message : 'No thumbnail could be made.');
    }
  };
  useEffect(
    () => () => {
      if (still) URL.revokeObjectURL(still);
    },
    [still],
  );

  useEffect(() => {
    if (!show || !near) return;
    let made: string | null = null;
    let gone = false;
    openMediaFile(folder, asset.path)
      .then((file) => {
        if (gone) return;
        fileRef.current = file;
        made = URL.createObjectURL(file);
        setUrl(made);
      })
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [show, near, folder, asset.path]);

  // Its sound playing elsewhere — a Try it, or the conversation: Stop here stops that too.
  const [playingElsewhere, setPlayingElsewhere] = useState(false);
  useEffect(() => onSoundsChange(() => setPlayingElsewhere(isSoundPlaying(asset.id))), [asset.id]);

  // A sound stops (back to its start); a video pauses where it is.
  const stops = asset.kind === 'sound';
  const toggle = () => {
    if (playingElsewhere) {
      stopSounds(asset.id);
      return;
    }
    const el = media.current;
    if (!el) return;
    if (el.paused) {
      onPlay(el);
      void el.play();
    } else {
      el.pause();
      if (stops) el.currentTime = 0;
    }
  };

  const playable = (asset.kind !== 'image' && Boolean(url) && !failed) || playingElsewhere;
  // Shown as playing: its own player, or its sound playing elsewhere.
  const quiet = paused && !playingElsewhere;
  const label = `${asset.id} ${asset.name}`;
  return (
    <button
      ref={box}
      type="button"
      onClick={playable ? toggle : undefined}
      disabled={!playable && asset.kind !== 'image'}
      aria-label={playable ? `${quiet ? 'Play' : stops ? 'Stop' : 'Pause'} ${label}` : label}
      className={`relative aspect-video w-[176px] shrink-0 overflow-hidden border border-ink ${asset.kind === 'sound' ? 'bg-paper' : 'bg-ink/90'} ${playable ? 'cursor-pointer' : 'cursor-default'}`}
    >
      {asset.kind === 'image' && url && (
        // A local file (object URL), so next/image's optimising doesn't apply.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-contain" />
      )}
      {asset.kind === 'video' && url && (
        <video
          ref={media}
          src={url}
          preload="metadata"
          playsInline
          // Show the first frame (some browsers stay blank until asked for a moment of it).
          onLoadedMetadata={(e) => {
            if (e.currentTarget.currentTime === 0) e.currentTarget.currentTime = 0.001;
          }}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onEnded={() => setPaused(true)}
          onError={() => {
            setFailed(true);
            if (asset.kind === 'video') void makeStill();
          }}
          className="h-full w-full object-contain"
        />
      )}
      {still && (
        <>
          {/* A local image (object URL), so next/image's optimising doesn't apply. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={still} alt="" className="absolute inset-0 h-full w-full object-contain" />
          <span className="absolute bottom-0 left-0 whitespace-nowrap bg-paper/90 px-1 font-label text-[8px] uppercase tracking-wide text-ink">
            Still · plays in TouchDesigner
          </span>
        </>
      )}
      {asset.kind === 'sound' && (
        <span className="flex h-full flex-col items-center justify-center">
          <span className="font-label text-[11px] uppercase text-ink">♪ Sound</span>
          {url && (
            <audio
              ref={media}
              src={url}
              preload="none"
              onPlay={() => setPaused(false)}
              onPause={() => setPaused(true)}
              onEnded={() => setPaused(true)}
              onError={() => setFailed(true)}
            />
          )}
        </span>
      )}
      {playable && (
        <span
          className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center border border-ink bg-paper text-[12px] leading-none text-ink"
          aria-hidden="true"
        >
          {quiet ? '▶' : stops ? '■' : '❚❚'}
        </span>
      )}
      {failed && !still && (
        <span
          className="absolute inset-0 flex flex-col items-center justify-center bg-paper/90 px-1 text-center font-body text-[9px] text-ink"
          title={stillProblem || undefined}
        >
          Can&rsquo;t preview here
          {stillProblem && <span className="mt-0.5 text-[8px] text-muted-ink">{stillProblem}</span>}
        </span>
      )}
      {asset.status === 'missing' && (
        <span className="absolute inset-0 flex items-center justify-center bg-paper font-label text-[9px] uppercase text-muted-ink">
          Missing
        </span>
      )}
    </button>
  );
}
