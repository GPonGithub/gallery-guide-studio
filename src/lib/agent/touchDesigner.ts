'use client';

import { useSyncExternalStore } from 'react';
import type { MediaAsset } from './media';
import { loadLibrary } from './mediaFolder';
import type { Shown } from './mediaShow';

/**
 * The live link to TouchDesigner for the room's media. The browser connects
 * straight to the Immersive Lab receiver (a Web Server DAT made by
 * public/touchdesigner/build_immersive_lab.py) with a WebSocket and sends small
 * JSON messages — its message_guide table lists them:
 *
 *   media show / play / hide   a picture or video in projection area 1–11
 *   sound play / stop          a sound, on TouchDesigner's own audio slots
 *   levels                     the sounds' volume (Music / Sounds volume and dip)
 *   clear                      everything off (sent on connecting)
 *   medialist                  the media list, so TouchDesigner can check its files
 *   hello                      answered with "ready" and its media folder
 *   projectors …               the projector windows (Set up the projectors): their
 *                              numbers on or off, and which projector shows which part
 *
 * The room diagram is mirrored: whatever mediaShow shows in an area is sent
 * there (syncVisuals). Sounds go too when "Sounds play on" says TouchDesigner.
 * Settings are kept in this browser (per team).
 */

export type SoundsOn = 'computer' | 'touchdesigner' | 'both';
export type TDSettings = { on: boolean; address: string; sounds: SoundsOn };
/** TouchDesigner's projector windows (made by projector_output.py): how many, open, and their numbers showing. */
export type TDProjectors = { count: number; open: number; identify: boolean };
export type TDStatus = {
  state: 'off' | 'connecting' | 'connected' | 'closed';
  /** From TouchDesigner's "ready": its media folder, and whether it exists there. */
  mediaFolder?: string;
  folderFound?: boolean;
  /** Its projector windows; null when it has none, undefined until it says. */
  projectors?: TDProjectors | null;
  /** TouchDesigner's latest answer, e.g. "area 3: shown" or "M-007: file missing". */
  last?: { ok: boolean; text: string };
};

const SETTINGS_KEY = 'touchdesigner-media';
const DEFAULTS: TDSettings = { on: false, address: 'ws://localhost:9980', sounds: 'computer' };
const RETRY_MS = 3000;

function readSettings(): TDSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<TDSettings>) };
  } catch {
    return DEFAULTS;
  }
}

let settings: TDSettings | null = null;
let status: TDStatus = { state: 'off' };
let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function tdSettings(): TDSettings {
  if (typeof window === 'undefined') return DEFAULTS;
  if (!settings) {
    settings = readSettings();
    if (settings.on) connect();
  }
  return settings;
}

export const useTDSettings = () => useSyncExternalStore(subscribe, tdSettings, () => DEFAULTS);
export const useTDStatus = () =>
  useSyncExternalStore(
    subscribe,
    () => status,
    () => status,
  );

/** Changes the settings (and connects or disconnects to match). */
export function setTDSettings(change: Partial<TDSettings>) {
  const before = tdSettings();
  settings = { ...before, ...change };
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // kept for this page only
  }
  if (!settings.on) disconnect();
  else if (!before.on || settings.address !== before.address) connect();
  changed();
}

const setStatus = (next: Partial<TDStatus>) => {
  status = { ...status, ...next };
  changed();
};

const isOpen = () => socket?.readyState === WebSocket.OPEN;

function disconnect() {
  if (retry) clearTimeout(retry);
  retry = null;
  const s = socket;
  socket = null;
  s?.close();
  status = { state: 'off' };
}

