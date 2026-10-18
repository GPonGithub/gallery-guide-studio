/**
 * The media library: every image, video and sound file in the media folder,
 * each with an ID that never changes (M-001, M-002…). The files stay in the
 * folder; the list lives in the Google Sheet's "Media" tab (and a copy in
 * this browser). TouchDesigner runs on the same computer and is told the
 * folder once, so a file is named by its path inside the folder
 * ("nurse/susie.jpg").
 */

export type MediaKind = 'image' | 'video' | 'sound';
export type MediaStatus = 'present' | 'missing';

export type MediaAsset = {
  /** "M-001" — kept for as long as the file is in the folder, and never given to another file. */
  id: string;
  /** Its path inside the media folder, e.g. "nurse/susie.jpg" — what matches it on each refresh. */
  path: string;
  /** The file name alone, e.g. "susie.jpg". */
  name: string;
  kind: MediaKind;
  /** 'missing' = it was in the folder before but isn't now (kept, so its ID isn't reused). */
  status: MediaStatus;
  /** When it first appeared (YYYY-MM-DD). */
  added: string;
};

/** A media file found in the folder. */
export type FoundFile = { path: string; name: string; kind: MediaKind };

const EXTENSIONS: Record<MediaKind, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'exr', 'heic'],
  video: ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', 'mpg', 'mpeg', 'mxf'],
  sound: ['mp3', 'wav', 'aif', 'aiff', 'm4a', 'aac', 'ogg', 'flac'],
};

/** What kind of media a file is, from its extension — null for anything else (documents, project files…). */
export function kindOf(fileName: string): MediaKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  if (!ext) return null;
  for (const kind of Object.keys(EXTENSIONS) as MediaKind[]) if (EXTENSIONS[kind].includes(ext)) return kind;
  return null;
}

/** How the sheet shows each kind. */
export const KIND_LABEL: Record<MediaKind, string> = { image: 'Image', video: 'Video', sound: 'Sound' };
export const KIND_TAG: Record<MediaKind, string> = { image: 'IMG', video: 'VID', sound: 'SND' };

const idNumber = (id: string) => Number(/^M-(\d+)$/i.exec(id.trim())?.[1] ?? NaN);
export const formatId = (n: number) => `M-${String(n).padStart(3, '0')}`;
const key = (path: string) => path.trim().toLowerCase();

/**
 * The library after a refresh. A file already listed keeps its ID; a new one
 * gets the next number (numbers are never reused, even for missing files); a
 * listed file no longer in the folder is marked missing rather than dropped,
 * so rules that name it don't silently change meaning. A renamed or moved
 * file counts as a new one.
 */
export function mergeMedia(
  existing: MediaAsset[],
  found: FoundFile[],
  today: string,
): { assets: MediaAsset[]; added: number; missing: number; returned: number } {
  const byPath = new Map(existing.map((a) => [key(a.path), a]));
  const seen = new Set<string>();
  let next = Math.max(0, ...existing.map((a) => idNumber(a.id)).filter(Number.isFinite)) + 1;
  let added = 0;
  let returned = 0;
  const assets: MediaAsset[] = [];
  for (const file of [...found].sort((a, b) => a.path.localeCompare(b.path))) {
    const k = key(file.path);
    if (seen.has(k)) continue;
    seen.add(k);
    const known = byPath.get(k);
    if (known) {
      if (known.status === 'missing') returned++;
      assets.push({ ...known, path: file.path, name: file.name, kind: file.kind, status: 'present' });
    } else {
      added++;
      assets.push({ id: formatId(next++), path: file.path, name: file.name, kind: file.kind, status: 'present', added: today });
    }
  }
  let missing = 0;
  for (const a of existing) {
    if (seen.has(key(a.path))) continue;
    seen.add(key(a.path));
    if (a.status !== 'missing') missing++;
    assets.push({ ...a, status: 'missing' });
  }
  assets.sort((a, b) => idNumber(a.id) - idNumber(b.id) || a.path.localeCompare(b.path));
  return { assets, added, missing, returned };
}

/** A row of the sheet's Media tab, as the Apps Script reads and writes it. */
export type MediaRow = { id: string; name: string; kind: string; path: string; status: string; added: string };