function connect() {
  if (retry) clearTimeout(retry);
  retry = null;
  socket?.close();
  const address = tdSettings().address.trim();
  let s: WebSocket;
  try {
    s = new WebSocket(address);
  } catch {
    setStatus({ state: 'closed', last: { ok: false, text: `“${address}” isn’t a WebSocket address (ws://…)` } });
    return;
  }
  socket = s;
  setStatus({ state: 'connecting' });
  s.onopen = () => {
    if (socket !== s) return;
    void greet();
  };
  s.onmessage = (e) => {
    if (socket !== s) return;
    let reply: {
      type?: string;
      ok?: boolean;
      result?: string;
      where?: string;
      id?: string;
      mediaFolder?: string;
      folderFound?: boolean;
      projectors?: TDProjectors | null;
    };
    try {
      reply = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (reply.type === 'ready') {
      setStatus({ state: 'connected', mediaFolder: reply.mediaFolder, folderFound: reply.folderFound });
    } else if (reply.type === 'result' && reply.result) {
      const who = [reply.where, reply.id].filter(Boolean).join(' · ');
      setStatus({
        last: { ok: reply.ok !== false, text: who ? `${who}: ${reply.result}` : reply.result },
        ...('projectors' in reply ? { projectors: reply.projectors } : {}),
      });
    }
  };
  s.onclose = () => {
    if (socket !== s) return;
    socket = null;
    setStatus({ state: 'closed' });
    if (tdSettings().on) retry = setTimeout(connect, RETRY_MS);
  };
}

/** Called each time TouchDesigner has been greeted (and its room cleared and re-sent) — markerPlay puts the marker's stage back up. */
const connectedListeners = new Set<() => void>();
export function onTDConnected(listener: () => void) {
  connectedListeners.add(listener);
}

/** On connecting: hello, the projectors, the media list, a clean room, then what's on now (pictures, video, levels). */
async function greet() {
  send({ type: 'hello' });
  send({ type: 'projectors', action: 'status' });
  const library = await loadLibrary();
  send({
    type: 'medialist',
    items: (library?.assets ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      path: a.path,
      kind: a.kind,
      status: a.status,
    })),
  });
  send({ type: 'clear' });
  sent.clear();
  syncVisuals(current);
  if (lastLevels) send({ type: 'levels', ...lastLevels, ms: 0 });
  connectedListeners.forEach((listener) => listener());
  if (projectionsWanted.length > 0) {
    openProjections();
    projectionsWanted.splice(0).forEach((done) => done());
  }
}

// --- the projectors --------------------------------------------------------

/** Show projections clicks waiting for the connection (resolved once it's greeted). */
const projectionsWanted: (() => void)[] = [];
const openProjections = () => {
  send({ type: 'projectors', action: 'identify', on: false });
  send({ type: 'projectors', action: 'open' });
};

/** Connects (if need be) and opens TouchDesigner's projector windows, without their numbers; resolves once they're open. */
export function showProjections(address?: string): Promise<void> {
  if (isOpen() && (!address || address === tdSettings().address)) {
    openProjections();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    projectionsWanted.push(resolve);
    setTDSettings({ on: true, ...(address ? { address } : {}) });
  });
}

/** Sends one message, if connected; returns whether it went. */
export function send(message: Record<string, unknown>): boolean {
  if (!isOpen()) return false;
  socket!.send(JSON.stringify(message));
  return true;
}

// --- the room's pictures and video ------------------------------------------

/** What was last sent to each area (the very object mediaShow made — a new one means show it again). */
const sent = new Map<number, Shown>();
let current: Shown[] = [];

export const visualMessage = (
  area: number,
  asset: Pick<MediaAsset, 'id' | 'path' | 'kind' | 'value'>,
  loop: boolean,
) => ({
  type: 'media',
  action: asset.kind === 'video' ? 'play' : 'show',
  area,
  id: asset.id,
  // A text or colour has no file: its words or hex colour travel instead.
  ...(asset.kind === 'text' || asset.kind === 'color' ? { value: asset.value ?? '' } : { path: asset.path }),
  kind: asset.kind,
  loop,
});

/** Mirrors the room diagram into TouchDesigner (called by mediaShow on every change). */
export function syncVisuals(showing: Shown[]) {
  current = showing;
  if (!isOpen()) return;
  const now = new Map(showing.map((s) => [s.area, s]));
  for (const [area, s] of now) {
    if (sent.get(area) === s) continue;
    send(visualMessage(area, { id: s.assetId, path: s.path, kind: s.kind, value: s.value }, s.loop));
    sent.set(area, s);
  }
  for (const area of [...sent.keys()]) {
    if (now.has(area)) continue;
    send({ type: 'media', action: 'hide', area });
    sent.delete(area);
  }
}

// --- sounds -----------------------------------------------------------------

/** Whether sounds also play through this computer's speakers (always, while TouchDesigner isn't connected). */
export const soundsHere = () => tdSettings().sounds !== 'touchdesigner' || !isOpen();

/** A sound starting or stopping — sent to TouchDesigner when it plays sounds. */
export function tdSound(action: 'play' | 'stop', asset: MediaAsset, loop = false) {
  if (tdSettings().sounds === 'computer') return;
  send(
    action === 'play'
      ? { type: 'sound', action, id: asset.id, path: asset.path, loop }
      : { type: 'sound', action, id: asset.id },
  );
}

let lastLevels: { gain: number } | null = null;

/** The sounds' volume now (0–1), easing over `ms` — the Music / Sounds volume, dipped while the agent talks. */
export function tdLevels(gain: number, ms: number) {
  lastLevels = { gain };
  if (tdSettings().sounds !== 'computer') send({ type: 'levels', gain, ms });
}