export const toRow = (a: MediaAsset): MediaRow => ({
  id: a.id,
  name: a.name,
  kind: KIND_LABEL[a.kind],
  path: a.path,
  status: a.status,
  added: a.added,
});

/** Rows read back from the sheet (skipping any that aren't a media ID and a path). */
export function fromRows(rows: MediaRow[]): MediaAsset[] {
  return rows.flatMap((r) => {
    const id = String(r.id ?? '').trim();
    const path = String(r.path ?? '').trim();
    if (!Number.isFinite(idNumber(id)) || !path) return [];
    const kind = (Object.keys(KIND_LABEL) as MediaKind[]).find((k) => KIND_LABEL[k].toLowerCase() === String(r.kind).trim().toLowerCase()) ?? kindOf(path);
    if (!kind) return [];
    return [{
      id: formatId(idNumber(id)),
      path,
      name: String(r.name ?? '').trim() || path.split('/').pop() || path,
      kind,
      status: /missing/i.test(String(r.status)) ? 'missing' : 'present',
      added: String(r.added ?? '').trim(),
    }];
  });
}

/** The 11 projection areas. */
export const PROJECTION_AREAS = Array.from({ length: 11 }, (_, i) => i + 1);

/** What TouchDesigner is sent to show, play or stop media. */
export type MediaMessage =
  | { media: 'show'; area: number; id: string; file: string; kind: 'image' }
  | { media: 'play'; area: number; id: string; file: string; kind: 'video' }
  | { media: 'play'; channel: 'sound'; id: string; file: string; kind: 'sound' }
  | { media: 'stop'; area: number }
  | { media: 'stop'; channel: 'sound' };

/**
 * When a media action (row 8 of the sheet) fires. "Once, when…" actions fire
 * at a moment in the conversation ("Show picture of Maya when the nurse asks
 * to see it"); "every time" actions on a repeating event ("Play the ding every
 * time before you speak"); "throughout" ones for the whole scene.
 */
export type ActionKind = 'once' | 'every' | 'throughout';
/** The repeating events an "every time" action can follow. */
export type EveryWhen = 'before-reply' | 'reply-start' | 'after-reply' | 'caller-speaks';
/** What the chatbot's voice does about the sound: wait for it to finish, play over it, or wait a set time. */
export type VoiceWait = 'wait' | 'over' | 'delay';
export type ActionTiming = { kind: ActionKind; when: EveryWhen; voice: VoiceWait; /** Seconds, for 'delay'. */ delay: number };

export const KIND_BADGE: Record<ActionKind, string> = { once: 'Once, when…', every: '↻ Every time', throughout: 'Throughout the scene' };
export const WHEN_LABEL: Record<EveryWhen, string> = {
  'before-reply': 'Before each reply',
  'reply-start': 'As each reply starts',
  'after-reply': 'After each reply',
  'caller-speaks': 'When the caller speaks',
};
export const VOICE_LABEL: Record<VoiceWait, string> = {
  wait: 'Voice waits for the sound',
  over: 'Voice plays over it',
  delay: 'Voice waits…',
};

const CALLER_SPEAKS = /\b(caller|patient|nurse|user|person|visitor|they)\s+(?:speaks?|talks?|says?|answers?|replies|responds?|finish(?:es)?)\b/;

/** An action's timing, read from its words — the starting point, which the student can change. */
export function readActionTiming(text: string): ActionTiming {
  const t = text.toLowerCase();
  const every = /\b(?:every\s*time|each\s+time|whenever|always|every\s+(?:reply|response|line|answer|turn)|each\s+(?:reply|response|line|answer|turn))\b/.test(t);
  const throughout = /\b(?:throughout|the\s+whole\s+(?:scene|call)|all\s+through|in\s+the\s+background)\b/.test(t);
  let when: EveryWhen = 'before-reply';
  if (CALLER_SPEAKS.test(t)) when = 'caller-speaks';
  else if (/\bafter\b/.test(t)) when = 'after-reply';
  else if (/\b(?:while|as)\s+(?:you|it|the\s+\w+)\s+(?:speaks?|talks?|says?|replies|responds?)/.test(t)) when = 'reply-start';
  return {
    kind: every ? 'every' : throughout ? 'throughout' : 'once',
    when,
    voice: when === 'before-reply' ? 'wait' : 'over',
    delay: 1,
  };
}
